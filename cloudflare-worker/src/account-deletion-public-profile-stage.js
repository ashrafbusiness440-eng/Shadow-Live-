import { accountDeletionHasActiveHold as held } from "./account-deletion-active-holds.js";
// A single-document public identity cleanup primitive for the verified
// erasure finalizer. NOT connected to HTTP, cron, or a production feature flag.
// Never deletes users/{uid}, Auth, reports, wallets, financial ledgers or R2.
const clean = value => String(value ?? "").trim();
const uidPattern = /^[A-Za-z0-9_-]{3,128}$/;
const requestIdPattern = /^[A-Za-z0-9_-]{12,180}$/;


export class PublicProfileErasureError extends Error {
  constructor(code, status = 409) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

// Transactionally recheck the CURRENT request and active checkpoint before
// touching a profile. A successful preflight does NOT satisfy these conditions.
export async function erasePublicProfileStage(db, {uid, requestId} = {}) {
  uid = clean(uid);
  requestId = clean(requestId);
  if (!uidPattern.test(uid) || !requestIdPattern.test(requestId)) {
    throw new PublicProfileErasureError("invalid_public_profile_erasure", 400);
  }
  const tx = await db.beginTransaction();
  try {
    const [request, checkpoint, user, profile] = await Promise.all([
      db.get("account_deletion_requests/" + uid, tx),
      db.get("account_deletion_erasure_checkpoints/" + uid, tx),
      db.get("users/" + uid, tx),
      db.get("public_profiles/" + uid, tx),
    ]);
    if (!request.exists || !checkpoint.exists || !user.exists ||
        clean(request.data?.uid) !== uid ||
        clean(request.data?.requestId) !== requestId ||
        clean(checkpoint.data?.requestId) !== requestId ||
        clean(request.data?.status) !== "processing" ||
        clean(checkpoint.data?.phase) !== "public_profile" ||
        checkpoint.data?.destructiveAllowed !== true ||
        clean(user.data?.accountStatus) !== "deletion_processing" ||
        clean(user.data?.role) === "owner" ||
        held(request.data) || held(checkpoint.data) || held(user.data) ||
        held(profile.data)) {
      throw new PublicProfileErasureError("public_profile_erasure_blocked");
    }
    if (!profile.exists) {
      await db.rollback(tx);
      return {ok:true,removed:false,duplicate:true};
    }
    if (clean(profile.data?.uid) && clean(profile.data?.uid) !== uid) {
      throw new PublicProfileErasureError("public_profile_identity_conflict");
    }
    // Financial/purchase/legal retention approvals must already be certified
    // by the finalizer before it sets destructiveAllowed=true in this phase.
    await db.commit(tx, [db.writeDelete("public_profiles/" + uid)]);
    return {ok:true,removed:true,duplicate:false};
  } catch (error) {
    await db.rollback(tx).catch(() => {});
    throw error;
  }
}
