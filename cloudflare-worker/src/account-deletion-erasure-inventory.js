// A bounded, on-demand, read-only inventory for the owner. This cannot
// authorize erasure: Firestore legacy schemas, financial history, third-party
// state and protected reports require a separately reviewed deletion executor.
export const ACCOUNT_ERASURE_PROBE_LIMIT = 5;

const safeUid = value =>
  /^[A-Za-z0-9_-]{3,128}$/.test(String(value || "").trim());

// Each probe is a single indexed existence query: limit=1. Do not use global
// list(), collection scans, extra listeners, pagination or scheduled sweeps.
export const ACCOUNT_ERASURE_PROBES = Object.freeze([
  Object.freeze({
    key: "diaries",
    collection: "diaries",
    field: "ownerUid",
    op: "==",
  }),
  Object.freeze({
    key: "storage",
    collection: "storage_objects",
    field: "ownerUid",
    op: "==",
  }),
  Object.freeze({
    key: "rooms",
    collection: "rooms",
    field: "ownerUid",
    op: "==",
  }),
  Object.freeze({
    key: "legacyRooms",
    collection: "rooms",
    field: "ownerId",
    op: "==",
  }),
  Object.freeze({
    key: "conversations",
    collection: "conversations",
    field: "participants",
    op: "array-contains",
  }),
]);

export class AccountErasureInventoryError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export async function inspectAccountErasureInventory(db, uid) {
  const accountUid = String(uid || "").trim();
  if (!safeUid(accountUid)) {
    throw new AccountErasureInventoryError("invalid_target_uid");
  }
  const domains = {};
  // Deliberately sequential, bounded and user-triggered: no pressure spikes
  // from launching multiple Firestore queries for every admin inbox load.
  for (const probe of ACCOUNT_ERASURE_PROBES) {
    try {
      const rows = await db.runQuery(probe.collection, {
        filters: [{
          field: probe.field, op: probe.op, value: accountUid,
        }],
        limit: 1,
      });
      if (!Array.isArray(rows)) throw new Error("invalid_query_result");
      domains[probe.key] = rows.length > 0 ? "found" : "not_seen";
    } catch (error) {
      // Fail CLOSED: query errors cannot be interpreted as absence.
      domains[probe.key] = "not_verified";
      const code = String(error?.code || error?.message || "");
      if (/RESOURCE_EXHAUSTED|quota|firestore_quota_exhausted/i.test(code)) {
        throw error;
      }
    }
  }
  // The existence checks above are not exhaustive data-enumeration and cannot
  // authorize a Firebase Auth deletion or prove that data was erased.
  return {
    ok: true,
    domains,
    probesPerformed: ACCOUNT_ERASURE_PROBES.length,
    exhaustive: false,
    erasureAllowed: false,
    erasureExecuted: false,
    manualReviewRequired: [
      "moneyAndPurchaseLedger",
      "giftAndAgencySettlements",
      "diaryCommentsLikesAndMirrors",
      "privateMessageContentsAndVoiceMedia",
      "moderationReportsEvidenceAndLegalHolds",
      "roomAgencyAndSocialRelations",
      "notificationsAndDeviceTokens",
      "publicProfilesAndFirebaseAuth",
      "legacyUnindexedDocuments",
    ],
  };
}
