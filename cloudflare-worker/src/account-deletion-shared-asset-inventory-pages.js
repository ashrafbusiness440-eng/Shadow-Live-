// INTERNAL ONLY: bounded READ-ONLY shared ownership inventory.
// A room/agency belonging to a deleted user CANNOT be erased without
// independent transfer/settlement/retention decisions. No public route.
const clean = v => String(v ?? "").trim();
const uidOk = v => /^[A-Za-z0-9_-]{3,128}$/.test(clean(v));
const requestOk = v => /^[A-Za-z0-9_-]{12,180}$/.test(clean(v));
const resourceOk = v => /^[A-Za-z0-9_-]{1,180}$/.test(clean(v));
const held = data => [
  data?.reviewHold, data?.legalHold, data?.retentionHold,
  data?.deletionHold, data?.evidenceHold,
  data?.investigationHold, data?.reported, data?.appealPending,
].some(flag => flag === true) ||
  ["pending", "open", "under_review"].includes(
    clean(data?.appealStatus).toLowerCase());
export const MAX_SHARED_ASSET_INVENTORY_PAGE = 5;
const kinds = Object.freeze({
  rooms_owner_uid: Object.freeze({
    collection: "rooms", field: "ownerUid",
  }),
  rooms_legacy_owner_id: Object.freeze({
    collection: "rooms", field: "ownerId",
  }),
  agencies_owned: Object.freeze({
    collection: "agencies", field: "ownerUid",
  }),
});
export class SharedAssetInventoryError extends Error {
  constructor(code, status = 409) {
    super(code); this.code = code; this.status = status;
  }
}
const reject = (code, status) => {
  throw new SharedAssetInventoryError(code, status);
};

/**
 * One indexed ownership query (max five rows) with exact per-agency reads.
 * Must be called per kind/page by a separately authenticated Owner caller.
 * Returns NO room name, avatar, location, members, salaries or wallet data.
 */
export async function inspectAccountSharedAssetsPage(db, {
  uid, requestId, actor, kind, cursor = null,
  limit = MAX_SHARED_ASSET_INVENTORY_PAGE,
} = {}) {
  uid = clean(uid);
  requestId = clean(requestId);
  if (!actor?.owner || !uidOk(actor.uid)) reject("owner_required", 403);
  if (!uidOk(uid) || !requestOk(requestId) ||
      !Object.hasOwn(kinds, kind) ||
      !Number.isSafeInteger(limit) || limit < 1 ||
      limit > MAX_SHARED_ASSET_INVENTORY_PAGE ||
      (cursor !== null && (typeof cursor !== "string" ||
        !resourceOk(cursor)))) {
    reject("invalid_shared_asset_inventory_target", 400);
  }
  const [request, checkpoint, user] = await Promise.all([
    db.get("account_deletion_requests/" + uid),
    db.get("account_deletion_erasure_checkpoints/" + uid),
    db.get("users/" + uid),
  ]);
  if (!request.exists || !checkpoint.exists || !user.exists ||
      clean(request.data?.uid) !== uid ||
      clean(request.data?.requestId) !== requestId ||
      clean(checkpoint.data?.uid) !== uid ||
      clean(checkpoint.data?.requestId) !== requestId ||
      !["review_ready", "processing"].includes(clean(request.data?.status)) ||
      clean(user.data?.role) === "owner" ||
      user.data?.authDeleted === true ||
      held(request.data) || held(checkpoint.data) || held(user.data)) {
    reject("shared_asset_inventory_review_blocked");
  }
  const config = kinds[kind];
  const rows = await db.runQuery(config.collection, {
    filters: [{field: config.field, op: "==", value: uid}],
    orderBy: [{field: "__name__", direction: "asc"}],
    limit: limit + 1,
    startAfter: cursor
      ? [{referencePath: config.collection + "/" + cursor}] : [],
  });
  if (!Array.isArray(rows) || rows.length > limit + 1 ||
      rows.some(row => !resourceOk(row?.id) || !row?.data)) {
    reject("shared_asset_inventory_invalid_page", 503);
  }
  const selected = rows.slice(0, limit);
  if (new Set(selected.map(row => row.id)).size !== selected.length) {
    reject("shared_asset_inventory_duplicate_page", 503);
  }
  const agencyMembership = kind === "agencies_owned"
    ? await db.get("agency_user_memberships/" + uid)
    : {exists: false, data: null};
  const items = [];
  for (const row of selected) {
    const value = row.data;
    if (clean(value[config.field]) !== uid) {
      reject("shared_asset_inventory_owner_conflict");
    }
    if (kind === "agencies_owned") {
      // Match the exact ID and both sides of the agency owner membership,
      // never infer safe automatic closure/transfer from memberCount.
      const pair = await db.get(
        "agency_memberships/" + row.id + "__" + uid);
      const m = pair.data || {};
      const um = agencyMembership.data || {};
      const membershipConsistent = pair.exists &&
        agencyMembership.exists &&
        clean(value.agencyId) === row.id &&
        clean(m.agencyId) === row.id &&
        clean(m.uid) === uid &&
        clean(m.role) === "owner" &&
        clean(m.status) === "active" &&
        clean(um.uid) === uid &&
        clean(um.agencyId) === row.id &&
        clean(um.role) === "owner" &&
        clean(um.status) === "active" &&
        !held(m) && !held(um);
      items.push({
        id: row.id, kind: "agency",
        membershipConsistent,
        held: held(value) || held(m) || held(um),
        requiresOwnershipDecision: true,
        requiresFinancialReview: true,
        needsReview: true,
      });
    } else {
      // ownerId is a known legacy field and may NOT be a Firebase UID.
      // This probe only covers rows where it equals the current UID.
      const conflictingOwner =
        config.field === "ownerId"
          ? (clean(value.ownerUid) !== "" &&
              clean(value.ownerUid) !== uid)
          : (clean(value.ownerId) !== "" &&
              uidOk(value.ownerId) &&
              clean(value.ownerId) !== uid);
      items.push({
        id: row.id, kind: "room",
        conflictingOwner,
        held: held(value),
        linkedAgencyRequiresReview:
          clean(value.agencyId) !== "",
        requiresOwnershipDecision: true,
        needsReview: true,
      });
    }
  }
  return {
    ok: true, kind, items, hasMore: rows.length > limit,
    nextCursor: rows.length > limit && selected.length
      ? selected[selected.length - 1].id : null,
    // A user may have another membership, old public ID, manager role or
    // rooms/agency memberships not indexed by these writer-backed fields.
    exhaustive: false, ownershipTransferred: false,
    erasureAllowed: false, completionVerified: false,
  };
}
