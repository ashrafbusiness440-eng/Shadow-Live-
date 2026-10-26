import assert from "node:assert/strict";
import { test, after } from "node:test";
import { randomUUID } from "node:crypto";
import { getApps, initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { cloudflareFirestoreAdapter } from "./helpers/cloudflare-firestore-adapter.js";
import { eraseDeletedAccountNotification } from "../../cloudflare-worker/src/account-deletion-notification-stage.js";
import { REQUIRED_ERASURE_ADMISSION_DOMAINS as domains }
  from "../../cloudflare-worker/src/account-deletion-processing-admission.js";

const app = getApps()[0] || initializeApp({projectId:"shadow-live-economy-test"});
const firestore = getFirestore(app);
const adapter = cloudflareFirestoreAdapter(firestore);
after(async () => { await deleteApp(app); });

test("emulator: only recipient-owned notice is deleted, concurrent calls idempotent", async () => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 18);
  const uid = "erase_notice_" + suffix;
  const otherUid = "other_notice_" + suffix;
  const requestId = "notice_req_" + suffix;
  const nowMs=Date.now(),requestedAt=new Date(nowMs-40*86400_000);
  const ownerUid="emulator_owner_12345";
  const certificates=domains.flatMap(domain=>[
    firestore.doc("account_deletion_erasure_approvals/"+requestId+"__"+domain),
    firestore.doc("admin_audit_logs/erasure_domain_cert_"+requestId+"__"+domain),
  ]);
  const noticeId = "report_result_" + suffix;
  const otherId = "diary_comment_" + suffix;
  const request = firestore.doc("account_deletion_requests/" + uid);
  const checkpoint = firestore.doc("account_deletion_erasure_checkpoints/" + uid);
  const user = firestore.doc("users/" + uid);
  const notice = firestore.doc("notifications/" + noticeId);
  const other = firestore.doc("notifications/" + otherId);
  const refs = [request, checkpoint, user, notice, other, ...certificates];
  await Promise.all([
    request.set({uid,requestId,status:"processing",requestedAt}),
    checkpoint.set({requestId, phase:"notifications", destructiveAllowed:true,
      notificationRetentionCleared:true, legalEvidenceReviewComplete:true,
      financialSettlementApproved:true}),
    user.set({role:"user",accountStatus:"deletion_processing"}),
    notice.set({userId:uid,type:"report_status",reportId:"sample_123",body:"private"}),
    other.set({userId:otherUid,type:"diary_comment",title:"preserve"}),
    ...domains.flatMap((domain,i)=>[
      certificates[2*i].set({uid,requestId,domain,decision:"approved",
        signedByUid:ownerUid,signedAt:new Date(nowMs-10000),
        expiresAt:new Date(nowMs+86400_000)}),
      certificates[2*i+1].set({action:"accountErasureDomainCertified",
        actorUid:ownerUid,targetId:uid,requestId,domain,
        createdAt:new Date(nowMs-10000)}),
    ]),
  ]);
  const opts = {uid,requestId,notificationId:noticeId};
  try {
    const calls = await Promise.all([
      eraseDeletedAccountNotification(adapter,opts),
      eraseDeletedAccountNotification(adapter,opts),
    ]);
    assert.deepEqual(calls.map(x=>x.deleted).sort(),[false,true]);
    assert.equal((await notice.get()).exists,false);
    assert.equal((await other.get()).data().title,"preserve");
    await request.update({legalHold:true});
    await assert.rejects(eraseDeletedAccountNotification(adapter,opts),
      e=>e.code==="notification_erasure_not_authorized");
  }finally{
    await Promise.all(refs.map(ref=>ref.delete()));
  }
});
