// INTERNAL READ-ONLY financial pre-erasure review. Not a settlement issuer.
// No route/cron/automatic scans, financial mutations, privacy data output,
// domain certifications, production deletion or Firebase Auth operations.
const clean = value => String(value ?? "").trim();
const validUid = value => /^[A-Za-z0-9_-]{3,128}$/.test(clean(value));
const validRequest = value => /^[A-Za-z0-9_-]{12,180}$/.test(clean(value));
const validDocId = value => /^[A-Za-z0-9_-]{1,240}$/.test(clean(value));
const held = value => [
  value?.legalHold, value?.retentionHold, value?.deletionHold,
  value?.reviewHold, value?.evidenceHold, value?.investigationHold,
  value?.reported, value?.appealPending,
].some(flag => flag === true) ||
  ["pending", "open", "under_review"].includes(
    clean(value?.appealStatus).toLowerCase());
export const MAX_FINANCIAL_REVIEW_PAGE = 5;
export const FINANCIAL_REVIEW_SCOPES = Object.freeze({
  purchase: Object.freeze({
    collection: "google_play_purchases", field: "uid", op: "==",
  }),
  ledger: Object.freeze({
    collection: "financial_ledger", field: "userId", op: "==",
  }),
  ledger_counterparty: Object.freeze({
    collection: "financial_ledger", field: "counterpartyUid", op: "==",
  }),
  ledger_counterparty_group: Object.freeze({
    collection: "financial_ledger", field: "counterpartyUids",
    op: "array-contains",
  }),
  gift_sender: Object.freeze({
    collection: "gift_transactions", field: "senderId", op: "==",
  }),
  gift_recipient: Object.freeze({
    collection: "gift_transactions", field: "receiverId", op: "==",
  }),
  wallet_sender: Object.freeze({
    collection: "wallet_transfers", field: "senderUid", op: "==",
  }),
  wallet_recipient: Object.freeze({
    collection: "wallet_transfers", field: "recipientUid", op: "==",
  }),
});
export class AccountFinancialReviewPageError extends Error {
  constructor(code, status=409) {
    super(code); this.code=code; this.status=status;
  }
}
const reject = (code,status) => {
  throw new AccountFinancialReviewPageError(code,status);
};

/**
 * Each invocation queries ONE indexed financial scope, returns at most five
 * boolean review flags and one internal-only cursor. Never prints order IDs,
 * balances, purchase token hashes, gift amounts, financial source IDs or
 * counterparty identifiers. A future Owner caller MUST authenticate itself
 * outside this internal module; an actor hint is not authentication.
 */
export async function inspectAccountFinancialReviewPage(db, {
  uid, requestId, actor, scope, cursor=null,
  limit=MAX_FINANCIAL_REVIEW_PAGE,
}={}) {
  uid=clean(uid); requestId=clean(requestId);
  if (!actor?.owner || !validUid(actor?.uid)) reject("owner_required",403);
  if (!validUid(uid) || !validRequest(requestId) ||
      !Object.hasOwn(FINANCIAL_REVIEW_SCOPES,scope) ||
      !Number.isSafeInteger(limit) || limit<1 ||
      limit>MAX_FINANCIAL_REVIEW_PAGE ||
      (cursor!==null && (typeof cursor!=="string" ||
        !validDocId(cursor)))) {
    reject("invalid_financial_review_page",400);
  }
  const [request,checkpoint,user]=await Promise.all([
    db.get("account_deletion_requests/"+uid),
    db.get("account_deletion_erasure_checkpoints/"+uid),
    db.get("users/"+uid),
  ]);
  if (!request.exists || !checkpoint.exists || !user.exists ||
      clean(request.data?.uid)!==uid ||
      clean(request.data?.requestId)!==requestId ||
      clean(checkpoint.data?.uid)!==uid ||
      clean(checkpoint.data?.requestId)!==requestId ||
      !["review_ready","processing"].includes(clean(request.data?.status)) ||
      clean(user.data?.role)==="owner" ||
      user.data?.authDeleted===true ||
      held(request.data) || held(checkpoint.data) || held(user.data)) {
    reject("financial_review_blocked");
  }
  const config=FINANCIAL_REVIEW_SCOPES[scope];
  const rows=await db.runQuery(config.collection,{
    filters:[{field:config.field,op:config.op,value:uid}],
    orderBy:[{field:"__name__",direction:"asc"}],
    startAfter:cursor ? [{referencePath:config.collection+"/"+cursor}]:[],
    limit:limit+1,
  });
  if (!Array.isArray(rows) || rows.length>limit+1 ||
      rows.some(row=>!validDocId(row?.id) || !row?.data) ||
      new Set(rows.map(row=>row.id)).size!==rows.length) {
    reject("financial_review_invalid_page",503);
  }
  const selected=rows.slice(0,limit);
  // Full page must have the expected indexed owner/counterparty. A corrupt
  // query result is NEVER allowed to establish financial clearance.
  for(const row of selected) {
    const fieldValue=row.data[config.field];
    const correct=config.op==="array-contains"
      ? Array.isArray(fieldValue) && fieldValue.includes(uid)
      : clean(fieldValue)===uid;
    if(!correct)reject("financial_review_index_mismatch");
  }
  // Play's writer records a purchase under its token hash and an exact
  // financial_ledger/play_{hash} entry. Check its presence/association;
  // never equate it with no chargebacks or actual settlement.
  const playLedger=scope==="purchase"
    ? await Promise.all(selected.map(row=>
      db.get("financial_ledger/play_"+row.id)))
    : [];
  const items=selected.map((row,index)=>{
    const value=row.data;
    const reviewHold=held(value);
    if(scope==="purchase"){
      const related=playLedger[index];
      const d=related.data||{};
      const ledgerLinked=related.exists &&
        clean(value.tokenHash)===row.id &&
        clean(d.userId)===uid &&
        clean(d.sourceType)==="googlePlayPurchase" &&
        clean(d.sourceId)===row.id &&
        !held(d);
      const billingUnresolved=clean(value.refundState)!=="none" ||
        clean(value.disputeState)!=="none" ||
        clean(value.status)!=="credited";
      return {
        recordReviewRequired:true, legalHoldPresent:reviewHold ||
          held(d), ledgerLinked, billingUnresolved,
        financialSettlementVerified:false,
      };
    }
    // Immutable ledgers, gifted wealth, and prior settlements must survive.
    return {
      recordReviewRequired:true,
      legalHoldPresent:reviewHold,
      financialSettlementVerified:false,
    };
  });
  return {
    ok:true,scope,checked:selected.length,items,
    hasMore:rows.length>limit,
    // INTERNAL cursor only. A routed API must bind/encrypt this cursor,
    // as document IDs can contain historical transaction identifiers.
    nextCursor:rows.length>limit && selected.length
      ? selected[selected.length-1].id : null,
    exhaustive:false,financialSettlementVerified:false,
    erasureAllowed:false,completionVerified:false,
  };
}
