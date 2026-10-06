import assert from "node:assert/strict";
import { after, test } from "node:test";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import {
  publishVip10GlobalEntry,
  vip10GlobalEntryState,
} from "../../cloudflare-worker/src/vip-actions.js";
import { cloudflareFirestoreAdapter } from "./helpers/cloudflare-firestore-adapter.js";

const app = initializeApp(
  { projectId: "shadow-live-vip10-global-entry-test" },
  "vip10-global-entry-" + Date.now(),
);
const adminDb = getFirestore(app);
const db = cloudflareFirestoreAdapter(adminDb);

after(async () => {
  await deleteApp(app);
});

const env = {
  ROOM_REALTIME: {
    idFromName(name) {
      return name;
    },
    get() {
      return {
        async fetch() {
          return Response.json({ ok: true, stored: 1, delivered: 1 });
        },
      };
    },
  },
};

async function seed(uid, level, nowMs) {
  const expiry = new Date(nowMs + 24 * 60 * 60 * 1000);
  await adminDb.collection("users").doc(uid).set({
    role: "user",
    adminEnabled: false,
    displayName: uid,
    publicId: "88" + uid.slice(-6).padStart(6, "0"),
    effectiveVipLevel: level,
    adminGrantVipLevel: level,
    adminGrantExpiresAt: level > 0 ? expiry : null,
    vipExpiresAt: level > 0 ? expiry : null,
  });
}

test("VIP10 global entry publishes once per Riyadh day", async () => {
  const nowMs = Date.UTC(2026, 9, 6, 5, 0, 0);
  const uid = "vip10_global_user";
  await seed(uid, 10, nowMs);

  const before = await vip10GlobalEntryState(db, uid, nowMs);
  assert.equal(before.eligible, true);
  assert.equal(before.alreadyPublished, false);

  const first = await publishVip10GlobalEntry(db, env, uid, nowMs);
  assert.equal(first.code, "published");
  assert.equal(first.alreadyPublished, true);
  assert.equal(first.realtimeShards, 16);
  assert.equal(first.event.kind, "vip10_global_entry");
  assert.equal(first.event.vipLevel, 10);

  const second = await publishVip10GlobalEntry(
    db,
    env,
    uid,
    nowMs + 60_000,
  );
  assert.equal(second.code, "already_published_today");

  const after = await vip10GlobalEntryState(db, uid, nowMs + 60_000);
  assert.equal(after.alreadyPublished, true);
});

test("VIP9 cannot publish the VIP10 global entry", async () => {
  const nowMs = Date.UTC(2026, 9, 6, 6, 0, 0);
  const uid = "vip9_global_user";
  await seed(uid, 9, nowMs);

  const state = await vip10GlobalEntryState(db, uid, nowMs);
  assert.equal(state.eligible, false);

  await assert.rejects(
    publishVip10GlobalEntry(db, env, uid, nowMs),
    /vip10_required/,
  );
});
