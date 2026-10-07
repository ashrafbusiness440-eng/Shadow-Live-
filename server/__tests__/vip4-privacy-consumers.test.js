import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  vip4PrivacyPreferencesFromUser,
} from "../../cloudflare-worker/src/vip-entitlements.js";
import {
  setVip4PrivacyPreference,
} from "../../cloudflare-worker/src/vip-actions.js";

const DAY_MS = 24 * 60 * 60 * 1000;

test("06-H VIP4 privacy flags expire with effective VIP", () => {
  const nowMs = Date.UTC(2026, 9, 6, 8, 0, 0);
  const active = {
    effectiveVipLevel: 4,
    vipExpiresAt: new Date(nowMs + DAY_MS),
    hideNobleLevel: true,
    hideGameWinBanner: true,
    hideBetWinNotification: true,
  };
  assert.deepEqual(vip4PrivacyPreferencesFromUser(active, nowMs), {
    hideNobleLevel: true,
    hideGameWinBanner: true,
    hideBetWinNotification: true,
  });

  assert.deepEqual(
    vip4PrivacyPreferencesFromUser(
      { ...active, effectiveVipLevel: 3 },
      nowMs,
    ),
    {
      hideNobleLevel: false,
      hideGameWinBanner: false,
      hideBetWinNotification: false,
    },
  );

  assert.deepEqual(
    vip4PrivacyPreferencesFromUser(
      { ...active, vipExpiresAt: new Date(nowMs - 1) },
      nowMs,
    ),
    {
      hideNobleLevel: false,
      hideGameWinBanner: false,
      hideBetWinNotification: false,
    },
  );
});

class FakeDb {
  constructor(user) {
    this.user = structuredClone(user);
    this.writes = [];
    this.rollbacks = 0;
  }

  async beginTransaction() {
    return { active: true };
  }

  async get(path) {
    assert.equal(path, "users/user");
    return { exists: true, data: structuredClone(this.user) };
  }

  writeUpdate(path, fields, fieldPaths) {
    return { kind: "update", path, fields, fieldPaths };
  }

  async commit(_transaction, writes) {
    this.writes.push(...structuredClone(writes));
    const userWrite = writes.find((item) => item.path === "users/user");
    if (userWrite) Object.assign(this.user, structuredClone(userWrite.fields));
  }

  async rollback() {
    this.rollbacks += 1;
  }
}

test("06-H Noble privacy is projected server-side without creating a Nobles surface", async () => {
  const nowMs = Date.UTC(2026, 9, 6, 8, 0, 0);
  const db = new FakeDb({
    effectiveVipLevel: 4,
    vipExpiresAt: new Date(nowMs + DAY_MS),
  });

  const result = await setVip4PrivacyPreference(
    db,
    "user",
    { field: "hideNobleLevel", enabled: true },
    nowMs,
  );

  assert.equal(result.enabled, true);
  assert.deepEqual(
    db.writes.map((item) => item.path),
    ["users/user", "public_profiles/user"],
  );
  const publicWrite = db.writes[1];
  assert.equal(publicWrite.fields.hideNobleLevel, true);
  assert.deepEqual(publicWrite.fieldPaths, ["hideNobleLevel", "updatedAt"]);
});

test("06-H game privacy stays a broadcast contract and does not alter settlement accounting", () => {
  const source = readFileSync(
    "cloudflare-worker/src/legacy-games/game-runtime.js",
    "utf8",
  );

  assert.match(source, /vip4PrivacyPreferencesFromUser\(user,nowMs\)/);
  assert.match(
    source,
    /publicWinBannerHidden:vipPrivacy\.hideGameWinBanner/,
  );
  assert.match(
    source,
    /publicBetWinNotificationHidden:vipPrivacy\.hideBetWinNotification/,
  );
  assert.match(source, /type:"game_payout_credit"/);
  assert.match(source, /financial_ledger/);

  // Game wins now use the already-existing shared app celebration feed.
  // Privacy still suppresses only the banner; settlement/ledger stay untouched.
  assert.match(source, /publishGlobalAppEvents/);
  assert.match(
    source,
    /operation\.publicWinBannerHidden===true/,
  );
  assert.doesNotMatch(source, /broadcast.*app\.global_event/i);
});
