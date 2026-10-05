import assert from "node:assert/strict";
import { after, test } from "node:test";
import { deleteApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import { diaryCoreTestHooks } from "../../cloudflare-worker/src/diaries.js";
import { cloudflareFirestoreAdapter } from "./helpers/cloudflare-firestore-adapter.js";

const {
  createDiary,
  deleteDiary,
  listLatest,
  listFollowing,
  reportDiary,
} = diaryCoreTestHooks;

const app =
  getApps()[0] || initializeApp({ projectId: "shadow-live-economy-test" });
const firestore = getFirestore(app);
const db = cloudflareFirestoreAdapter(firestore);

after(async () => {
  await deleteApp(app);
});

function op(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

test("diary lifecycle integration: create latest following report delete", async () => {
  const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const ownerUid = `diary_owner_${suffix}`;
  const followerUid = `diary_follower_${suffix}`;
  const outsiderUid = `diary_outsider_${suffix}`;

  await Promise.all([
    firestore.collection("users").doc(ownerUid).set({
      role: "user",
      accountStatus: "active",
      displayName: "Diary Owner",
      publicId: "81234567",
    }),
    firestore.collection("users").doc(followerUid).set({
      role: "user",
      accountStatus: "active",
      displayName: "Diary Follower",
      publicId: "81234568",
    }),
    firestore.collection("users").doc(outsiderUid).set({
      role: "user",
      accountStatus: "active",
      displayName: "Diary Outsider",
      publicId: "81234569",
    }),
    firestore.collection("follows").doc(`${followerUid}__${ownerUid}`).set({
      followerUid,
      followingUid: ownerUid,
      createdAt: new Date(),
    }),
  ]);

  const created = await createDiary(db, ownerUid, {
    text: "Stage 09 integration diary",
    imageObjectIds: [],
    commentsEnabled: true,
    idempotencyKey: op("stage09_create"),
  });
  assert.equal(created.ok, true);
  assert.ok(created.diaryId);

  const latest = await listLatest(db, { limit: 30 });
  assert.equal(
    latest.items.some((item) => item.diaryId === created.diaryId),
    true,
  );

  const following = await listFollowing(db, followerUid, { limit: 30 });
  assert.equal(
    following.items.some((item) => item.diaryId === created.diaryId),
    true,
  );

  const report = await reportDiary(db, outsiderUid, {
    diaryId: created.diaryId,
    reason: "spam",
  });
  assert.equal(report.code, "created");

  const duplicate = await reportDiary(db, outsiderUid, {
    diaryId: created.diaryId,
    reason: "abusive_content",
  });
  assert.equal(duplicate.code, "duplicate");

  const deleted = await deleteDiary(db, ownerUid, {
    diaryId: created.diaryId,
    idempotencyKey: op("stage09_delete"),
  });
  assert.equal(deleted.ok, true);

  const [root, mirror] = await Promise.all([
    firestore.collection("diaries").doc(created.diaryId).get(),
    firestore
      .collection("users")
      .doc(ownerUid)
      .collection("diaries")
      .doc(created.diaryId)
      .get(),
  ]);
  assert.equal(root.exists, false);
  assert.equal(mirror.exists, false);
});
