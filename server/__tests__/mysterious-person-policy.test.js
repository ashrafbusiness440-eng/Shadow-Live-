import assert from "node:assert/strict";
import { test } from "node:test";

import {
  mysteriousCandidateFromUint32,
  mysteriousPolicyFromConfig,
  mysteriousStateFromUser,
} from "../../cloudflare-worker/src/mysterious-person.js";

test("mysterious packages keep approved prices and ID change counts", () => {
  const policy = mysteriousPolicyFromConfig();
  assert.deepEqual(policy.packages[7], {
    days: 7,
    coinPrice: 990000,
    idChanges: 0,
  });
  assert.deepEqual(policy.packages[15], {
    days: 15,
    coinPrice: 1990000,
    idChanges: 1,
  });
  assert.deepEqual(policy.packages[30], {
    days: 30,
    coinPrice: 2990000,
    idChanges: 4,
  });
});

test("mysterious identity only enables while entitlement is active", () => {
  const now = Date.UTC(2026, 9, 8);
  const active = mysteriousStateFromUser(
    {
      mysteriousExpiresAt: new Date(now + 86400000),
      mysteriousEnabled: true,
      mysteriousId: "123456789",
      mysteriousIdChangesRemaining: 5,
    },
    now,
  );
  assert.equal(active.active, true);
  assert.equal(active.enabled, true);
  assert.equal(active.mysteriousId, "123456789");
  assert.equal(active.idChangesRemaining, 5);

  const expired = mysteriousStateFromUser(
    {
      mysteriousExpiresAt: new Date(now - 1),
      mysteriousEnabled: true,
    },
    now,
  );
  assert.equal(expired.active, false);
  assert.equal(expired.enabled, false);
});

test("generated mysterious IDs stay in the 9-digit namespace", () => {
  for (const raw of [0, 1, 4294967295, 1234567890]) {
    const id = mysteriousCandidateFromUint32(raw);
    assert.match(id, /^[1-9][0-9]{8}$/);
    assert.ok(Number(id) >= 100000000);
    assert.ok(Number(id) <= 999999999);
  }
});
