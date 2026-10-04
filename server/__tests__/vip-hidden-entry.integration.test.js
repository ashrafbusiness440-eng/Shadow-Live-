import assert from "node:assert/strict";
import { after, test } from "node:test";
import { deleteApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import {
  roomHiddenEntryState,
  setRoomHiddenEntry,
} from "../../cloudflare-worker/src/voice-session-legacy.js";

const app =
  getApps()[0] || initializeApp({ projectId: "shadow-live-vip-hidden-entry-test" });
const db = getFirestore(app);

after(async () => {
  await deleteApp(app);
});

const future = () => new Date(Date.now() + 24 * 60 * 60 * 1000);
const expired = () => new Date(Date.now() - 1000);

async function seedUser(uid, data = {}) {
  await db.collection("users").doc(uid).set({
    role: "user",
    adminEnabled: false,
    effectiveVipLevel: 0,
    vipExpiresAt: null,
    roomHiddenEntry: false,
    roomGhostMode: false,
    ...data,
  });
}

test("VIP6 cannot enable hidden entry while VIP7 can", async () => {
  const vip6 = "hidden_entry_vip6";
  const vip7 = "hidden_entry_vip7";

  await Promise.all([
    seedUser(vip6, {
      effectiveVipLevel: 6,
      vipExpiresAt: future(),
    }),
    seedUser(vip7, {
      effectiveVipLevel: 7,
      vipExpiresAt: future(),
    }),
  ]);

  await assert.rejects(
    setRoomHiddenEntry(db, vip6, { enabled: true }),
    /hidden_entry_requires_vip7/,
  );

  const enabled = await setRoomHiddenEntry(db, vip7, { enabled: true });
  assert.equal(enabled.hiddenRoomEntry, true);
  assert.equal(enabled.canUseHiddenRoomEntry, true);
  assert.equal(enabled.requiredVipLevel, 7);

  const state = await roomHiddenEntryState(db, vip7);
  assert.equal(state.hiddenRoomEntry, true);
  assert.equal(state.canUseHiddenRoomEntry, true);

  const user = await db.collection("users").doc(vip7).get();
  assert.equal(user.data().roomHiddenEntry, true);
  assert.equal(user.data().roomGhostMode, false);
});

test("expired VIP7 cannot keep or enable hidden entry", async () => {
  const uid = "hidden_entry_expired";
  await seedUser(uid, {
    effectiveVipLevel: 7,
    vipExpiresAt: expired(),
    roomHiddenEntry: true,
  });

  const state = await roomHiddenEntryState(db, uid);
  assert.equal(state.hiddenRoomEntry, false);
  assert.equal(state.canUseHiddenRoomEntry, false);

  await assert.rejects(
    setRoomHiddenEntry(db, uid, { enabled: true }),
    /hidden_entry_requires_vip7/,
  );
});

test("hidden entry can always be disabled without changing Ghost", async () => {
  const uid = "hidden_entry_disable";
  await seedUser(uid, {
    effectiveVipLevel: 6,
    vipExpiresAt: future(),
    roomHiddenEntry: true,
    roomGhostMode: true,
  });

  const disabled = await setRoomHiddenEntry(db, uid, { enabled: false });
  assert.equal(disabled.hiddenRoomEntry, false);

  const user = await db.collection("users").doc(uid).get();
  assert.equal(user.data().roomHiddenEntry, false);
  assert.equal(user.data().roomGhostMode, true);
});
