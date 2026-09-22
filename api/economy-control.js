import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { calculateAgencyCycleSettlement, convertPayableCoinsToDiamonds } from "./economy-policy.js";
import { economyPermissions } from "./economy-permissions.js";

function clean(value){return String(value??"").trim();}
function parseServiceAccount(raw){
  const text=clean(raw);
  if(!text)throw Error("server_not_configured");
  let sa=JSON.parse(text);
  if(typeof sa==="string")sa=JSON.parse(sa);
  const projectId=sa.project_id||sa.projectId;
  const clientEmail=sa.client_email||sa.clientEmail;
  const privateKey=String(sa.private_key||sa.privateKey||"").replace(/\\n/g,"\n");
  if(!projectId||!clientEmail||!privateKey)throw Error("invalid_service_account_json");
  return {projectId,clientEmail,privateKey};
}
function initFirebase(){
  if(!getApps().length){
    const sa=parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT);
    initializeApp({credential:cert(sa),projectId:sa.projectId});
  }
}
function cors(req,res){
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Headers","authorization, content-type");
  res.setHeader("Access-Control-Allow-Methods","POST,OPTIONS");
  if(req.method==="OPTIONS"){res.status(204).end();return true;}
  return false;
}
const out=(res,status,body)=>res.status(status).json(body);

async function actor(req){
  const authorization=clean(req.headers.authorization);
  if(!authorization.startsWith("Bearer "))throw Error("unauthorized");
  const decoded=await getAuth().verifyIdToken(authorization.slice(7));
  const db=getFirestore();
  const snap=await db.collection("users").doc(decoded.uid).get();
  if(!snap.exists)throw Error("forbidden");
  const user=snap.data()||{};
  const permissions=economyPermissions(user);
  if(!permissions.canEconomy)throw Error("forbidden");
  return {
    uid:decoded.uid,
    db,
    isOwner:permissions.isOwner,
    canAdjustBalances:permissions.canAdjustBalances,
    canManageSettlements:permissions.canManageSettlements,
  };
}

function normalizeLock(data={}){
  const economyLocked=data.economyLocked===true||data.enabled===true;
  return {
    enabled:economyLocked,
    economyLocked,
    rechargeLocked:data.rechargeLocked===true,
    giftsLocked:data.giftsLocked===true,
    transfersLocked:data.transfersLocked===true,
    reason:clean(data.reason),
    updatedBy:clean(data.updatedBy),
    updatedAt:data.updatedAt||null,
  };
}

function safeUser(uid,data){
  return {
    uid,
    publicId:clean(data.publicId),
    displayName:clean(data.displayName||data.username||"مستخدم Shadow Live"),
    username:clean(data.username),
    coins:Math.max(0,Number(data.coins??data.balance??0)),
    diamonds:Math.max(0,Number(data.diamonds||0)),
    pendingGiftEarningCoins:Math.max(0,Number(data.pendingGiftEarningCoins||0)),
    giftEarningCoinsLifetime:Math.max(0,Number(data.giftEarningCoinsLifetime||0)),
    giftDiamondsLifetime:Math.max(0,Number(data.giftDiamondsLifetime||0)),
    giftSupportReceivedCoins:Math.max(0,Number(data.giftSupportReceivedCoins||0)),
    totalGiftsSent:Math.max(0,Number(data.totalGiftsSent||0)),
    totalGiftsReceived:Math.max(0,Number(data.totalGiftsReceived||0)),
    totalValueReceived:Math.max(0,Number(data.totalValueReceived||0)),
    currentGiftRevenueTier:clean(data.currentGiftRevenueTier),
    agencyId:clean(data.agencyId),
    role:clean(data.role||"user"),
  };
}

async function findUser(db,query){
  const q=clean(query);
  if(!q||q.length>180)throw Error("invalid_query");
  const direct=await db.collection("users").doc(q).get();
  if(direct.exists)return safeUser(direct.id,direct.data()||{});

  const byPublic=await db.collection("public_profiles").where("publicId","==",q).limit(1).get();
  if(!byPublic.empty){
    const uid=byPublic.docs[0].id;
    const user=await db.collection("users").doc(uid).get();
    if(user.exists)return safeUser(uid,user.data()||{});
  }

  const byUsername=await db.collection("public_profiles").where("username","==",q).limit(1).get();
  if(!byUsername.empty){
    const uid=byUsername.docs[0].id;
    const user=await db.collection("users").doc(uid).get();
    if(user.exists)return safeUser(uid,user.data()||{});
  }
  throw Error("user_not_found");
}

async function userLedger(db,uid){
  const snap=await db.collection("financial_ledger").where("userId","==",uid).limit(50).get();
  return snap.docs.map(doc=>({id:doc.id,...(doc.data()||{})}));
}

async function searchOperations(db,query){
  const q=clean(query);
  if(!/^[A-Za-z0-9_-]{3,220}$/.test(q))throw Error("invalid_query");
  const collections=[
    "financial_ledger",
    "gift_transactions",
    "wallet_operations",
    "gift_operations",
    "google_play_purchases",
    "control_operations",
    "wallet_transfers",
  ];
  const results=[];
  const direct=await Promise.all(collections.map(name=>db.collection(name).doc(q).get()));
  for(let i=0;i<direct.length;i++){
    const snap=direct[i];
    if(snap.exists)results.push({collection:collections[i],id:snap.id,data:snap.data()||{}});
  }

  const [byIdempotency,bySource]=await Promise.all([
    db.collection("financial_ledger").where("idempotencyKey","==",q).limit(20).get(),
    db.collection("financial_ledger").where("sourceId","==",q).limit(20).get(),
  ]);
  for(const doc of [...byIdempotency.docs,...bySource.docs]){
    if(!results.some(item=>item.collection==="financial_ledger"&&item.id===doc.id)){
      results.push({collection:"financial_ledger",id:doc.id,data:doc.data()||{}});
    }
  }
  return results.slice(0,50);
}

async function recentIssues(db){
  const [purchases,giftOps,walletOps]=await Promise.all([
    db.collection("google_play_purchases").limit(50).get(),
    db.collection("gift_operations").limit(50).get(),
    db.collection("wallet_operations").limit(50).get(),
  ]);
  const issues=[];
  for(const doc of purchases.docs){
    const data=doc.data()||{};
    const status=clean(data.status);
    if(
      (status&&status!=="credited") ||
      data.consumeRetryRequired===true ||
      (clean(data.refundState)&&clean(data.refundState)!=="none") ||
      (clean(data.disputeState)&&clean(data.disputeState)!=="none")
    ){
      issues.push({collection:"google_play_purchases",id:doc.id,data});
    }
  }
  for(const [collection,snap] of [["gift_operations",giftOps],["wallet_operations",walletOps]]){
    for(const doc of snap.docs){
      const data=doc.data()||{};
      const status=clean(data.status);
      if(status&&status!=="completed")issues.push({collection,id:doc.id,data});
    }
  }
  return issues.slice(0,50);
}


async function cycleQualifiedDays(db,hostUid,cycleKey){
  const parts=clean(cycleKey).match(/^(\\d{4}-\\d{2})-C([12])$/);
  if(!parts)throw Error("invalid_cycle");
  const month=parts[1], cycle=parts[2];
  const start=month+"-"+(cycle==="1"?"01":"16");
  const [year,mon]=month.split("-").map(Number);
  const endDay=cycle==="1"?15:new Date(Date.UTC(year,mon,0)).getUTCDate();
  const end=month+"-"+String(endDay).padStart(2,"0");
  const snap=await db.collection("host_mic_activity").doc(hostUid).collection("days")
    .where("day",">=",start).where("day","<=",end).get();
  return snap.docs.reduce((count,doc)=>count+((doc.data()||{}).qualified===true?1:0),0);
}
export async function settleAgencyCycle(db,actorUid,accrualId){
  const accrualRef=db.collection("agency_settlement_accruals").doc(accrualId);
  const initial=await accrualRef.get();
  if(!initial.exists)throw Error("settlement_not_found");
  const raw=initial.data()||{};
  if(clean(raw.status)==="settled"){
    const existing=await db.collection("agency_settlements").doc(accrualId).get();
    return {alreadySettled:true,settlement:existing.exists?existing.data():raw};
  }
  const agencyId=clean(raw.agencyId), hostUid=clean(raw.hostUid), cycleKey=clean(raw.cycleKey), month=clean(raw.month);
  if(!agencyId||!hostUid||!cycleKey||!month)throw Error("invalid_settlement");

  const [economySnap,hostSnap,monthStats]=await Promise.all([
    db.collection("system_config").doc("gift_economy").get(),
    db.collection("users").doc(hostUid).get(),
    db.collection("agency_support_stats").doc(agencyId).collection("monthly").doc(month).get(),
  ]);
  if(!hostSnap.exists)throw Error("user_not_found");
  const economy=economySnap.exists?(economySnap.data()||{}):{};
  const host=hostSnap.data()||{};
  const monthlyGross=clean(host.giftRevenueMonth)===month
    ?Math.max(0,Number(host.giftRevenueMonthCoins||0))
    :Math.max(0,Number(raw.supportCoins||0));
  const qualifiedDays=await cycleQualifiedDays(db,hostUid,cycleKey);
  const activeHosts=Array.isArray(monthStats.data()?.activeHostIds)
    ?monthStats.data().activeHostIds.length
    :0;
  const settlementMath=calculateAgencyCycleSettlement(economy,{
    monthlyGrossCoins:monthlyGross,
    supportCoins:Math.max(0,Number(raw.supportCoins||0)),
    qualifiedDays,
    activeHostCount:activeHosts,
    hasAgency:true,
  });
  const {
    tierId,
    hostBaseShareBps,
    hostBonusBps,
    hostShareBps,
    agencyBaseShareBps,
    agencyBonusBps,
    agencyShareBps,
    activityPayoutBps:payoutBps,
    supportCoins,
    hostGrossCoins:hostGross,
    agencyGrossCoins:agencyGross,
    hostPayableCoins,
    agencyPayableCoins,
    platformCoins,
  }=settlementMath;
  const coinsPerDiamond=Math.max(1,Number(economy.coinsPerDiamond||10000));
  const settlementRef=db.collection("agency_settlements").doc(accrualId);
  const auditRef=db.collection("admin_audit_logs").doc();
  const ledgerRef=db.collection("financial_ledger").doc("agency_settlement_"+accrualId);

  const result=await db.runTransaction(async tx=>{
    const current=await tx.get(accrualRef);
    if(!current.exists)throw Error("settlement_not_found");
    if(clean(current.data()?.status)==="settled"){
      const existing=await tx.get(settlementRef);
      return {alreadySettled:true,settlement:existing.exists?existing.data():current.data()};
    }
    const currentHost=await tx.get(db.collection("users").doc(hostUid));
    if(!currentHost.exists)throw Error("user_not_found");
    const currentData=currentHost.data()||{};
    const currentPending=Math.max(0,Number(currentData.pendingAgencyGiftEarningCoins||0));
    const currentAccrual=current.data()||{};
    const cycleAccruedHostCoins=Math.max(
      0,
      Number(currentAccrual.hostGrossEarningCoins||0),
    );
    const pendingToClear=Math.min(currentPending,cycleAccruedHostCoins);
    const conversion=convertPayableCoinsToDiamonds(
      currentData.pendingGiftEarningCoins,
      hostPayableCoins,
      coinsPerDiamond,
    );
    const currentDiamonds=conversion.diamondsEarned;
    const currentRemainder=conversion.remainderCoins;
    const settlement={
      agencyId,hostUid,cycleKey,month,supportCoins,tierId,
      qualifiedDays,activityPayoutBps:payoutBps,
      hostBaseShareBps,hostBonusBps,hostShareBps,
      agencyBaseShareBps,agencyBonusBps,agencyShareBps,
      hostGrossCoins:hostGross,agencyGrossCoins:agencyGross,
      hostPayableCoins,agencyPayableCoins,platformCoins,
      provisionalHostAccruedCoins:cycleAccruedHostCoins,
      hostAccrualAdjustmentCoins:hostGross-cycleAccruedHostCoins,
      pendingAgencyClearedCoins:pendingToClear,
      hostDiamonds:currentDiamonds,
      hostRemainderCoins:currentRemainder,
      status:"settled",settledBy:actorUid,
      policyMode:"tiered_host_agency",
    };
    tx.update(db.collection("users").doc(hostUid),{
      pendingAgencyGiftEarningCoins:Math.max(0,currentPending-pendingToClear),
      pendingGiftEarningCoins:currentRemainder,
      diamonds:Math.max(0,Number(currentData.diamonds||0))+currentDiamonds,
      giftDiamondsLifetime:FieldValue.increment(currentDiamonds),
    });
    tx.set(settlementRef,{...settlement,settledAt:FieldValue.serverTimestamp()},{merge:false});
    tx.set(accrualRef,{status:"settled",settledAt:FieldValue.serverTimestamp(),settledBy:actorUid,settlementId:accrualId},{merge:true});
    tx.create(ledgerRef,{
      userId:hostUid,agencyId,asset:"diamonds",delta:currentDiamonds,
      openingBalance:Math.max(0,Number(currentData.diamonds||0)),
      closingBalance:Math.max(0,Number(currentData.diamonds||0))+currentDiamonds,
      payableCoins:hostPayableCoins,
      remainderCoins:currentRemainder,
      provisionalHostAccruedCoins:cycleAccruedHostCoins,
      pendingAgencyClearedCoins:pendingToClear,
      reason:"agency_cycle_settlement",sourceType:"agency_settlement",sourceId:accrualId,
      settlementCycleKey:cycleKey,idempotencyKey:"agency_settlement_"+accrualId,
      createdAt:FieldValue.serverTimestamp(),
    });
    tx.create(auditRef,{
      actorUid,action:"settleAgencyCycle",targetType:"agency_settlement",targetId:accrualId,
      after:settlement,createdAt:FieldValue.serverTimestamp(),
    });
    return {alreadySettled:false,settlement};
  });
  return result;
}

export default async function handler(req,res){
  if(cors(req,res))return;
  if(req.method!=="POST")return out(res,405,{ok:false,code:"method_not_allowed"});
  try{
    initFirebase();
    const {uid,db,isOwner,canAdjustBalances,canManageSettlements}=await actor(req);
    const action=clean(req.body?.action);

    if(action==="state"){
      const lock=await db.collection("system_config").doc("emergency_lock").get();
      return out(res,200,{
        ok:true,
        isOwner,
        canAdjustBalances,
        emergencyLock:normalizeLock(lock.exists?lock.data():{}),
      });
    }

    if(action==="setEmergencyLock"){
      if(!isOwner)throw Error("owner_required");
      const economyLocked=req.body?.economyLocked===true||req.body?.enabled===true;
      const rechargeLocked=req.body?.rechargeLocked===true;
      const giftsLocked=req.body?.giftsLocked===true;
      const transfersLocked=req.body?.transfersLocked===true;
      const reason=clean(req.body?.reason);
      if(reason.length<3||reason.length>240)throw Error("invalid_reason");
      const ref=db.collection("system_config").doc("emergency_lock");
      const before=await ref.get();
      const after={
        enabled:economyLocked,
        economyLocked,
        rechargeLocked,
        giftsLocked,
        transfersLocked,
        reason,
      };
      const auditRef=db.collection("admin_audit_logs").doc();
      await db.runTransaction(async tx=>{
        tx.set(ref,{
          ...after,
          updatedBy:uid,
          updatedAt:FieldValue.serverTimestamp(),
        },{merge:true});
        tx.create(auditRef,{
          actorUid:uid,
          action:"updateEconomyLocks",
          targetType:"system_config",
          targetId:"emergency_lock",
          reason,
          before:before.exists?normalizeLock(before.data()||{}):normalizeLock({}),
          after,
          createdAt:FieldValue.serverTimestamp(),
        });
      });
      return out(res,200,{ok:true,emergencyLock:after});
    }

    if(action==="searchUser"){
      const user=await findUser(db,req.body?.query);
      const ledger=await userLedger(db,user.uid);
      return out(res,200,{ok:true,user,ledger,canAdjustBalances});
    }

    if(action==="searchOperation"){
      const operations=await searchOperations(db,req.body?.query);
      return out(res,200,{ok:true,operations});
    }

    if(action==="recentIssues"){
      const issues=await recentIssues(db);
      return out(res,200,{ok:true,issues});
    }

    if(action==="settleAgencyCycle"){
      if(!canManageSettlements)throw Error("settlement_forbidden");
      const accrualId=clean(req.body?.accrualId);
      if(!/^[A-Za-z0-9_-]{3,500}$/.test(accrualId))throw Error("invalid_settlement");
      const result=await settleAgencyCycle(db,uid,accrualId);
      return out(res,200,{ok:true,...result});
    }

    return out(res,400,{ok:false,code:"invalid_action"});
  }catch(error){
    const code=clean(error?.message)||"server_error";
    const status=code==="unauthorized"?401:
      ["forbidden","owner_required","settlement_forbidden"].includes(code)?403:
      ["user_not_found","settlement_not_found"].includes(code)?404:
      ["invalid_query","invalid_reason","invalid_action","invalid_cycle","invalid_settlement"].includes(code)?400:500;
    return out(res,status,{ok:false,code});
  }
}
