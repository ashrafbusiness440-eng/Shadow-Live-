import assert from "node:assert/strict";
import { test } from "node:test";

import {
  activeMysteriousIdentity,
  applyMysteriousIdentityPresentation,
} from "../../cloudflare-worker/src/mysterious-identity.js";

test("active mysterious identity swaps display only and keeps ranking values", () => {
  const now = Date.UTC(2026, 9, 8);
  const base = {
    uid: "real_uid",
    displayName: "Real Name",
    profileImageUrl: "https://example.test/real.webp",
    publicId: "12345678",
    rank: 2,
    totalSupport: 5000000,
    dailySupport: 5000000,
    vipLevel: 7,
    wealthLevel: 30,
  };
  const user = {
    mysteriousEnabled: true,
    mysteriousId: "987654321",
    mysteriousExpiresAt: new Date(now + 86400000),
  };
  const value = applyMysteriousIdentityPresentation(base, user, now);

  assert.equal(activeMysteriousIdentity(user, now), true);
  assert.equal(value.displayName, "الشخص الغامض");
  assert.equal(value.profileImageUrl, "");
  assert.equal(value.publicId, "987654321");
  assert.equal(value.mysteriousMode, true);
  assert.equal(value.rank, 2);
  assert.equal(value.totalSupport, 5000000);
  assert.equal(value.dailySupport, 5000000);
  assert.equal("uid" in value, false);
  assert.equal("userId" in value, false);
  assert.equal("targetUid" in value, false);
  assert.equal("ownerUid" in value, false);
  assert.equal("hostUid" in value, false);
  assert.equal(value.vipLevel, 0);
  assert.equal(value.wealthLevel, 0);
});

test("expired or disabled mysterious identity leaves normal presentation", () => {
  const now = Date.UTC(2026, 9, 8);
  const base = {
    displayName: "Real Name",
    profileImageUrl: "real.webp",
    publicId: "12345678",
  };
  const expired = applyMysteriousIdentityPresentation(base, {
    mysteriousEnabled: true,
    mysteriousId: "987654321",
    mysteriousExpiresAt: new Date(now - 1),
  }, now);
  assert.equal(expired.displayName, "Real Name");
  assert.equal(expired.mysteriousMode, false);

  const disabled = applyMysteriousIdentityPresentation(base, {
    mysteriousEnabled: false,
    mysteriousId: "987654321",
    mysteriousPermanent: true,
  }, now);
  assert.equal(disabled.displayName, "Real Name");
  assert.equal(disabled.mysteriousMode, false);
});

test("room supporter integration reuses the existing bounded user batch", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(
    new URL("../../cloudflare-worker/src/voice-session-legacy.js", import.meta.url),
    "utf8",
  );
  assert.equal(source.includes("supporterRankingUserSnapshots(db,list,viewerUid,3)"), true);
  assert.equal(source.includes("supporterRankingUserSnapshots(db,list,viewerUid,50)"), true);
  assert.equal(source.includes("applyMysteriousIdentityPresentation"), true);
  assert.equal(source.includes("byUidData.get(userId)||{}"), true);
});


test("mysterious identity never leaks outside approved room presentation paths", async () => {
  const { readFile } = await import("node:fs/promises");
  const publicProfile = await readFile(
    new URL("../../cloudflare-worker/src/public-profile-presentation.js", import.meta.url),
    "utf8",
  );
  const chatActions = await readFile(
    new URL("../../cloudflare-worker/src/chat-safety-actions.js", import.meta.url),
    "utf8",
  );
  assert.equal(publicProfile.includes("applyMysteriousIdentityPresentation"), false);
  assert.equal(publicProfile.includes("mysteriousMode"), false);
  assert.equal(chatActions.includes("applyMysteriousIdentityPresentation"), false);
  assert.equal(chatActions.includes("mysteriousMode"), false);
});
