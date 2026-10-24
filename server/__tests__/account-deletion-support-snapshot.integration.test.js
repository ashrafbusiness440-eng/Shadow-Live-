import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { deleteApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { cloudflareFirestoreAdapter } from "./helpers/cloudflare-firestore-adapter.js";
import { redactDeletedSupporterPair } from "../../cloudflare-worker/src/account-deletion-support-snapshot-stage.js";

const app = getApps()[0] || initializeApp({ projectId: "shadow-live-economy-test" });
const firestore = getFirestore(app);
const adapter = cloudflareFirestoreAdapter(firestore);
after(async () => { await deleteApp(app); });

test("emulated Firestore retries redact existing support snapshots, preserving money and counterpart data", async () => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
  const deletedUid = "erased_" + suffix;
  const counterpartUid = "recipient_" + suffix;
  const requestId = "deletion_request_" + suffix;
  const request = firestore.doc("account_deletion_requests/" + deletedUid);
  const checkpoint = firestore.doc("account_deletion_erasure_checkpoints/" + deletedUid);
  const user = firestore.doc("users/" + deletedUid);
  const wealth = firestore.doc(`user_level_support/${counterpartUid}/wealth/${deletedUid}`);
  const attraction = firestore.doc(`user_level_support/${counterpartUid}/attraction/${deletedUid}`);
  const untouched = firestore.doc(`user_level_support/${counterpartUid}/attraction/active_${suffix}`);
  const opts = { deletedUid, counterpartUid, requestId };
  await Promise.all([
    request.set({ uid: deletedUid, requestId, status: "processing" }),
    checkpoint.set({requestId,phase:"support_snapshots",destructiveAllowed:true}),
    user.set({ role:"user", accountStatus:"deletion_processing" }),
    wealth.set({counterpartUid:deletedUid,displayName:"Private Old Name",
      publicId:"11223344",profileImageUrl:"https://example.invalid/old-photo.png",
      points:670,giftCount:3,financialReceipt:"unchanged-1"}),
    attraction.set({counterpartUid:deletedUid,displayName:"Private Old Name",
      publicId:"11223344",profileImageUrl:"https://example.invalid/old-photo.png",
      points:1250,giftCount:5,financialReceipt:"unchanged-2"}),
    untouched.set({counterpartUid:"active_"+suffix,displayName:"Other Active",
      points:98,giftCount:1}),
  ]);
  try {
    const results = await Promise.all([
      redactDeletedSupporterPair(adapter,opts),
      redactDeletedSupporterPair(adapter,opts),
    ]);
    assert.deepEqual(results.map(v=>v.redacted).sort(),[0,2]);
    for (const [ref,points,count,receipt] of [
      [wealth,670,3,"unchanged-1"],[attraction,1250,5,"unchanged-2"]
    ]) {
      const data = (await ref.get()).data();
      assert.equal(data.displayName,"حساب محذوف");
      assert.equal(data.publicId,"");
      assert.equal(data.profileImageUrl,"");
      assert.equal(data.points,points);
      assert.equal(data.giftCount,count);
      assert.equal(data.financialReceipt,receipt);
    }
    assert.equal((await untouched.get()).data().displayName,"Other Active");
    await request.update({status:"cancelled"});
    await assert.rejects(redactDeletedSupporterPair(adapter,opts),
      e=>e.code==="support_erasure_not_authorized");
  } finally {
    await Promise.all([request,checkpoint,user,wealth,attraction,untouched].map(ref=>ref.delete()));
  }
});
