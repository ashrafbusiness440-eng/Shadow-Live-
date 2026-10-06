import assert from "node:assert/strict";
import { after, test } from "node:test";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import {
  assignFancyId,
  fancyIdState,
  resolveUserId,
  validateFancyResolution,
} from "../../cloudflare-worker/src/vip-fancy-id.js";
import { cloudflareFirestoreAdapter } from "./helpers/cloudflare-firestore-adapter.js";

const app = initializeApp(
  { projectId: "shadow-live-vip-fancy-id-test" },
  "vip-fancy-" + Date.now(),
);
const db = getFirestore(app);
const cloudflareDb = cloudflareFirestoreAdapter(db);

after(async () => {
  await deleteApp(app);
});

async function seedUser(uid, publicId, level, expiresAt) {
  await Promise.all([
    db.collection("users").doc(uid).set({
      publicId,
      effectiveVipLevel: level,
      earnedVipLevel: level,
      earnedVipExpiresAt: expiresAt,
      vipExpiresAt: expiresAt,
    }),
    db.collection("public_profiles").doc(uid).set({
      uid,
      publicId,
      displayName: uid,
      effectiveVipLevel: level,
      vipLevel: level,
      vipExpiresAt: expiresAt,
    }),
    db.collection("public_ids").doc(publicId).set({
      uid,
      reserved: false,
    }),
  ]);
}

test("Fancy ID is unique, indexed, and resolves to the same UID", async () => {
  const nowMs = Date.UTC(2026, 9, 6, 8, 0, 0);
  const expiry = new Date(nowMs + 7 * 24 * 60 * 60 * 1000);
  const suffix = Date.now().toString().slice(-6);
  const a = "fancy_a_" + suffix;
  const b = "fancy_b_" + suffix;
  const publicA = "81" + suffix;
  const publicB = "82" + suffix;
  const fancy = "77" + suffix.slice(-4);

  await Promise.all([
    seedUser(a, publicA, 3, expiry),
    seedUser(b, publicB, 3, expiry),
  ]);

  const first = await assignFancyId(
    cloudflareDb,
    a,
    {
      fancyId: fancy,
      idempotencyKey: "assign_fancy_a_" + suffix,
    },
    nowMs,
  );
  assert.equal(first.fancyId, fancy);
  assert.ok(first.assignmentId);

  const resolved = await resolveUserId(cloudflareDb, fancy, nowMs);
  assert.equal(resolved.source, "fancy");
  assert.equal(resolved.uid, a);
  assert.equal(resolved.assignmentId, first.assignmentId);

  await assert.rejects(
    assignFancyId(
      cloudflareDb,
      b,
      {
        fancyId: fancy,
        idempotencyKey: "assign_fancy_b_" + suffix,
      },
      nowMs,
    ),
    /fancy_id_taken/,
  );

  const basicResolved = await resolveUserId(cloudflareDb, publicA, nowMs);
  assert.equal(basicResolved.source, "basic");
  assert.equal(basicResolved.uid, a);
});

test("Fancy ID expiry clears active mapping and permits reuse", async () => {
  const nowMs = Date.UTC(2026, 9, 6, 9, 0, 0);
  const suffix = Date.now().toString().slice(-6);
  const a = "fancy_exp_a_" + suffix;
  const b = "fancy_exp_b_" + suffix;
  const publicA = "83" + suffix;
  const publicB = "84" + suffix;
  const fancy = "66" + suffix.slice(-4);
  const expiry = new Date(nowMs + 1000);

  await Promise.all([
    seedUser(a, publicA, 3, expiry),
    seedUser(
      b,
      publicB,
      3,
      new Date(nowMs + 7 * 24 * 60 * 60 * 1000),
    ),
  ]);

  await assignFancyId(
    cloudflareDb,
    a,
    {
      fancyId: fancy,
      idempotencyKey: "assign_exp_a_" + suffix,
    },
    nowMs,
  );

  const expired = await fancyIdState(cloudflareDb, a, nowMs + 2000);
  assert.equal(expired.active, false);
  assert.equal(expired.fancyId, "");

  const reused = await assignFancyId(
    cloudflareDb,
    b,
    {
      fancyId: fancy,
      idempotencyKey: "assign_exp_b_" + suffix,
    },
    nowMs + 2000,
  );
  assert.equal(reused.fancyId, fancy);

  const resolved = await resolveUserId(cloudflareDb, fancy, nowMs + 2000);
  assert.equal(resolved.uid, b);
});

test("Race validation rejects stale Fancy ID assignment versions", async () => {
  const nowMs = Date.UTC(2026, 9, 6, 10, 0, 0);
  const suffix = Date.now().toString().slice(-6);
  const uid = "fancy_race_" + suffix;
  const publicId = "85" + suffix;
  const firstFancy = "55" + suffix.slice(-4);
  const secondFancy = "44" + suffix.slice(-4);
  const expiry = new Date(nowMs + 7 * 24 * 60 * 60 * 1000);

  await seedUser(uid, publicId, 3, expiry);
  const first = await assignFancyId(
    cloudflareDb,
    uid,
    {
      fancyId: firstFancy,
      idempotencyKey: "assign_race_1_" + suffix,
    },
    nowMs,
  );

  const firstResolution = await resolveUserId(
    cloudflareDb,
    firstFancy,
    nowMs,
  );

  await assignFancyId(
    cloudflareDb,
    uid,
    {
      fancyId: secondFancy,
      idempotencyKey: "assign_race_2_" + suffix,
    },
    nowMs + 1000,
  );

  await assert.rejects(
    validateFancyResolution(
      cloudflareDb,
      {
        fancyId: firstFancy,
        uid,
        assignmentId: firstResolution.assignmentId,
        assignmentVersion: firstResolution.assignmentVersion,
      },
      nowMs + 1000,
    ),
    /fancy_id_resolution_stale/,
  );

  assert.notEqual(first.assignmentId, "");
});
