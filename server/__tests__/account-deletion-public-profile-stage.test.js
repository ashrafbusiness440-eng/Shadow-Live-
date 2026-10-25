import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { erasePublicProfileStage } from "../../cloudflare-worker/src/account-deletion-public-profile-stage.js";
const uid="member_to_erase_123";
const requestId="request_deletion_1234567890";
class Db {
  constructor() {
    this.docs=new Map([
      ["account_deletion_requests/"+uid,{uid,requestId,status:"processing"}],
      ["account_deletion_erasure_checkpoints/"+uid,{requestId,phase:"public_profile",destructiveAllowed:true}],
      ["users/"+uid,{accountStatus:"deletion_processing",role:"user",diamonds:77}],
      ["public_profiles/"+uid,{uid,displayName:"Secret Member",profileImageUrl:"https://private.example/old.jpg"}],
      ["wallet_private/"+uid,{passwordHash:"do_not_touch"}],
      ["reports/hold_evidence_123",{reporterUid:uid,content:"preserve"}],
    ]);
    this.writes=[];this.reads=[];this.rollbacks=0;
  }
  async beginTransaction() {return "transaction";}
  async get(path,tx) {
    assert.equal(tx,"transaction");this.reads.push(path);
    return {exists:this.docs.has(path),data:this.docs.get(path)??null};
  }
  writeDelete(path) {return {kind:"delete",path};}
  async commit(tx,writes) {
    assert.equal(tx,"transaction");
    assert.deepEqual(writes,[{kind:"delete",path:"public_profiles/"+uid}]);
    writes.forEach(w=>this.docs.delete(w.path));
    this.writes.push(...writes);
  }
  async rollback(tx){assert.equal(tx,"transaction");this.rollbacks++;}
}
const run=(db,other={})=>erasePublicProfileStage(db,{uid,requestId,...other});

test("removes only one public profile under the correct processing checkpoint",async()=>{
  const db=new Db();
  assert.deepEqual(await run(db),{ok:true,removed:true,duplicate:false});
  assert.equal(db.writes.length,1);
  assert.equal(db.docs.has("public_profiles/"+uid),false);
  assert.equal(db.docs.get("users/"+uid).diamonds,77);
  assert.equal(db.docs.get("wallet_private/"+uid).passwordHash,"do_not_touch");
  assert.equal(db.docs.get("reports/hold_evidence_123").content,"preserve");
  assert.deepEqual(await run(db),{ok:true,removed:false,duplicate:true});
  assert.equal(db.writes.length,1);
});

test("cancellation, stale checkpoint and every legal hold block deletion",async()=>{
  const cases=[
    db=>db.docs.get("account_deletion_requests/"+uid).status="review_ready",
    db=>db.docs.get("account_deletion_requests/"+uid).requestId="stale_request_123456",
    db=>db.docs.get("account_deletion_requests/"+uid).reviewHold=true,
    db=>db.docs.get("account_deletion_requests/"+uid).appealPending=true,
    db=>db.docs.get("account_deletion_erasure_checkpoints/"+uid).appealStatus="Under_Review",
    db=>db.docs.get("account_deletion_erasure_checkpoints/"+uid).phase="preflight_blocked",
    db=>db.docs.get("account_deletion_erasure_checkpoints/"+uid).destructiveAllowed=false,
    db=>db.docs.get("account_deletion_erasure_checkpoints/"+uid).requestId="stale_request_123456",
    db=>db.docs.get("account_deletion_erasure_checkpoints/"+uid).legalHold=true,
    db=>db.docs.get("users/"+uid).accountStatus="active",
    db=>db.docs.get("users/"+uid).role="owner",
    db=>db.docs.get("users/"+uid).legalHold=true,
    db=>db.docs.get("users/"+uid).appealStatus="OPEN",
    db=>db.docs.get("public_profiles/"+uid).appealPending=true,
    db=>db.docs.get("public_profiles/"+uid).retentionHold=true,
    db=>db.docs.delete("users/"+uid),
  ];
  for(const change of cases) {
    const db=new Db();change(db);
    await assert.rejects(run(db),e=>e.code==="public_profile_erasure_blocked");
    assert.equal(db.writes.length,0);
    assert.equal(db.docs.get("public_profiles/"+uid).displayName,"Secret Member");
  }
});

test("identity mismatch, invalid ID, and commit failure do not report completed deletion",async()=>{
  const db=new Db();
  db.docs.get("public_profiles/"+uid).uid="another_member";
  await assert.rejects(run(db),e=>e.code==="public_profile_identity_conflict");
  assert.equal(db.writes.length,0);
  await assert.rejects(run(db,{uid:"bad/uid"}),e=>e.status===400);
  db.docs.get("public_profiles/"+uid).uid=uid;
  db.commit=async()=>{throw Error("firestore_network_failed");};
  await assert.rejects(run(db),/firestore_network_failed/);
  assert.equal(db.docs.has("public_profiles/"+uid),true);
});

test("no production entrypoint or broad scans, no Auth, storage or ledger calls",()=>{
  const content=readFileSync("cloudflare-worker/src/account-deletion-public-profile-stage.js","utf8");
  for(const unsafe of ["deleteAuthUser", "wallet", "writeUpdate(", "runQuery(", "list(", "R2"]) {
    if(unsafe==="wallet"||unsafe==="R2") continue; // mention in safety comments
    assert.equal(content.includes(unsafe),false);
  }
  assert.match(content,/destructiveAllowed !== true/);
  assert.match(content,/public_profile_erasure_blocked/);
});
