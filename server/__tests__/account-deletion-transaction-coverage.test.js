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
];
const source = stage => readFileSync(
  "cloudflare-worker/src/account-deletion-" + stage + "-stage.js","utf8");

test("seven erasure write stages share one transaction-scoped six-domain gate",()=>{
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

test("private text remains an explicit release blocker, not falsely certified",()=>{
  const src=source("private-text");
  assert.equal(src.includes("recheckErasureCertificatesInTransaction"),false);
  // NEVER flip this to true by removing private text from the inventory.
  // First wire a recheck in the actual same transaction and add emulator
  // race tests, then replace this intentional known-gap assertion.
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
