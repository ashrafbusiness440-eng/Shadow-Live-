import assert from "node:assert/strict";
import { test, after } from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { getApps, initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { cloudflareFirestoreAdapter } from "./helpers/cloudflare-firestore-adapter.js";
import { eraseDeletedPrivateCallPushToken } from "../../cloudflare-worker/src/account-deletion-private-call-push-stage.js";
import { seedEmulatorErasureCertificates }
  from "./helpers/account-erasure-synthetic-certificates.js";

const app = getApps()[0] || initializeApp({ projectId: "shadow-live-economy-test" });
const firestore = getFirestore(app);
const adapter = cloudflareFirestoreAdapter(firestore);
after(async () => { await deleteApp(app); });

test("emulator: concurrent push token cleanup is idempotent and leaves unrelated user's token", async () => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 18);
  const uid = "erase_push_" + suffix;
  const otherUid = "other_push_" + suffix;
  const requestId = "push_req_" + suffix;
  const nowMs = Date.now();
  const token = "test-token-" + suffix + "-012345678901234567890123456789";
  const hash = createHash("sha256").update(token).digest("hex");
  const request = firestore.doc("account_deletion_requests/" + uid);
  const checkpoint = firestore.doc("account_deletion_erasure_checkpoints/" + uid);
  const user = firestore.doc("users/" + uid);
  const owner = firestore.doc("private_call_push_token_owners/" + hash);
  const device = firestore.doc("private_call_push_devices/" + uid + "/tokens/" + hash);
  const unrelated = firestore.doc("private_call_push_devices/" + otherUid + "/tokens/" + hash);
  const refs = [request, checkpoint, user, owner, device, unrelated];
  refs.push(...await seedEmulatorErasureCertificates(firestore,{
    uid,requestId,nowMs,
  }));
  await Promise.all([
    request.set({ uid, requestId, status: "processing",
      requestedAt: new Date(nowMs - 40 * 86400_000) }),
    checkpoint.set({ requestId, phase: "push_devices", destructiveAllowed: true,
      notificationRetentionCleared: true, legalEvidenceReviewComplete: true }),
    user.set({ role: "user", accountStatus: "deletion_processing" }),
    owner.set({ uid }),
    device.set({ token, platform: "android" }),
    unrelated.set({ token, platform: "android" }),
  ]);
  const opts = { uid, requestId, tokenHash: hash };
  try {
    const results = await Promise.all([
      eraseDeletedPrivateCallPushToken(adapter, opts),
      eraseDeletedPrivateCallPushToken(adapter, opts),
    ]);
    assert.deepEqual(results.map(x => x.removed).sort((a,b) => a-b), [0, 2]);
    assert.equal((await device.get()).exists, false);
    assert.equal((await owner.get()).exists, false);
    assert.equal((await unrelated.get()).exists, true);
    await request.update({ reviewHold: true });
    await assert.rejects(eraseDeletedPrivateCallPushToken(adapter, opts),
      error => error.code === "push_erasure_not_authorized");
  } finally {
    await Promise.all(refs.map(ref => ref.delete()));
  }
});

test("emulator: re-assigned push token owner is not revoked by deletion of old account", async () => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 18);
  const uid = "erase_push_" + suffix;
  const nextUid = "next_push_" + suffix;
  const requestId = "push_req_" + suffix;
  const nowMs = Date.now();
  const token = "test-token-" + suffix + "-012345678901234567890123456789";
  const hash = createHash("sha256").update(token).digest("hex");
  const request = firestore.doc("account_deletion_requests/" + uid);
  const checkpoint = firestore.doc("account_deletion_erasure_checkpoints/" + uid);
  const user = firestore.doc("users/" + uid);
  const owner = firestore.doc("private_call_push_token_owners/" + hash);
  const stale = firestore.doc("private_call_push_devices/" + uid + "/tokens/" + hash);
  const current = firestore.doc("private_call_push_devices/" + nextUid + "/tokens/" + hash);
  const refs = [request, checkpoint, user, owner, stale, current];
  refs.push(...await seedEmulatorErasureCertificates(firestore,{
    uid,requestId,nowMs,
  }));
  await Promise.all([
    request.set({ uid, requestId, status: "processing",
      requestedAt: new Date(nowMs - 40 * 86400_000) }),
    checkpoint.set({ requestId, phase: "push_devices", destructiveAllowed: true,
      notificationRetentionCleared: true, legalEvidenceReviewComplete: true }),
    user.set({ role: "user", accountStatus: "deletion_processing" }),
    owner.set({ uid: nextUid }), stale.set({ token, platform: "android" }),
    current.set({ token, platform: "android" }),
  ]);
  try {
    assert.equal((await eraseDeletedPrivateCallPushToken(adapter, {
      uid, requestId, tokenHash: hash,
    })).removed, 1);
    assert.equal((await owner.get()).data().uid, nextUid);
    assert.equal((await current.get()).exists, true);
    assert.equal((await stale.get()).exists, false);
  } finally {
    await Promise.all(refs.map(ref => ref.delete()));
  }
});
