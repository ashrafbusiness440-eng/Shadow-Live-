import assert from "node:assert/strict";
import { after, test } from "node:test";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import {
  profileVisitHistory,
  recordProfileVisit,
} from "../../cloudflare-worker/src/profile-visits.js";
import { setHideProfileVisits } from "../../cloudflare-worker/src/vip-actions.js";
import { cloudflareFirestoreAdapter } from "./helpers/cloudflare-firestore-adapter.js";

const app = initializeApp(
  { projectId: "shadow-live-profile-visits-test" },
  "profile-visits-" + Date.now(),
);
const db = getFirestore(app);
const cloudflareDb = cloudflareFirestoreAdapter(db);

after(async () => {
  await deleteApp(app);
});

const futureFrom = (nowMs) => new Date(nowMs + 24 * 60 * 60 * 1000);

async function seedUser(uid, level, nowMs, extra = {}) {
  const future = futureFrom(nowMs);
  await Promise.all([
    db.collection("users").doc(uid).set({
      role: "user",
      adminEnabled: false,
      earnedVipLevel: 0,
      adminGrantVipLevel: level,
      adminGrantExpiresAt: level > 0 ? future : null,
      effectiveVipLevel: level,
      vipExpiresAt: level > 0 ? future : null,
      ...extra,
    }),
    db.collection("public_profiles").doc(uid).set({
      uid,
      publicId: String(81000000 + Math.floor(Math.random() * 1000000)),
      displayName: uid,
      profileImageUrl: "",
      effectiveVipLevel: level,
      vipLevel: level,
      vipExpiresAt: level > 0 ? future : null,
    }),
  ]);
}

test("profile visits are bounded visible history and VIP9 hidden visits stay private", async () => {
  const nowMs = Date.UTC(2026, 9, 5, 20, 0, 0);
  const suffix = Date.now().toString();
  const target = "visit_target_" + suffix;
  const normal = "visit_normal_" + suffix;
  const hidden = "visit_hidden_" + suffix;

  await Promise.all([
    seedUser(target, 1, nowMs),
    seedUser(normal, 1, nowMs),
    seedUser(hidden, 9, nowMs),
  ]);

  await recordProfileVisit(
    cloudflareDb,
    normal,
    { targetUid: target },
    nowMs,
  );

  const targetHistory = await profileVisitHistory(
    cloudflareDb,
    target,
    { mode: "visitors" },
    nowMs,
  );
  assert.equal(targetHistory.limit, 50);
  assert.equal(targetHistory.items.length, 1);
  assert.equal(targetHistory.items[0].uid, normal);

  const normalVisited = await profileVisitHistory(
    cloudflareDb,
    normal,
    { mode: "visited" },
    nowMs,
  );
  assert.equal(normalVisited.items.length, 1);
  assert.equal(normalVisited.items[0].uid, target);

  const hiddenPreference = await setHideProfileVisits(
    cloudflareDb,
    hidden,
    { enabled: true },
    nowMs,
  );
  assert.equal(hiddenPreference.hideProfileVisits, true);
  assert.equal(hiddenPreference.requiredVipLevel, 9);

  await recordProfileVisit(
    cloudflareDb,
    hidden,
    { targetUid: target },
    nowMs + 1000,
  );

  const visibleAfterHidden = await profileVisitHistory(
    cloudflareDb,
    target,
    { mode: "visitors" },
    nowMs + 1000,
  );
  assert.equal(
    visibleAfterHidden.items.some((item) => item.uid === hidden),
    false,
  );

  const [privateVisit, hiddenVisited] = await Promise.all([
    db
      .collection("profile_visit_private")
      .doc(target)
      .collection("items")
      .doc(hidden)
      .get(),
    profileVisitHistory(
      cloudflareDb,
      hidden,
      { mode: "visited" },
      nowMs + 1000,
    ),
  ]);
  assert.equal(privateVisit.exists, true);
  assert.equal(privateVisit.data().hidden, true);
  assert.equal(hiddenVisited.items.length, 1);
  assert.equal(hiddenVisited.items[0].uid, target);
  assert.equal(hiddenVisited.items[0].hidden, true);
});

test("profile visit history is unavailable below VIP1 and hide preference below VIP9", async () => {
  const nowMs = Date.UTC(2026, 9, 5, 21, 0, 0);
  const uid = "visit_locked_" + Date.now();
  await seedUser(uid, 0, nowMs);

  await assert.rejects(
    profileVisitHistory(cloudflareDb, uid, { mode: "visitors" }, nowMs),
    /profile_visit_history_requires_vip1/,
  );
  await assert.rejects(
    setHideProfileVisits(cloudflareDb, uid, { enabled: true }, nowMs),
    /hide_profile_visits_requires_vip9/,
  );

  const disabled = await setHideProfileVisits(
    cloudflareDb,
    uid,
    { enabled: false },
    nowMs,
  );
  assert.equal(disabled.hideProfileVisits, false);
  assert.equal(disabled.canHideProfileVisits, false);
});


test("mysterious person hides profile visits independently from VIP", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(
    new URL("../../cloudflare-worker/src/profile-visits.js", import.meta.url),
    "utf8",
  );
  assert.equal(source.includes("activeMysteriousIdentity(visitorUser, nowMs)"), true);
  assert.equal(source.includes("const hidden = hiddenByVip || hiddenByMysterious"), true);
  assert.equal(
    source.includes("visitorUser.hideProfileVisits === true && entitlements.hideProfileVisits"),
    true,
  );
});
