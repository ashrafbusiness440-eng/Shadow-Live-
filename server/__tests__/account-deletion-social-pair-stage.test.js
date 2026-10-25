import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import {removeDeletedAccountSocialPair} from "../../cloudflare-worker/src/account-deletion-social-pair-stage.js";
import { seedSyntheticErasureCertificates }
  from "./helpers/account-erasure-synthetic-certificates.js";
const uid="deleted_member_123",otherUid="other_member_456",requestId="current_request_12345678";
const rp="account_deletion_requests/"+uid,cp="account_deletion_erasure_checkpoints/"+uid,up="users/"+uid;
const paths=[
 `follows/${uid}__${otherUid}`,`follows/${otherUid}__${uid}`,
 `user_blocks/${uid}/items/${otherUid}`,`user_blocks/${otherUid}/items/${uid}`,
];
class Db{
 constructor(){
  this.docs=new Map([
   [rp,{uid,requestId,status:"processing",requestedAt:new Date(Date.now()-40*86400_000)}],
   [cp,{requestId,phase:"social_links",destructiveAllowed:true}],
   [up,{role:"user",accountStatus:"deletion_processing"}],
   [paths[0],{followerUid:uid,followingUid:otherUid}],
   [paths[1],{followerUid:otherUid,followingUid:uid}],
   [paths[2],{blockerUid:uid,blockedUid:otherUid}],
   [paths[3],{blockerUid:otherUid,blockedUid:uid}],
   ["follows/other_member_456__third_member_789",
      {followerUid:otherUid,followingUid:"third_member_789"}],
  ]);
  seedSyntheticErasureCertificates(this.docs,{uid,requestId});
  this.commits=[];this.rollbacks=0;
 }
 async beginTransaction(){return "tx";}
 async get(path,tx){assert.equal(tx,"tx");return {exists:this.docs.has(path),data:this.docs.get(path)??null};}
 writeDelete(path){return {kind:"delete",path};}
 async commit(tx,writes){assert.equal(tx,"tx");const copied=new Map(this.docs);for(const w of writes){copied.delete(w.path);}this.docs=copied;this.commits.push(writes);}
 async rollback(tx){assert.equal(tx,"tx");this.rollbacks++;}
}
const run=(db,overrides={})=>removeDeletedAccountSocialPair(db,{uid,otherUid,requestId,...overrides});
test("only four directly related follows/blocks deleted; unrelated followers remain",async()=>{
 const db=new Db();
 assert.deepEqual(await run(db),{ok:true,removed:4,duplicate:false});
 for(const path of paths)assert.equal(db.docs.has(path),false);
 assert.equal(db.docs.has("follows/other_member_456__third_member_789"),true);
 assert.deepEqual(await run(db),{ok:true,removed:0,duplicate:true});
 assert.equal(db.commits.length,1);
});
test("no cleanup if cancellation, hold, old request or owner account",async()=>{
 const mods=[
 d=>d.docs.get(rp).status="cancelled",
 d=>d.docs.get(rp).reviewHold=true,
 d=>d.docs.get(rp).appealPending=true,
 d=>d.docs.get(cp).appealStatus="Under_Review",
 d=>d.docs.get(up).appealPending=true,
 d=>d.docs.get(rp).requestId="stale_request_12345",
 d=>d.docs.get(cp).phase="preflight_blocked",
 d=>d.docs.get(cp).requestId="stale_request_12345",
 d=>d.docs.get(cp).destructiveAllowed=false,
 d=>d.docs.get(cp).legalHold=true,
 d=>d.docs.get(cp).evidenceHold=true,
 d=>d.docs.get(rp).investigationHold=true,
 d=>d.docs.get(up).accountStatus="active",
 d=>d.docs.get(up).role="owner",
 d=>d.docs.get(up).retentionHold=true,
 d=>d.docs.delete(up),
 ];
 for(const mod of mods){const db=new Db();mod(db);
  await assert.rejects(run(db),e=>e.code==="social_pair_erasure_blocked");
  assert.equal(db.commits.length,0);assert.equal(db.docs.has(paths[0]),true);
 }
});
test("a hold on ANY individual follows/blocks row prevents the whole transaction",async()=>{
 for(const path of paths){
  for(const flag of ["legalHold","retentionHold","evidenceHold","investigationHold","appealPending"]){
   const db=new Db();db.docs.get(path)[flag]=true;
   await assert.rejects(run(db),e=>e.code==="social_pair_retention_hold");
   assert.equal(db.commits.length,0);
   for(const id of paths)assert.equal(db.docs.has(id),true);
  }
 }
});
test("appealStatus open on a reciprocal relationship stops all four deletions",async()=>{
 for(const path of paths){
  const db=new Db();db.docs.get(path).appealStatus="Open";
  await assert.rejects(run(db),e=>e.code==="social_pair_retention_hold");
  assert.equal(db.commits.length,0);
  for(const id of paths)assert.equal(db.docs.has(id),true);
 }
});
test("a corrupt legacy follow or block cannot cause partial cleanup",async()=>{
 const db=new Db();db.docs.get(paths[3]).blockedUid="somebody_else";
 await assert.rejects(run(db),e=>e.code==="social_pair_owner_conflict");
 assert.equal(db.commits.length,0);
 for(const path of paths)assert.equal(db.docs.has(path),true);
});
test("reject invalid IDs or transaction failure before any rows removed",async()=>{
 const db=new Db();
 await assert.rejects(run(db,{otherUid:"../../bad"}),e=>e.status===400);
 await assert.rejects(run(db,{otherUid:uid}),e=>e.status===400);
 db.commit=async()=>{throw Error("commit_failed");};
 await assert.rejects(run(db),/commit_failed/);
 assert.equal(db.docs.has(paths[0]),true);
});
test("no global scans, no Auth, no message/financial deletion",()=>{
 const source=readFileSync("cloudflare-worker/src/account-deletion-social-pair-stage.js","utf8");
 assert.doesNotMatch(source,/runQuery\(|\.list\(|deleteAuthUser\(|financial_ledger|conversations\/|messages\//);
 assert.match(source,/destructiveAllowed!==true/);
});

test("revoked certification protects all social relations before any write",async()=>{
  const db=new Db();
  db.docs.get("account_deletion_erasure_approvals/"+requestId+
    "__shared_assets").appealStatus="open";
  await assert.rejects(run(db),
    e=>e.code==="erasure_transactional_certification_blocked");
  assert.equal(db.commits.length,0);
  for(const path of paths)assert.equal(db.docs.has(path),true);
});
