// INTERNAL, UNROUTED: durable reservation for future external account-erasure
// side effects. It is NOT a permit to call R2.delete. All production deletion
// stays OFF. A separate revocation/lease-holder protocol is mandatory first.
import { accountDeletionHasActiveHold as held }
  from "./account-deletion-active-holds.js";
import { recheckErasureCertificatesInTransaction }
  from "./account-deletion-erasure-transactional-cert-gate.js";

const clean = v => String(v ?? "").trim();
const uidOk = v => /^[A-Za-z0-9_-]{3,128}$/.test(v);
const requestOk = v => /^[A-Za-z0-9_-]{12,180}$/.test(v);
const objectOk = v => /^[A-Za-z0-9_-]{12,180}$/.test(v);
const tokenOk = v => /^[A-Za-z0-9_-]{20,180}$/.test(v);
const dateMs = v => v instanceof Date ? v.getTime()
  : typeof v?.toDate === "function" ? v.toDate().getTime()
  : typeof v === "string" ? Date.parse(v)
  : Number.isFinite(v?.seconds) ? v.seconds * 1000 : NaN;
const GRACE_MS = 30 * 86400_000;

export class AccountErasureIoReservationError extends Error {
  constructor(code,status=409){super(code);this.code=code;this.status=status;}
}
const reject = (code,status) => {
  throw new AccountErasureIoReservationError(code,status);
};

/**
 * Reserving an object is an atomic bookkeeping operation, NOT external I/O
 * permission. One request/object has one immutable reservation; even after
 * a timeout the reservation is never recycled without separate reconciliation.
 * This prevents two concurrent workers both gaining a fresh reservation.
 *
 * No API, schedule, bucket operation, finalizer or test certificate issuer
 * imports this primitive. Approval revocation must later honor an explicit
 * durable interlock before any real external delete can be enabled.
 */
export async function reserveAccountErasureExternalIo(db, {
  uid, requestId, objectId, actor, token, nowMs = Date.now(),
}={}) {
  uid=clean(uid);requestId=clean(requestId);objectId=clean(objectId);
  token=clean(token);
  if (!actor?.owner || !uidOk(clean(actor?.uid))) reject("owner_required",403);
  if (!uidOk(uid) || !requestOk(requestId) || !objectOk(objectId) ||
      !tokenOk(token) || !Number.isSafeInteger(nowMs) || nowMs <= 0) {
    reject("invalid_external_io_reservation",400);
  }
  if (typeof db?.beginTransaction !== "function" ||
      typeof db?.commit !== "function" ||
      typeof db?.writeCreate !== "function") {
    reject("external_io_transaction_adapter_missing",503);
  }
  const path = "account_erasure_external_io_reservations/" + uid + "__" + objectId;
  const tx = await db.beginTransaction();
  try {
    const [request,checkpoint,user,existing,storageObject] = await Promise.all([
      db.get("account_deletion_requests/"+uid,tx),
      db.get("account_deletion_erasure_checkpoints/"+uid,tx),
      db.get("users/"+uid,tx),
      db.get(path,tx),
      db.get("storage_objects/"+objectId,tx),
    ]);
    if (existing.exists) reject("external_io_reservation_requires_reconciliation");
    if (!request.exists || !checkpoint.exists || !user.exists ||
        !storageObject.exists ||
        clean(request.data?.uid)!==uid ||
        clean(request.data?.requestId)!==requestId ||
        clean(checkpoint.data?.uid)!==uid ||
        clean(checkpoint.data?.requestId)!==requestId ||
        clean(request.data?.status)!=="processing" ||
        clean(checkpoint.data?.phase)!=="storage_media" ||
        checkpoint.data?.destructiveAllowed!==true ||
        clean(user.data?.accountStatus)!=="deletion_processing" ||
        clean(user.data?.role)==="owner" ||
        clean(storageObject.data?.ownerUid)!==uid ||
        held(request.data) || held(checkpoint.data) ||
        held(user.data) || held(storageObject.data)) {
      reject("external_io_reservation_not_authorized");
    }
    const requestedAtMs=dateMs(request.data?.requestedAt);
    const eligibleAtMs=dateMs(request.data?.eligibleAt);
    if (!Number.isSafeInteger(requestedAtMs) ||
        !Number.isSafeInteger(eligibleAtMs) ||
        eligibleAtMs < requestedAtMs + GRACE_MS ||
        nowMs < eligibleAtMs || nowMs < requestedAtMs + GRACE_MS) {
      reject("external_io_reservation_grace_not_elapsed");
    }
    // The twelve signoffs must be read in this same transaction as creating
    // the unique reservation. A stale approval cannot authorize the record.
    await recheckErasureCertificatesInTransaction(db,tx,{
      uid,requestId,requestedAtMs,nowMs,
    });
    await db.commit(tx,[db.writeCreate(path,{
      uid,requestId,objectId,operationToken:token,
      state:"reserved_requires_external_interlock",
      // The separate R2 worker MUST NOT interpret this record as a permit.
      externalIoAllowed:false,completionVerified:false,
      reservedAt:new Date(nowMs),
      reservedByUid:clean(actor.uid),
    })]);
    return {ok:true,reserved:true,externalIoAllowed:false,
      completionVerified:false,requiresReconciliation:true};
  } catch (error) {
    await db.rollback(tx).catch(()=>{});
    throw error;
  }
}
