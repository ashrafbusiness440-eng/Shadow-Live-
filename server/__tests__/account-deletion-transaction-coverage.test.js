import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// Reuse-First regression inventory: these are the exact guarded internal
// record/write stages. All write transactions must recheck the SAME
// independently audited six-domain signoffs, never a weaker local policy.
const guarded = [
  "notification",
  "private-call-push",
  "diary-interaction",
  "public-profile",
  "social-pair",
  "support-snapshot",
  "r2-queue",
  "private-text",
];
const source = stage => readFileSync(
  "cloudflare-worker/src/account-deletion-" + stage + "-stage.js","utf8");

test("eight erasure write stages share one transaction-scoped six-domain gate",()=>{
  for(const stage of guarded){
    const src=source(stage);
    const check=src.indexOf("await recheckErasureCertificatesInTransaction(");
    const commit=src.indexOf("await db.commit(");
    assert.ok(check>=0,"missing signoff recheck in "+stage);
    assert.ok(commit>check,"recheck must precede commit in "+stage);
    assert.match(src,/requestedAt/,"request timestamp must be validated: "+stage);
    assert.match(src,/destructiveAllowed\s*!==\s*true/);
  }
});

test("private-text write is transactionally certified but the release remains disabled",()=>{
  const src=source("private-text");
  const checked=src.indexOf("await recheckErasureCertificatesInTransaction(");
  const wrote=src.indexOf("await db.commit(");
  assert.ok(checked>=0 && wrote>checked);
  const runner=readFileSync(
    "cloudflare-worker/src/account-deletion-internal-phase-runner.js","utf8");
  // Do not unlock until an actual REST/Emulator signoff-revocation race
  // and independently approved financial/legal retention evidence exist.
  assert.match(runner,/private_text_erasure_transaction_guard_missing/);
});

test("production dispatcher never exposes guarded stages as a route or cron",()=>{
  const admin=readFileSync("cloudflare-worker/src/admin-inbox.js","utf8");
  const runner=readFileSync(
    "cloudflare-worker/src/account-deletion-internal-phase-runner.js","utf8");
  assert.doesNotMatch(admin,/account-deletion-internal-phase-runner/);
  assert.doesNotMatch(runner,/deleteAuthUser\(|bucket\.delete\(|setInterval\(/);
  assert.match(runner,/completionVerified: false/);
});

test("R2 account worker checks live certified job before media scan, each object, and job completion",()=>{
  const src=readFileSync("cloudflare-worker/src/user-storage.js","utf8");
  const start=src.indexOf("export async function runDeletedAccountStorageCleanup(");
  const end=src.indexOf("export async function claimDueApprovedDiaryCleanup(",start);
  assert.ok(start>=0&&end>start);
  const worker=src.slice(start,end);
  const calls=worker.match(/verifyAccountStorageCleanupJob\(db, job\)/g)||[];
  assert.equal(calls.length,3);
  assert.ok(worker.indexOf("verifyAccountStorageCleanupJob(db, job)") <
    worker.indexOf('db.runQuery("storage_objects"'));
  assert.ok(worker.indexOf("for (const item of objects)") <
    worker.lastIndexOf("verifyAccountStorageCleanupJob(db, job)"));
  assert.match(src,/recheckErasureCertificatesInTransaction\(db, tx,/);
  assert.match(src,/requestedAt: request.data\?\.requestedAt/);
});

test("unguarded private-text erasure is explicitly disabled at the internal dispatcher",()=>{
  const runner=readFileSync(
    "cloudflare-worker/src/account-deletion-internal-phase-runner.js","utf8");
  const check=runner.indexOf('if (step === "private_text") {');
  const reads=runner.indexOf('db.get(requestPath)');
  assert.ok(check>=0 && reads>check);
  assert.match(runner,/private_text_erasure_transaction_guard_missing/);
  // The direct primitive is now same-transaction certified and remains
  // unrouted and dispatcher-blocked until release evidence is complete.
  const module=source("private-text");
  assert.match(module,/recheckErasureCertificatesInTransaction/);
});
