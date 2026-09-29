import { getApps, initializeApp, cert, getAuth, FieldValue, getFirestore, legacyEnv } from "../legacy-firebase-admin-shim.js";
import { assertUserDocumentSessionState } from "../firebase-auth.js";
import { calculateAgencyMonthlyBonus, convertPayableCoinsToDiamonds } from "./economy-policy.js";
import { economyPermissions } from "./economy-permissions.js";
import {
  agencyFinancialInteger,
  assertAgencySettlementMonthClosed,
  validateAgencySettlementTotals,
} from "../agency-policy.js";

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
    const sa=parseServiceAccount(legacyEnv.FIREBASE_SERVICE_ACCOUNT);
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
  const decoded=await getAuth().verifyIdToken(authorization.slice(7), {checkUserState:false});
  const db=getFirestore();
  const snap=await db.collection("users").doc(decoded.uid).get();
  if(!snap.exists)throw Error("forbidden");
  const user=snap.data()||{};
  assertUserDocumentSessionState(decoded, user);
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

  return db.runTransaction(async tx=>{
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
      throw Error("settlement_bonus_accrual_conflict");
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
    tx.create(bonusAccrualRef,{
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
    });
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

    return out(res,400,{ok:false,code:"invalid_action"});
  }catch(error){
    const code=clean(error?.message)||"server_error";
    const status=code==="unauthorized"?401:
      ["forbidden","owner_required","settlement_forbidden"].includes(code)?403:
      ["user_not_found","settlement_not_found"].includes(code)?404:
      ["invalid_query","invalid_reason","invalid_action","invalid_settlement","invalid_agency_month"].includes(code)?400:
      code==="agency_month_not_closed"?409:500;
    return out(res,status,{ok:false,code});
  }
}
