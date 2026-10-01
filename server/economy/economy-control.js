import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { calculateAgencyMonthlyBonus, convertPayableCoinsToDiamonds } from "./economy-policy.js";
import { economyPermissions } from "./economy-permissions.js";
import {
  agencyFinancialInteger,
  assertAgencySettlementMonthClosed,
  calculateAgencyMonthEndSurplusFromSnapshot,
  resolveAgencySurplusPolicy,
  validateAgencySettlementTotals,
  hostActivityBonusForTarget,
  agencyPerformanceBonusForTarget,
} from "./agency-policy.js";

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
    canSettleAgency:permissions.canSettleAgency,
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



const AGENCY_MONTHLY_ACCRUAL_SHARDS=32;

function agencyMonthlyShardRefs(db,agencyId,month){
  return Array.from({length:AGENCY_MONTHLY_ACCRUAL_SHARDS},(_,index)=>
    db.collection("agency_monthly_accrual_shards")
      .doc(agencyId+"__"+month+"__"+String(index).padStart(2,"0"))
  );
}

function effectiveAgencyBonusPolicy(economy={},override={}){
  return {
    ...economy,
    agencyPerformanceBonusBps:
      override.agencyPerformanceBonusBps ??
      economy.agencyPerformanceBonusBps,
    agencyBonusActiveHosts:
      override.agencyBonusActiveHosts ??
      economy.agencyBonusActiveHosts,
  };
}

function agencyMonthlyActiveHostCount(data={}){
  const fallback=Array.isArray(data.activeHostIds)
    ? data.activeHostIds.length
    : 0;
  return agencyFinancialInteger(
    data.activeHostCount ?? fallback,
    "active_host_count",
  );
}

function assertSettledAgencyStatementConsistency({
  statement,
  ledger,
  bonusAccrual,
  agencyId,
  month,
  statementId,
  ledgerId,
  coinsPerDiamond,
}){
  if(
    clean(statement.status)!=="settled" ||
    clean(statement.agencyId)!==agencyId ||
    clean(statement.month)!==month ||
    clean(statement.ledgerId)!==ledgerId ||
    clean(statement.hostSalaryMode)!=="target_immediate" ||
    statement.hostSalaryRepaidAtMonthEnd!==false ||
    Number(statement.shardCount)!==AGENCY_MONTHLY_ACCRUAL_SHARDS ||
    Number(statement.coinsPerDiamond)!==coinsPerDiamond
  ){
    throw Error("settlement_state_conflict");
  }

  const totals=validateAgencySettlementTotals({
    supportCoins:statement.supportCoins,
    hostShareCoins:statement.hostShareCoins,
    agencyShareCoins:statement.agencyShareCoins,
    platformShareCoins:statement.platformShareCoins,
    giftCount:statement.giftCount,
  });
  const paidDiamonds=agencyFinancialInteger(
    statement.agencyDiamonds || 0,
    "statement_diamonds",
  );
  const agencyBonusCoins=agencyFinancialInteger(
    statement.agencyBonusCoins || 0,
    "statement_bonus_coins",
  );
  const agencyPayableCoins=agencyFinancialInteger(
    statement.agencyPayableCoins ?? totals.agencyShareCoins,
    "statement_payable_coins",
  );
  const platformAfterAgencyBonusCoins=agencyFinancialInteger(
    statement.platformAfterAgencyBonusCoins ?? totals.platformShareCoins,
    "statement_platform_after_bonus_coins",
  );
  if(
    agencyPayableCoins!==totals.agencyShareCoins+agencyBonusCoins ||
    platformAfterAgencyBonusCoins+agencyBonusCoins!==totals.platformShareCoins ||
    totals.hostShareCoins+agencyPayableCoins+platformAfterAgencyBonusCoins!==totals.supportCoins
  ){
    throw Error("agency_bonus_settlement_invariant_failed");
  }
  const openingRemainderCoins=agencyFinancialInteger(
    statement.openingRemainderCoins || 0,
    "statement_opening_remainder_coins",
  );
  const remainderCoins=agencyFinancialInteger(
    statement.agencyRemainderCoins || 0,
    "statement_remainder_coins",
  );
  if(
    openingRemainderCoins>=coinsPerDiamond ||
    remainderCoins>=coinsPerDiamond
  ){
    throw Error("agency_remainder_invariant_failed");
  }

  if(
    clean(ledger.agencyId)!==agencyId ||
    clean(ledger.asset)!=="diamonds" ||
    clean(ledger.reason)!=="agency_monthly_share" ||
    clean(ledger.sourceType)!=="agency_monthly_statement" ||
    clean(ledger.sourceId)!==statementId ||
    clean(ledger.settlementMonth)!==month ||
    clean(ledger.idempotencyKey)!==ledgerId ||
    Number(ledger.coinsPerDiamond)!==coinsPerDiamond
  ){
    throw Error("settlement_ledger_conflict");
  }
  const ledgerDelta=agencyFinancialInteger(ledger.delta || 0,"ledger_delta");
  const ledgerPayableCoins=agencyFinancialInteger(
    ledger.payableCoins || 0,
    "ledger_payable_coins",
  );
  const ledgerOpeningRemainder=agencyFinancialInteger(
    ledger.openingRemainderCoins || 0,
    "ledger_opening_remainder_coins",
  );
  const ledgerRemainder=agencyFinancialInteger(
    ledger.remainderCoins || 0,
    "ledger_remainder_coins",
  );
  const openingBalance=agencyFinancialInteger(
    ledger.openingBalance || 0,
    "ledger_opening_balance",
  );
  const closingBalance=agencyFinancialInteger(
    ledger.closingBalance || 0,
    "ledger_closing_balance",
  );
  if(
    ledgerDelta!==paidDiamonds ||
    ledgerPayableCoins!==agencyPayableCoins ||
    agencyFinancialInteger(
      ledger.baseAgencyShareCoins ?? totals.agencyShareCoins,
      "ledger_base_agency_share_coins",
    )!==totals.agencyShareCoins ||
    agencyFinancialInteger(
      ledger.agencyBonusCoins ?? agencyBonusCoins,
      "ledger_bonus_coins",
    )!==agencyBonusCoins ||
    agencyFinancialInteger(
      ledger.platformAfterAgencyBonusCoins ?? platformAfterAgencyBonusCoins,
      "ledger_platform_after_bonus_coins",
    )!==platformAfterAgencyBonusCoins ||
    ledgerOpeningRemainder!==openingRemainderCoins ||
    ledgerRemainder!==remainderCoins ||
    closingBalance-openingBalance!==paidDiamonds
  ){
    throw Error("settlement_ledger_conflict");
  }

  if(
    clean(bonusAccrual.agencyId)!==agencyId ||
    clean(bonusAccrual.month)!==month ||
    clean(bonusAccrual.status)!=="settled" ||
    clean(bonusAccrual.statementId)!==statementId ||
    clean(bonusAccrual.ledgerId)!==ledgerId ||
    agencyFinancialInteger(
      bonusAccrual.supportCoins || 0,
      "bonus_accrual_support_coins",
    )!==totals.supportCoins ||
    agencyFinancialInteger(
      bonusAccrual.agencyBaseShareCoins || 0,
      "bonus_accrual_base_share_coins",
    )!==totals.agencyShareCoins ||
    agencyFinancialInteger(
      bonusAccrual.bonusCoins || 0,
      "bonus_accrual_bonus_coins",
    )!==agencyBonusCoins ||
    agencyFinancialInteger(
      bonusAccrual.agencyPayableCoins || 0,
      "bonus_accrual_payable_coins",
    )!==agencyPayableCoins ||
    agencyFinancialInteger(
      bonusAccrual.platformAfterAgencyBonusCoins || 0,
      "bonus_accrual_platform_after_bonus_coins",
    )!==platformAfterAgencyBonusCoins ||
    Number(bonusAccrual.activeHostCount)!==Number(statement.agencyActiveHostCount) ||
    Number(bonusAccrual.requiredActiveHosts)!==Number(statement.agencyRequiredActiveHosts) ||
    Boolean(bonusAccrual.eligible)!==Boolean(statement.agencyBonusEligible) ||
    Number(bonusAccrual.bonusBps)!==Number(statement.agencyBonusBps) ||
    clean(bonusAccrual.policySource)!==clean(statement.bonusPolicySource)
  ){
    throw Error("settlement_bonus_accrual_conflict");
  }
}



async function ensureAgencyShareSettlementNotification(
  db,
  agencyId,
  month,
  now=new Date(),
){
  const statementId=agencyId+"__"+month;
  const notificationRef=db.collection("notifications")
    .doc("agency_share_settlement_"+statementId);
  const agencyRef=db.collection("agencies").doc(agencyId);
  const statementRef=db.collection("agency_monthly_statements").doc(statementId);

  return db.runTransaction(async tx=>{
    const [notificationSnap,agencySnap,statementSnap]=await Promise.all([
      tx.get(notificationRef),
      tx.get(agencyRef),
      tx.get(statementRef),
    ]);
    if(notificationSnap.exists){
      return {notified:false,duplicate:true};
    }
    if(
      !agencySnap.exists ||
      !statementSnap.exists ||
      clean(statementSnap.data()?.status)!=="settled"
    ){
      return {notified:false,pending:true};
    }
    const ownerUid=clean(agencySnap.data()?.ownerUid);
    if(!ownerUid)return {notified:false,pending:true};
    const statement=statementSnap.data()||{};
    const baseShareCoins=agencyFinancialInteger(
      statement.agencyBaseShareCoins??statement.agencyShareCoins??0,
      "share_notification_base_coins",
    );
    const diamondsEarned=agencyFinancialInteger(
      statement.agencyDiamonds||0,
      "share_notification_diamonds",
    );
    const carryoverCoins=agencyFinancialInteger(
      statement.agencyRemainderCoins||0,
      "share_notification_carryover",
    );

    tx.create(notificationRef,{
      userId:ownerUid,
      type:"agency_share_settlement_paid",
      category:"system",
      title:"تمت إضافة Agency Share",
      body:
        "الشهر "+month+
        " • Agency Share: "+String(baseShareCoins)+" Coins"+
        " • المضاف للمحفظة: "+String(diamondsEarned)+" Diamonds"+
        " • Carryover: "+String(carryoverCoins)+" Coins",
      read:false,
      mandatory:true,
      financial:true,
      agencyId,
      month,
      agencyBaseShareCoins:baseShareCoins,
      agencyDiamondsAdded:diamondsEarned,
      agencyCarryoverCoins:carryoverCoins,
      createdAt:now,
    });
    return {notified:true,ownerUid};
  });
}

async function maybeNotifyAgencyMonthSettlement(
  db,
  agencyId,
  month,
  now=new Date(),
){
  const statementId=agencyId+"__"+month;
  const notificationRef=db.collection("notifications")
    .doc("agency_monthly_settlement_"+statementId);
  const agencyRef=db.collection("agencies").doc(agencyId);
  const statementRef=db.collection("agency_monthly_statements").doc(statementId);
  const bonusRef=db.collection("agency_bonus_accruals").doc(statementId);
  const walletRef=db.collection("agency_wallets").doc(agencyId);
  const completionRef=db.collection("agency_host_settlement_completions")
    .doc(statementId);

  return db.runTransaction(async tx=>{
    const [
      notificationSnap,
      agencySnap,
      statementSnap,
      bonusSnap,
      walletSnap,
      completionSnap,
    ]=await Promise.all([
      tx.get(notificationRef),
      tx.get(agencyRef),
      tx.get(statementRef),
      tx.get(bonusRef),
      tx.get(walletRef),
      tx.get(completionRef),
    ]);
    if(notificationSnap.exists){
      return {notified:false,duplicate:true};
    }
    if(
      !agencySnap.exists ||
      !statementSnap.exists ||
      clean(statementSnap.data()?.status)!=="settled" ||
      !completionSnap.exists ||
      clean(completionSnap.data()?.status)!=="complete"
    ){
      return {notified:false,pending:true};
    }
    const ownerUid=clean(agencySnap.data()?.ownerUid);
    if(!ownerUid)return {notified:false,pending:true};

    const statement=statementSnap.data()||{};
    const bonus=bonusSnap.exists?(bonusSnap.data()||{}):{};
    const wallet=walletSnap.exists?(walletSnap.data()||{}):{};
    const baseShareCoins=agencyFinancialInteger(
      statement.agencyBaseShareCoins??statement.agencyShareCoins??0,
      "notification_base_share_coins",
    );
    const performanceBonusCoins=agencyFinancialInteger(
      bonus.perHostBonusCoins||0,
      "notification_performance_bonus_coins",
    );
    const carryoverCoins=agencyFinancialInteger(
      wallet.remainderCoins||0,
      "notification_carryover_coins",
    );
    const eligibleHostCount=agencyFinancialInteger(
      bonus.perHostEligibleHostCount||0,
      "notification_eligible_host_count",
    );

    tx.create(notificationRef,{
      userId:ownerUid,
      type:"agency_monthly_settlement_summary",
      category:"system",
      title:"تم إغلاق تسوية الوكالة الشهرية",
      body:
        "الشهر "+month+
        " • Agency Share: "+String(baseShareCoins)+" Coins"+
        " • Agency Bonus: "+String(performanceBonusCoins)+" Coins"+
        " • Carryover: "+String(carryoverCoins)+" Coins",
      read:false,
      mandatory:true,
      financial:true,
      agencyId,
      month,
      agencyBaseShareCoins:baseShareCoins,
      agencyPerformanceBonusCoins:performanceBonusCoins,
      agencyPerformanceEligibleHostCount:eligibleHostCount,
      agencyCarryoverCoins:carryoverCoins,
      createdAt:now,
    });
    return {notified:true,ownerUid};
  });
}

async function markAgencyHostSettlementsComplete(
  db,
  actorUid,
  agencyId,
  month,
  now=new Date(),
){
  const statementId=agencyId+"__"+month;
  await db.collection("agency_host_settlement_completions")
    .doc(statementId)
    .set({
      agencyId,
      month,
      status:"complete",
      completedBy:actorUid,
      completedAt:now,
    },{merge:true});
  return maybeNotifyAgencyMonthSettlement(db,agencyId,month,now);
}

export async function settleAgencyMonth(db,actorUid,agencyIdInput,monthInput,options={}){
  const agencyId=clean(agencyIdInput);
  if(!/^[A-Za-z0-9_-]{3,180}$/.test(agencyId)){
    throw Error("invalid_settlement");
  }
  const month=assertAgencySettlementMonthClosed(
    monthInput,
    options.now ?? new Date(),
  );

  const statementId=agencyId+"__"+month;
  const settlementRef=db.collection("agency_monthly_statements").doc(statementId);
  const economyRef=db.collection("system_config").doc("gift_economy");
  const overrideRef=db.collection("agency_policy_overrides").doc(agencyId);
  const walletRef=db.collection("agency_wallets").doc(agencyId);
  const auditRef=db.collection("admin_audit_logs").doc();
  const ledgerId="agency_monthly_share_"+statementId;
  const ledgerRef=db.collection("financial_ledger").doc(ledgerId);
  const bonusAccrualRef=db.collection("agency_bonus_accruals").doc(statementId);
  const activityRef=db.collection("agency_support_stats")
    .doc(agencyId)
    .collection("monthly")
    .doc(month);
  const shardRefs=agencyMonthlyShardRefs(db,agencyId,month);

  const settlementResult=await db.runTransaction(async tx=>{
    const [existing,existingLedger,existingBonusAccrual]=await Promise.all([
      tx.get(settlementRef),
      tx.get(ledgerRef),
      tx.get(bonusAccrualRef),
    ]);
    if(existing.exists){
      const statement=existing.data()||{};
      if(!existingLedger.exists){
        throw Error("settlement_ledger_missing");
      }
      if(!existingBonusAccrual.exists){
        throw Error("settlement_bonus_accrual_missing");
      }
      const historicalCoinsPerDiamond=agencyFinancialInteger(
        statement.coinsPerDiamond,
        "statement_coins_per_diamond",
      );
      if(historicalCoinsPerDiamond<=0){
        throw Error("invalid_agency_financial_coins_per_diamond");
      }
      assertSettledAgencyStatementConsistency({
        statement,
        ledger:existingLedger.data()||{},
        bonusAccrual:existingBonusAccrual.data()||{},
        agencyId,
        month,
        statementId,
        ledgerId,
        coinsPerDiamond:historicalCoinsPerDiamond,
      });
      return {alreadySettled:true,settlement:statement};
    }
    if(existingLedger.exists){
      throw Error("settlement_ledger_conflict");
    }
    if(existingBonusAccrual.exists){
      const existingBonusData=existingBonusAccrual.data()||{};
      if(
        clean(existingBonusData.statementId) ||
        clean(existingBonusData.ledgerId) ||
        clean(existingBonusData.status)==="settled"
      ){
        throw Error("settlement_bonus_accrual_conflict");
      }
    }

    const [
      economySnap,
      overrideSnap,
      walletSnap,
      activitySnap,
      ...shardSnaps
    ]=await Promise.all([
      tx.get(economyRef),
      tx.get(overrideRef),
      tx.get(walletRef),
      tx.get(activityRef),
      ...shardRefs.map(ref=>tx.get(ref)),
    ]);
    const economy=economySnap.exists?(economySnap.data()||{}):{};
    const agencyOverride=overrideSnap.exists?(overrideSnap.data()||{}):{};
    const bonusOverrideApplied=
      Object.prototype.hasOwnProperty.call(
        agencyOverride,
        "agencyPerformanceBonusBps",
      ) ||
      Object.prototype.hasOwnProperty.call(
        agencyOverride,
        "agencyBonusActiveHosts",
      );
    const bonusPolicy=effectiveAgencyBonusPolicy(
      economy,
      agencyOverride,
    );
    const coinsPerDiamond=agencyFinancialInteger(
      economy.coinsPerDiamond ?? 10000,
      "coins_per_diamond",
    );
    if(coinsPerDiamond<=0){
      throw Error("invalid_agency_financial_coins_per_diamond");
    }

    const rawTotals=shardSnaps.reduce((sum,snap)=>{
      if(!snap.exists)return sum;
      const data=snap.data()||{};
      sum.supportCoins+=agencyFinancialInteger(
        data.supportCoins || 0,
        "support_coins",
      );
      sum.hostShareCoins+=agencyFinancialInteger(
        data.hostShareCoins || 0,
        "host_share_coins",
      );
      sum.agencyShareCoins+=agencyFinancialInteger(
        data.agencyShareCoins || 0,
        "agency_share_coins",
      );
      sum.platformShareCoins+=agencyFinancialInteger(
        data.platformShareCoins || 0,
        "platform_share_coins",
      );
      sum.giftCount+=agencyFinancialInteger(
        data.giftCount || 0,
        "gift_count",
      );
      return sum;
    },{supportCoins:0,hostShareCoins:0,agencyShareCoins:0,platformShareCoins:0,giftCount:0});
    const totals=validateAgencySettlementTotals(rawTotals);
    if(totals.giftCount<=0&&totals.supportCoins<=0){
      throw Error("settlement_not_found");
    }

    const activity=activitySnap.exists?(activitySnap.data()||{}):{};
    const activeHostCount=agencyMonthlyActiveHostCount(activity);
    const bonus=calculateAgencyMonthlyBonus(
      bonusPolicy,
      {
        supportCoins:totals.supportCoins,
        activeHostCount,
        hasAgency:true,
      },
    );
    const agencyBonusCoins=agencyFinancialInteger(
      bonus.agencyBonusCoins,
      "bonus_coins",
    );
    const agencyPayableCoins=totals.agencyShareCoins+agencyBonusCoins;
    if(!Number.isSafeInteger(agencyPayableCoins)){
      throw Error("invalid_agency_financial_payable_coins");
    }
    const platformAfterAgencyBonusCoins=
      totals.platformShareCoins-agencyBonusCoins;
    if(
      platformAfterAgencyBonusCoins<0 ||
      totals.hostShareCoins+
        agencyPayableCoins+
        platformAfterAgencyBonusCoins!==totals.supportCoins
    ){
      throw Error("agency_bonus_settlement_invariant_failed");
    }

    const wallet=walletSnap.exists?(walletSnap.data()||{}):{};
    const currentDiamonds=agencyFinancialInteger(
      wallet.diamonds || 0,
      "wallet_diamonds",
    );
    const previousRemainderCoins=agencyFinancialInteger(
      wallet.remainderCoins || 0,
      "wallet_remainder_coins",
    );
    const currentLifetimeDiamonds=agencyFinancialInteger(
      wallet.lifetimeDiamonds ?? currentDiamonds,
      "wallet_lifetime_diamonds",
    );
    if(
      previousRemainderCoins>=coinsPerDiamond ||
      currentLifetimeDiamonds<currentDiamonds
    ){
      throw Error("agency_remainder_invariant_failed");
    }

    const conversion=convertPayableCoinsToDiamonds(
      previousRemainderCoins,
      agencyPayableCoins,
      coinsPerDiamond,
    );
    const diamondsEarned=agencyFinancialInteger(
      conversion.diamondsEarned,
      "diamonds_earned",
    );
    const remainderCoins=agencyFinancialInteger(
      conversion.remainderCoins,
      "remainder_coins",
    );
    if(remainderCoins>=coinsPerDiamond){
      throw Error("agency_remainder_invariant_failed");
    }
    const closingDiamonds=currentDiamonds+diamondsEarned;
    const closingLifetimeDiamonds=currentLifetimeDiamonds+diamondsEarned;
    if(
      !Number.isSafeInteger(closingDiamonds) ||
      !Number.isSafeInteger(closingLifetimeDiamonds)
    ){
      throw Error("invalid_agency_financial_closing_diamonds");
    }

    const statement={
      agencyId,
      month,
      ...totals,
      agencyBaseShareCoins:totals.agencyShareCoins,
      agencyBonusEligible:bonus.eligible,
      agencyBonusBps:bonus.agencyBonusBps,
      agencyBonusCoins,
      agencyPayableCoins,
      agencyActiveHostCount:activeHostCount,
      agencyRequiredActiveHosts:bonus.requiredActiveHosts,
      platformAfterAgencyBonusCoins,
      bonusPolicySource:bonusOverrideApplied?"agency_override":"global",
      bonusAccrualId:statementId,
      shardCount:AGENCY_MONTHLY_ACCRUAL_SHARDS,
      coinsPerDiamond,
      openingRemainderCoins:previousRemainderCoins,
      agencyDiamonds:diamondsEarned,
      agencyRemainderCoins:remainderCoins,
      ledgerId,
      hostSalaryMode:"target_immediate",
      hostSalaryRepaidAtMonthEnd:false,
      status:"settled",
      settledBy:actorUid,
    };

    tx.set(walletRef,{
      agencyId,
      diamonds:closingDiamonds,
      remainderCoins,
      lifetimeDiamonds:closingLifetimeDiamonds,
      updatedAt:FieldValue.serverTimestamp(),
    },{merge:true});
    tx.set(bonusAccrualRef,{
      agencyId,
      month,
      supportCoins:totals.supportCoins,
      agencyBaseShareCoins:totals.agencyShareCoins,
      activeHostCount,
      requiredActiveHosts:bonus.requiredActiveHosts,
      eligible:bonus.eligible,
      bonusBps:bonus.agencyBonusBps,
      bonusCoins:agencyBonusCoins,
      agencyPayableCoins,
      platformAfterAgencyBonusCoins,
      policySource:bonusOverrideApplied?"agency_override":"global",
      status:"settled",
      statementId,
      ledgerId,
      createdAt:FieldValue.serverTimestamp(),
    },{merge:true});
    tx.create(settlementRef,{
      ...statement,
      settledAt:FieldValue.serverTimestamp(),
    });
    tx.create(ledgerRef,{
      agencyId,
      asset:"diamonds",
      delta:diamondsEarned,
      openingBalance:currentDiamonds,
      closingBalance:closingDiamonds,
      payableCoins:agencyPayableCoins,
      baseAgencyShareCoins:totals.agencyShareCoins,
      agencyBonusCoins,
      platformAfterAgencyBonusCoins,
      openingRemainderCoins:previousRemainderCoins,
      remainderCoins,
      coinsPerDiamond,
      reason:"agency_monthly_share",
      sourceType:"agency_monthly_statement",
      sourceId:statementId,
      settlementMonth:month,
      idempotencyKey:ledgerId,
      createdAt:FieldValue.serverTimestamp(),
    });
    tx.create(auditRef,{
      actorUid,
      action:"settleAgencyMonth",
      targetType:"agency_monthly_statement",
      targetId:statementId,
      after:statement,
      createdAt:FieldValue.serverTimestamp(),
    });
    return {alreadySettled:false,settlement:statement};
  });
  await ensureAgencyShareSettlementNotification(
    db,
    agencyId,
    month,
    options.now??new Date(),
  );
  await maybeNotifyAgencyMonthSettlement(
    db,
    agencyId,
    month,
    options.now??new Date(),
  );
  return settlementResult;
}


const AGENCY_SURPLUS_PAGE_MAX=25;

function agencySurplusPageSize(value){
  const parsed=Number(value);
  if(!Number.isFinite(parsed))return 25;
  return Math.max(1,Math.min(AGENCY_SURPLUS_PAGE_MAX,Math.floor(parsed)));
}

function agencySurplusPagePrefix(agencyId,month){
  return agencyId+"__"+month+"__";
}

function validateFrozenAgencySurplusPolicy(data,agencyId,month){
  const snapshotId=agencyId+"__"+month;
  const expectedMode=
    data.surplusToShadow===true
      ?"shadow_profit"
      :data.surplusToShadow===false
        ?"host_wallet_coins"
        :"";
  if(
    clean(data.status)!=="frozen" ||
    clean(data.agencyId)!==agencyId ||
    clean(data.month)!==month ||
    clean(data.snapshotId)!==snapshotId ||
    typeof data.surplusToShadow!=="boolean" ||
    clean(data.mode)!==expectedMode
  ){
    throw Error("agency_surplus_policy_snapshot_conflict");
  }
  return {
    agencyId,
    month,
    surplusToShadow:data.surplusToShadow,
    mode:expectedMode,
    snapshotId,
    agencyPerformanceBonusMode:"per_host_target_month_end",
    agencyPerformanceBonusBps:
      clean(data.agencyPerformanceBonusMode)==="per_host_target_month_end"
        ?Math.max(0,Math.min(3000,Number(data.agencyPerformanceBonusBps??100)))
        :100,
    coinsPerDiamond:Math.max(1,Number(data.coinsPerDiamond||10000)),
    requiredQualifiedDays:14,
  };
}

async function freezeAgencySurplusPolicy(db,actorUid,agencyId,month){
  const snapshotId=agencyId+"__"+month;
  const snapshotRef=db.collection("agency_surplus_policy_snapshots").doc(snapshotId);
  const overrideRef=db.collection("agency_policy_overrides").doc(agencyId);
  return db.runTransaction(async tx=>{
    const existing=await tx.get(snapshotRef);
    if(existing.exists){
      return validateFrozenAgencySurplusPolicy(
        existing.data()||{},
        agencyId,
        month,
      );
    }
    const economyRef=db.collection("system_config").doc("gift_economy");
    const [overrideSnap,economySnap]=await Promise.all([
      tx.get(overrideRef),
      tx.get(economyRef),
    ]);
    const override=overrideSnap.exists?(overrideSnap.data()||{}):{};
    const economy=economySnap.exists?(economySnap.data()||{}):{};
    const policy=resolveAgencySurplusPolicy(override);
    const overrideBonusIsNew=
      clean(override.agencyPerformanceBonusMode)==="per_host_target_month_end";
    const globalBonusIsNew=
      clean(economy.agencyPerformanceBonusMode)==="per_host_target_month_end";
    const agencyPerformanceBonusBps=overrideBonusIsNew
      ?Math.max(0,Math.min(3000,Number(override.agencyPerformanceBonusBps??100)))
      :globalBonusIsNew
        ?Math.max(0,Math.min(3000,Number(economy.agencyPerformanceBonusBps??100)))
        :100;
    const coinsPerDiamond=Math.max(1,Number(economy.coinsPerDiamond||10000));
    if(!policy.configured){
      throw Error("agency_surplus_policy_unconfigured");
    }
    const snapshot={
      agencyId,
      month,
      surplusToShadow:policy.surplusToShadow,
      mode:policy.mode,
      snapshotId,
      agencyPerformanceBonusMode:"per_host_target_month_end",
      agencyPerformanceBonusBps,
      coinsPerDiamond,
      requiredQualifiedDays:14,
    };
    tx.create(snapshotRef,{
      ...snapshot,
      frozenBy:actorUid,
      status:"frozen",
      createdAt:FieldValue.serverTimestamp(),
    });
    return snapshot;
  });
}

function assertAgencyHostSurplusReplay({
  settlement,
  ledger,
  agencyId,
  month,
  hostUid,
  settlementId,
  ledgerId,
  policySnapshot,
}){
  const progressCoins=agencyFinancialInteger(
    settlement.progressCoins||0,
    "surplus_settlement_progress_coins",
  );
  const targetThresholdCoins=agencyFinancialInteger(
    settlement.targetThresholdCoins||0,
    "surplus_settlement_target_threshold_coins",
  );
  const salaryPaidDiamonds=agencyFinancialInteger(
    settlement.salaryPaidDiamondsSnapshot||0,
    "surplus_settlement_salary_paid_diamonds",
  );
  const expected=calculateAgencyMonthEndSurplusFromSnapshot({
    progressCoins,
    targetThresholdCoins,
    surplusToShadow:policySnapshot.surplusToShadow,
  });
  const surplusCoins=agencyFinancialInteger(
    settlement.surplusCoins||0,
    "surplus_settlement_coins",
  );
  const hostWalletCoins=agencyFinancialInteger(
    settlement.hostWalletCoins||0,
    "surplus_settlement_host_wallet_coins",
  );
  const shadowProfitCoins=agencyFinancialInteger(
    settlement.shadowProfitCoins||0,
    "surplus_settlement_shadow_profit_coins",
  );
  const expectedHostWalletCoins=
    expected.destination==="host_wallet_coins"
      ?expected.surplusCoins
      :0;
  const expectedShadowProfitCoins=
    expected.destination==="shadow_profit"
      ?expected.surplusCoins
      :0;

  if(
    clean(settlement.status)!=="settled" ||
    clean(settlement.agencyId)!==agencyId ||
    clean(settlement.month)!==month ||
    clean(settlement.hostUid)!==hostUid ||
    clean(settlement.hostMonthlyId)!==settlementId ||
    clean(settlement.ledgerId)!==ledgerId ||
    clean(settlement.policySnapshotId)!==policySnapshot.snapshotId ||
    settlement.surplusToShadow!==policySnapshot.surplusToShadow ||
    clean(settlement.destination)!==expected.destination ||
    surplusCoins!==expected.surplusCoins ||
    hostWalletCoins!==expectedHostWalletCoins ||
    shadowProfitCoins!==expectedShadowProfitCoins ||
    clean(settlement.hostSalaryMode)!=="target_immediate" ||
    settlement.hostSalaryRepaidAtMonthEnd!==false
  ){
    throw Error("agency_surplus_settlement_conflict");
  }

  const expectedAccountType=
    expected.destination==="shadow_profit"
      ?"shadow_profit"
      :expected.destination==="host_wallet_coins"
        ?"host_wallet"
        :"none";
  const expectedReason=
    expected.destination==="shadow_profit"
      ?"agency_host_surplus_shadow_profit"
      :expected.destination==="host_wallet_coins"
        ?"agency_host_surplus_host_wallet"
        :"agency_host_surplus_none";

  if(
    clean(ledger.sourceType)!=="agency_surplus_settlement" ||
    clean(ledger.sourceId)!==settlementId ||
    clean(ledger.idempotencyKey)!==ledgerId ||
    clean(ledger.agencyId)!==agencyId ||
    clean(ledger.hostUid)!==hostUid ||
    clean(ledger.settlementMonth)!==month ||
    clean(ledger.asset)!=="coins" ||
    clean(ledger.accountType)!==expectedAccountType ||
    clean(ledger.reason)!==expectedReason ||
    agencyFinancialInteger(ledger.delta||0,"surplus_ledger_delta")!==surplusCoins ||
    agencyFinancialInteger(
      ledger.targetThresholdCoins||0,
      "surplus_ledger_target_threshold_coins",
    )!==targetThresholdCoins ||
    agencyFinancialInteger(
      ledger.progressCoins||0,
      "surplus_ledger_progress_coins",
    )!==progressCoins ||
    agencyFinancialInteger(
      ledger.salaryPaidDiamondsSnapshot||0,
      "surplus_ledger_salary_paid_diamonds",
    )!==salaryPaidDiamonds ||
    ledger.hostSalaryRepaidAtMonthEnd!==false
  ){
    throw Error("agency_surplus_ledger_conflict");
  }

  if(expected.destination==="host_wallet_coins"){
    const openingBalance=agencyFinancialInteger(
      ledger.openingBalance||0,
      "surplus_ledger_opening_balance",
    );
    const closingBalance=agencyFinancialInteger(
      ledger.closingBalance||0,
      "surplus_ledger_closing_balance",
    );
    if(
      clean(ledger.userId)!==hostUid ||
      closingBalance-openingBalance!==surplusCoins
    ){
      throw Error("agency_surplus_ledger_conflict");
    }
  }else if(
    ledger.userId!==null ||
    ledger.openingBalance!==null ||
    ledger.closingBalance!==null
  ){
    throw Error("agency_surplus_ledger_conflict");
  }
}

async function settleAgencyHostSurplus(
  db,
  actorUid,
  policySnapshot,
  hostMonthlyId,
){
  const agencyId=policySnapshot.agencyId;
  const month=policySnapshot.month;
  const monthlyRef=db.collection("agency_host_monthly").doc(hostMonthlyId);
  const settlementId=hostMonthlyId;
  const settlementRef=db.collection("agency_surplus_settlements").doc(settlementId);
  const ledgerId="agency_host_surplus_"+settlementId;
  const ledgerRef=db.collection("financial_ledger").doc(ledgerId);
  const hostBonusLedgerId="agency_host_activity_bonus_"+settlementId;
  const hostBonusLedgerRef=db.collection("financial_ledger").doc(hostBonusLedgerId);
  const bonusAccrualRef=db.collection("agency_bonus_accruals")
    .doc(agencyId+"__"+month);
  const auditRef=db.collection("admin_audit_logs").doc(
    "agency_host_surplus_"+settlementId,
  );

  return db.runTransaction(async tx=>{
    const [
      existing,
      existingLedger,
      existingHostBonusLedger,
      monthlySnap,
    ]=await Promise.all([
      tx.get(settlementRef),
      tx.get(ledgerRef),
      tx.get(hostBonusLedgerRef),
      tx.get(monthlyRef),
    ]);
    if(!monthlySnap.exists){
      throw Error("agency_host_month_not_found");
    }
    const monthly=monthlySnap.data()||{};
    const hostUid=clean(monthly.hostUid);
    const expectedPageKey=agencyId+"__"+month+"__"+hostUid;
    if(
      !hostUid ||
      clean(monthly.agencyId)!==agencyId ||
      clean(monthly.month)!==month ||
      clean(monthly.surplusPageKey)!==expectedPageKey ||
      hostMonthlyId!==expectedPageKey
    ){
      throw Error("agency_host_month_conflict");
    }

    if(existing.exists){
      if(!existingLedger.exists){
        throw Error("agency_surplus_ledger_missing");
      }
      const settlement=existing.data()||{};
      assertAgencyHostSurplusReplay({
        settlement,
        ledger:existingLedger.data()||{},
        agencyId,
        month,
        hostUid,
        settlementId,
        ledgerId,
        policySnapshot,
      });
      const hostBonusAmount=agencyFinancialInteger(
        settlement.hostActivityBonusAmount||0,
        "host_activity_bonus_amount",
      );
      if(hostBonusAmount>0&&!existingHostBonusLedger.exists){
        throw Error("agency_host_bonus_ledger_missing");
      }
      return {
        alreadySettled:true,
        hostUid,
        settlement,
      };
    }
    if(existingLedger.exists||existingHostBonusLedger.exists){
      throw Error("agency_surplus_ledger_conflict");
    }

    const progressCoins=agencyFinancialInteger(
      monthly.hostShareCoins||0,
      "surplus_host_share_coins",
    );
    const targetThresholdCoins=agencyFinancialInteger(
      monthly.targetThresholdCoins||0,
      "surplus_target_threshold_coins",
    );
    const salaryPaidDiamonds=agencyFinancialInteger(
      monthly.salaryPaidDiamonds||0,
      "surplus_salary_paid_diamonds",
    );
    const surplus=calculateAgencyMonthEndSurplusFromSnapshot({
      progressCoins,
      targetThresholdCoins,
      surplusToShadow:policySnapshot.surplusToShadow,
    });

    const qualifiedDays=agencyFinancialInteger(
      monthly.activityQualifiedDays||0,
      "activity_qualified_days",
    );
    const requiredQualifiedDays=14;
    const rawHostBonus=qualifiedDays>=requiredQualifiedDays
      ?hostActivityBonusForTarget(monthly)
      :{asset:"none",amount:0};
    const hostActivityBonusAmount=agencyFinancialInteger(
      rawHostBonus.amount||0,
      "host_activity_bonus_amount",
    );
    const hostActivityBonusAsset=
      hostActivityBonusAmount>0?clean(rawHostBonus.asset):"none";
    if(
      hostActivityBonusAmount>0 &&
      !["coins","diamonds"].includes(hostActivityBonusAsset)
    ){
      throw Error("invalid_host_activity_bonus_asset");
    }

    const agencyPerformanceBonus=agencyPerformanceBonusForTarget({
      targetThresholdCoins,
      qualifiedDays,
      bonusBps:policySnapshot.agencyPerformanceBonusBps,
      requiredQualifiedDays,
    });
    const agencyPerformanceBonusCoins=agencyFinancialInteger(
      agencyPerformanceBonus.bonusCoins||0,
      "agency_performance_bonus_coins",
    );

    const hostWalletCoins=
      surplus.destination==="host_wallet_coins"
        ?surplus.surplusCoins
        :0;
    const shadowProfitCoins=
      surplus.destination==="shadow_profit"
        ?surplus.surplusCoins
        :0;
    const hostBonusCoins=
      hostActivityBonusAsset==="coins"?hostActivityBonusAmount:0;
    const hostBonusDiamonds=
      hostActivityBonusAsset==="diamonds"?hostActivityBonusAmount:0;

    let userRef=null;
    let openingCoins=0;
    let surplusClosingCoins=0;
    let closingCoins=0;
    let openingDiamonds=0;
    let closingDiamonds=0;
    if(hostWalletCoins>0||hostActivityBonusAmount>0){
      userRef=db.collection("users").doc(hostUid);
      const userSnap=await tx.get(userRef);
      if(!userSnap.exists){
        throw Error("surplus_host_not_found");
      }
      const user=userSnap.data()||{};
      openingCoins=agencyFinancialInteger(
        user.coins??user.balance??0,
        "surplus_host_wallet_coins",
      );
      openingDiamonds=agencyFinancialInteger(
        user.diamonds||0,
        "host_bonus_wallet_diamonds",
      );
      surplusClosingCoins=openingCoins+hostWalletCoins;
      closingCoins=surplusClosingCoins+hostBonusCoins;
      closingDiamonds=openingDiamonds+hostBonusDiamonds;
      if(
        !Number.isSafeInteger(closingCoins) ||
        !Number.isSafeInteger(closingDiamonds)
      ){
        throw Error("invalid_agency_host_bonus_closing_balance");
      }
    }

    const settlement={
      agencyId,
      month,
      hostUid,
      hostMonthlyId,
      policySnapshotId:policySnapshot.snapshotId,
      surplusToShadow:policySnapshot.surplusToShadow,
      destination:surplus.destination,
      progressCoins:surplus.progressCoins,
      targetId:clean(monthly.targetId),
      targetTierId:clean(monthly.targetTierId),
      targetRank:clean(monthly.targetRank),
      targetThresholdCoins:surplus.completedTargetCoins,
      surplusCoins:surplus.surplusCoins,
      hostWalletCoins,
      shadowProfitCoins,
      salaryPaidDiamondsSnapshot:salaryPaidDiamonds,
      hostSalaryMode:"target_immediate",
      hostSalaryRepaidAtMonthEnd:false,
      activityQualifiedDays:qualifiedDays,
      activityRequiredQualifiedDays:requiredQualifiedDays,
      hostActivityBonusEligible:
        qualifiedDays>=requiredQualifiedDays&&hostActivityBonusAmount>0,
      hostActivityBonusAsset,
      hostActivityBonusAmount,
      hostActivityBonusLedgerId:
        hostActivityBonusAmount>0?hostBonusLedgerId:null,
      agencyPerformanceBonusEligible:agencyPerformanceBonus.eligible===true,
      agencyPerformanceBonusBps:agencyPerformanceBonus.bonusBps,
      agencyPerformanceBonusCoins,
      agencyPerformanceBonusDiamonds:0,
      agencyPerformanceBonusLedgerId:null,
      agencyPerformanceBonusPayoutMode:"aggregate_month_end",
      ledgerId,
      status:"settled",
      settledBy:actorUid,
    };

    if(userRef){
      const userUpdate={
        agencyActivityBonusLastMonth:month,
        agencyActivityBonusAsset:hostActivityBonusAsset,
        agencyActivityBonusAmount:hostActivityBonusAmount,
        walletUpdatedAt:FieldValue.serverTimestamp(),
      };
      if(hostWalletCoins>0||hostBonusCoins>0){
        userUpdate.coins=closingCoins;
      }
      if(hostBonusDiamonds>0){
        userUpdate.diamonds=closingDiamonds;
      }
      tx.update(userRef,userUpdate);
    }

    tx.update(monthlyRef,{
      surplusSettlementId:settlementId,
      surplusPolicySnapshotId:policySnapshot.snapshotId,
      surplusToShadow:policySnapshot.surplusToShadow,
      surplusMode:surplus.destination,
      surplusCoins:surplus.surplusCoins,
      surplusHostWalletCoins:hostWalletCoins,
      surplusShadowProfitCoins:shadowProfitCoins,
      hostActivityBonusAsset,
      hostActivityBonusAmount,
      hostActivityBonusEligible:settlement.hostActivityBonusEligible,
      agencyPerformanceBonusBps:settlement.agencyPerformanceBonusBps,
      agencyPerformanceBonusCoins,
      agencyPerformanceBonusDiamonds:0,
      agencyPerformanceBonusPayoutMode:"aggregate_month_end",
      bonusAccruedAt:FieldValue.serverTimestamp(),
      surplusSettledAt:FieldValue.serverTimestamp(),
    });
    tx.create(settlementRef,{
      ...settlement,
      settledAt:FieldValue.serverTimestamp(),
    });
    tx.create(ledgerRef,{
      agencyId,
      hostUid,
      userId:surplus.destination==="host_wallet_coins"?hostUid:null,
      accountType:
        surplus.destination==="shadow_profit"
          ?"shadow_profit"
          :surplus.destination==="host_wallet_coins"
            ?"host_wallet"
            :"none",
      asset:"coins",
      delta:surplus.surplusCoins,
      openingBalance:
        surplus.destination==="host_wallet_coins"
          ?openingCoins
          :null,
      closingBalance:
        surplus.destination==="host_wallet_coins"
          ?surplusClosingCoins
          :null,
      reason:
        surplus.destination==="shadow_profit"
          ?"agency_host_surplus_shadow_profit"
          :surplus.destination==="host_wallet_coins"
            ?"agency_host_surplus_host_wallet"
            :"agency_host_surplus_none",
      sourceType:"agency_surplus_settlement",
      sourceId:settlementId,
      settlementMonth:month,
      idempotencyKey:ledgerId,
      targetThresholdCoins:surplus.completedTargetCoins,
      progressCoins:surplus.progressCoins,
      salaryPaidDiamondsSnapshot:salaryPaidDiamonds,
      hostSalaryRepaidAtMonthEnd:false,
      createdAt:FieldValue.serverTimestamp(),
    });

    if(hostActivityBonusAmount>0){
      const bonusOpeningBalance=
        hostActivityBonusAsset==="coins"
          ?surplusClosingCoins
          :openingDiamonds;
      const bonusClosingBalance=
        hostActivityBonusAsset==="coins"
          ?closingCoins
          :closingDiamonds;
      tx.create(hostBonusLedgerRef,{
        agencyId,
        hostUid,
        userId:hostUid,
        accountType:"host_wallet",
        asset:hostActivityBonusAsset,
        delta:hostActivityBonusAmount,
        openingBalance:bonusOpeningBalance,
        closingBalance:bonusClosingBalance,
        reason:"agency_host_activity_bonus",
        sourceType:"agency_host_monthly",
        sourceId:settlementId,
        settlementMonth:month,
        idempotencyKey:hostBonusLedgerId,
        targetId:clean(monthly.targetId),
        targetThresholdCoins,
        qualifiedDays,
        requiredQualifiedDays,
        createdAt:FieldValue.serverTimestamp(),
      });
    }

    if(agencyPerformanceBonusCoins>0){
      tx.set(bonusAccrualRef,{
        agencyId,
        month,
        mode:"per_host_target_month_end",
        status:"collecting",
        configuredBonusBps:policySnapshot.agencyPerformanceBonusBps,
        perHostEligibleHostCount:FieldValue.increment(
          agencyPerformanceBonus.eligible===true?1:0,
        ),
        perHostBonusCoins:FieldValue.increment(agencyPerformanceBonusCoins),
        updatedAt:FieldValue.serverTimestamp(),
      },{merge:true});
    }

    tx.create(auditRef,{
      actorUid,
      action:"settleAgencyHostSurplus",
      targetType:"agency_host_monthly",
      targetId:hostMonthlyId,
      agencyId,
      hostUid,
      month,
      after:settlement,
      createdAt:FieldValue.serverTimestamp(),
    });
    return {
      alreadySettled:false,
      hostUid,
      settlement,
    };
  });
}

export async function settleAgencyHostSurplusPage(
  db,
  actorUid,
  agencyIdInput,
  monthInput,
  options={},
){
  const agencyId=clean(agencyIdInput);
  if(!/^[A-Za-z0-9_-]{3,180}$/.test(agencyId)){
    throw Error("invalid_settlement");
  }
  const month=assertAgencySettlementMonthClosed(
    monthInput,
    options.now??new Date(),
  );
  const pageSize=agencySurplusPageSize(options.limit);
  const prefix=agencySurplusPagePrefix(agencyId,month);
  const cursor=clean(options.cursor);
  if(
    cursor &&
    (
      cursor.length>420 ||
      !cursor.startsWith(prefix) ||
      cursor.includes("/")
    )
  ){
    throw Error("invalid_surplus_cursor");
  }

  const policySnapshot=await freezeAgencySurplusPolicy(
    db,
    actorUid,
    agencyId,
    month,
  );

  let query=db.collection("agency_host_monthly");
  query=query.where(
    "surplusPageKey",
    cursor?">":">=",
    cursor||prefix,
  );
  query=query.where("surplusPageKey","<",prefix+"\uf8ff");
  query=query.orderBy("surplusPageKey","asc").limit(pageSize+1);
  const page=await query.get();
  const pageDocs=page.docs.slice(0,pageSize);
  const results=[];
  for(const doc of pageDocs){
    results.push(await settleAgencyHostSurplus(
      db,
      actorUid,
      policySnapshot,
      doc.id,
    ));
  }

  const hasMore=page.docs.length>pageSize;
  const lastProcessed=pageDocs.at(-1);
  const nextCursor=hasMore&&lastProcessed
    ? clean(lastProcessed.data()?.surplusPageKey)
    : null;
  const done=!hasMore;
  if(done){
    await markAgencyHostSettlementsComplete(
      db,
      actorUid,
      agencyId,
      month,
      options.now??new Date(),
    );
  }
  return {
    agencyId,
    month,
    policySnapshot,
    pageSize,
    processedCount:results.length,
    settledCount:results.filter(item=>!item.alreadySettled).length,
    duplicateCount:results.filter(item=>item.alreadySettled).length,
    done,
    nextCursor,
    results,
  };
}


export async function handler(req,res){
  if(cors(req,res))return;
  if(req.method!=="POST")return out(res,405,{ok:false,code:"method_not_allowed"});
  try{
    initFirebase();
    const {uid,db,isOwner,canAdjustBalances,canManageSettlements,canSettleAgency}=await actor(req);
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

    if(action==="settleAgencyMonth"){
      if(!canSettleAgency)throw Error("settlement_forbidden");
      const result=await settleAgencyMonth(
        db,
        uid,
        req.body?.agencyId,
        req.body?.month,
      );
      return out(res,200,{ok:true,...result});
    }

    if(action==="settleAgencyHostSurplusPage"){
      if(!canSettleAgency)throw Error("settlement_forbidden");
      const result=await settleAgencyHostSurplusPage(
        db,
        uid,
        req.body?.agencyId,
        req.body?.month,
        {
          limit:req.body?.limit,
          cursor:req.body?.cursor,
        },
      );
      return out(res,200,{ok:true,...result});
    }

    return out(res,400,{ok:false,code:"invalid_action"});
  }catch(error){
    const code=clean(error?.message)||"server_error";
    const status=code==="unauthorized"?401:
      ["forbidden","owner_required","settlement_forbidden"].includes(code)?403:
      ["user_not_found","settlement_not_found"].includes(code)?404:
      [
        "invalid_query",
        "invalid_reason",
        "invalid_action",
        "invalid_settlement",
        "invalid_agency_month",
        "invalid_surplus_cursor",
      ].includes(code)?400:
      [
        "agency_month_not_closed",
        "agency_surplus_policy_unconfigured",
        "agency_surplus_policy_snapshot_conflict",
        "agency_host_month_conflict",
        "agency_surplus_settlement_conflict",
        "agency_surplus_ledger_conflict",
      ].includes(code)?409:500;
    return out(res,status,{ok:false,code});
  }
}
