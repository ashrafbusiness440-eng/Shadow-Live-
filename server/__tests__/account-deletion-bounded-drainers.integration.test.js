import assert from "node:assert/strict";
import {test,after} from "node:test";
import {createHash,randomUUID} from "node:crypto";
import {getApps,initializeApp,deleteApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import {cloudflareFirestoreAdapter} from "./helpers/cloudflare-firestore-adapter.js";
import {
  drainAccountOwnedNotifications,drainAccountPrivateCallPushDevices,
} from "../../cloudflare-worker/src/account-deletion-bounded-drainers.js";
import { seedEmulatorErasureCertificates }
  from "./helpers/account-erasure-synthetic-certificates.js";
import { REQUIRED_ERASURE_ADMISSION_DOMAINS as domains }
  from "../../cloudflare-worker/src/account-deletion-processing-admission.js";

const app=getApps()[0]||initializeApp({projectId:"shadow-live-economy-test"});
const store=getFirestore(app),db=cloudflareFirestoreAdapter(store);
after(async()=>{await deleteApp(app);});
const sid=()=>randomUUID().replaceAll("-","").slice(0,18);

test("emulator: drain notifications in limited indexed calls; retain counterparty",async()=>{
  const suffix=sid(),uid="erase_notice_"+suffix,other="other_notice_"+suffix;
  const requestId="notice_request_"+suffix;
  const nowMs=Date.now(),requestedAt=new Date(nowMs-40*86400_000);
  const ownerUid="emulator_owner_12345";
  const certificates=domains.flatMap(domain=>[
    store.doc("account_deletion_erasure_approvals/"+requestId+"__"+domain),
    store.doc("admin_audit_logs/erasure_domain_cert_"+requestId+"__"+domain),
  ]);
  const request=store.doc("account_deletion_requests/"+uid);
  const checkpoint=store.doc("account_deletion_erasure_checkpoints/"+uid);
  const user=store.doc("users/"+uid);
  const notices=Array.from({length:8},(_,i)=>store.doc(
    "notifications/deleted_owned_"+suffix+"_"+i));
  const third=store.doc("notifications/counterparty_"+suffix);
  const refs=[request,checkpoint,user,...notices,third,...certificates];
  await Promise.all([
    request.set({uid,requestId,status:"processing",requestedAt}),
    checkpoint.set({requestId,phase:"notifications",destructiveAllowed:true,
      notificationRetentionCleared:true,legalEvidenceReviewComplete:true,
      financialSettlementApproved:true}),
    user.set({role:"user",accountStatus:"deletion_processing",coins:150}),
    ...notices.map((ref,i)=>ref.set({userId:uid,type:"notice",
      body:"private-"+i})),
    third.set({userId:other,title:"retain"}),
    ...domains.flatMap((domain,i)=>[
      certificates[2*i].set({uid,requestId,domain,decision:"approved",
        signedByUid:ownerUid,signedAt:new Date(nowMs-10000),
        expiresAt:new Date(nowMs+86400_000)}),
      certificates[2*i+1].set({action:"accountErasureDomainCertified",
        actorUid:ownerUid,targetId:uid,requestId,domain,
        createdAt:new Date(nowMs-10000)}),
    ]),
  ]);
  try{
    const sizes=[];
    for(let i=0;i<3;i++){
      const result=await drainAccountOwnedNotifications(db,{
        uid,requestId,limit:3,
      });
      sizes.push(result.erased);
      assert.equal(result.completionVerified,false);
    }
    assert.deepEqual(sizes,[3,3,2]);
    for(const ref of notices)assert.equal((await ref.get()).exists,false);
    assert.equal((await third.get()).data().title,"retain");
    assert.equal((await user.get()).data().coins,150);
  }finally{
    await Promise.all(refs.map(ref=>ref.delete()));
  }
});

test("emulator: five-token cleanup preserves unrelated token ownership",async()=>{
  const suffix=sid(),uid="erase_device_"+suffix,other="other_device_"+suffix;
  const requestId="device_request_"+suffix;
  const nowMs=Date.now();
  const request=store.doc("account_deletion_requests/"+uid);
  const checkpoint=store.doc("account_deletion_erasure_checkpoints/"+uid);
  const user=store.doc("users/"+uid);
  const tokens=Array.from({length:5},(_,i)=>{
    const token="token-device-"+suffix+"-"+i+"-012345678901234567890123456789";
    const hash=createHash("sha256").update(token).digest("hex");
    return {
      device:store.doc("private_call_push_devices/"+uid+"/tokens/"+hash),
      owner:store.doc("private_call_push_token_owners/"+hash),
      token,
    };
  });
  const third=store.doc(
    "private_call_push_devices/"+other+"/tokens/other_token_"+suffix);
  const refs=[request,checkpoint,user,third,
    ...tokens.flatMap(x=>[x.device,x.owner])];
  refs.push(...await seedEmulatorErasureCertificates(store,{
    uid,requestId,nowMs,
  }));
  await Promise.all([
    request.set({uid,requestId,status:"processing",
      requestedAt:new Date(nowMs-40*86400_000)}),
    checkpoint.set({requestId,phase:"push_devices",destructiveAllowed:true,
      notificationRetentionCleared:true,legalEvidenceReviewComplete:true}),
    user.set({role:"user",accountStatus:"deletion_processing"}),
    ...tokens.flatMap(x=>[
      x.device.set({token:x.token,platform:"android"}),
      x.owner.set({uid}),
    ]),
    third.set({token:"unrelated-device"}),
  ]);
  try{
    const sizes=[];
    for(let i=0;i<3;i++){
      const result=await drainAccountPrivateCallPushDevices(db,{
        uid,requestId,limit:2,
      });
      sizes.push(result.erased);
    }
    assert.deepEqual(sizes,[2,2,1]);
    for(const entry of tokens){
      assert.equal((await entry.device.get()).exists,false);
      assert.equal((await entry.owner.get()).exists,false);
    }
    assert.equal((await third.get()).exists,true);
  }finally{
    await Promise.all(refs.map(ref=>ref.delete()));
  }
});
