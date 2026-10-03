import assert from "node:assert/strict";
import test from "node:test";

import {
  applyUserLevelVisibilityForViewer,
  canViewHiddenUserLevelMetric,
  effectiveVipLevel,
  levelVisibilityPreferences,
  publicLevelMetadata,
} from "../../cloudflare-worker/src/user-level-visibility.js";
import {
  userLevelSummaryInternals,
} from "../../cloudflare-worker/src/user-level-summary.js";

const { updateLevelVisibility } = userLevelSummaryInternals;

function section(level, points) {
  return {
    level,
    maxLevel: 35,
    points,
    minimumThreshold: 100,
    nextThreshold: 200,
    remaining: 50,
    progressBps: 5000,
  };
}

function summary(visibility = {}) {
  return {
    uid: "target",
    policyVersion: 1,
    visibility: {
      hiddenLevelEntitled: true,
      hideWealthLevel: false,
      hideAttractionLevel: false,
      hideGameLevel: false,
      ...visibility,
    },
    wealth: section(12, 123456),
    attraction: section(9, 654321),
    games: {
      ...section(5, 777777),
      maxLevel: 21,
      storedPoints: 777777,
      pendingDecayPoints: 1234,
      pendingDecayDays: 2,
      lastGameActivityAtMs: 123456789,
    },
  };
}

test("07-A old vipLevel never unlocks Hidden Level", () => {
  const oldVipOnly = {
    vipLevel: 10,
    vip: { level: 10 },
    hideWealthLevel: true,
    hideAttractionLevel: true,
    hideGameLevel: true,
  };
  assert.equal(effectiveVipLevel(oldVipOnly), 0);
  assert.deepEqual(levelVisibilityPreferences(oldVipOnly), {
    hiddenLevelEntitled: false,
    hideWealthLevel: false,
    hideAttractionLevel: false,
    hideGameLevel: false,
    hasAnyHiddenLevel: false,
  });
});

test("07-A effectiveVipLevel 3+ enables independent visibility flags only", () => {
  const prefs = levelVisibilityPreferences({
    effectiveVipLevel: 3,
    hideWealthLevel: true,
    hideAttractionLevel: false,
    hideGameLevel: true,
  });
  assert.equal(prefs.hiddenLevelEntitled, true);
  assert.equal(prefs.hideWealthLevel, true);
  assert.equal(prefs.hideAttractionLevel, false);
  assert.equal(prefs.hideGameLevel, true);

  assert.deepEqual(
    publicLevelMetadata(
      { wealthLevel: 20, attractionLevel: 15, gameLevel: 7 },
      {
        effectiveVipLevel: 3,
        hideWealthLevel: true,
        hideAttractionLevel: false,
        hideGameLevel: true,
      },
    ),
    { wealthLevel: 0, attractionLevel: 15, gameLevel: 0 },
  );
});

test("07-A losing VIP3 eligibility makes stale hide flags ineffective", () => {
  const user = {
    effectiveVipLevel: 2,
    hideWealthLevel: true,
    hideAttractionLevel: true,
    hideGameLevel: true,
  };
  assert.deepEqual(
    publicLevelMetadata(
      { wealthLevel: 10, attractionLevel: 11, gameLevel: 12 },
      user,
    ),
    { wealthLevel: 10, attractionLevel: 11, gameLevel: 12 },
  );
});

test("07-A public API redacts hidden metrics including game activity details", () => {
  const visible = applyUserLevelVisibilityForViewer(
    summary({
      hideWealthLevel: true,
      hideGameLevel: true,
    }),
    { actorUid: "viewer", targetUid: "target", actorUser: {} },
  );

  assert.equal(visible.wealth.hidden, true);
  assert.equal(visible.wealth.level, 0);
  assert.equal(visible.wealth.points, 0);
  assert.equal(visible.attraction.hidden, false);
  assert.equal(visible.attraction.level, 9);
  assert.equal(visible.games.hidden, true);
  assert.equal(visible.games.level, 0);
  assert.equal(visible.games.storedPoints, 0);
  assert.equal(visible.games.pendingDecayPoints, 0);
  assert.equal(visible.games.lastGameActivityAtMs, null);
  assert.equal(visible.visibility.canEdit, false);
});

test("07-A self always sees real values and can edit when VIP3+ entitled", () => {
  const own = applyUserLevelVisibilityForViewer(
    summary({ hideWealthLevel: true, hideGameLevel: true }),
    { actorUid: "target", targetUid: "target" },
  );
  assert.equal(own.wealth.level, 12);
  assert.equal(own.games.level, 5);
  assert.equal(own.wealth.publiclyHidden, true);
  assert.equal(own.visibility.canEdit, true);
});

test("07-A Owner, Safety read-only cap, and partial level cap get bounded overrides", () => {
  const hidden = summary({
    hideWealthLevel: true,
    hideAttractionLevel: true,
    hideGameLevel: true,
  });

  const ownerView = applyUserLevelVisibilityForViewer(hidden, {
    actorUid: "owner",
    targetUid: "target",
    actorUser: { role: "owner", adminEnabled: true },
  });
  assert.equal(ownerView.wealth.level, 12);
  assert.equal(ownerView.attraction.level, 9);
  assert.equal(ownerView.games.level, 5);

  const safetyView = applyUserLevelVisibilityForViewer(hidden, {
    actorUid: "safety",
    targetUid: "target",
    actorUser: {
      role: "moderator",
      adminEnabled: true,
      capabilities: ["viewHiddenUserLevels"],
    },
  });
  assert.equal(safetyView.wealth.level, 12);
  assert.equal(safetyView.attraction.level, 9);
  assert.equal(safetyView.games.level, 5);

  const partialView = applyUserLevelVisibilityForViewer(hidden, {
    actorUid: "admin",
    targetUid: "target",
    actorUser: {
      role: "admin",
      adminEnabled: true,
      capabilities: ["manageAttractionLevel"],
    },
  });
  assert.equal(partialView.wealth.level, 0);
  assert.equal(partialView.attraction.level, 9);
  assert.equal(partialView.games.level, 0);

  assert.equal(
    canViewHiddenUserLevelMetric(
      {
        role: "moderator",
        adminEnabled: true,
        capabilities: ["manageUserLevels"],
      },
      "wealth",
    ),
    false,
  );
});

class FakeDb {
  constructor(user) {
    this.user = structuredClone(user);
    this.commits = [];
    this.rollbacks = 0;
  }
  async beginTransaction() {
    return { active: true };
  }
  async get(path) {
    assert.equal(path, "users/self");
    return { exists: true, data: structuredClone(this.user) };
  }
  writeUpdate(path, fields, fieldPaths) {
    return { path, fields, fieldPaths };
  }
  async commit(_transaction, writes) {
    this.commits.push(structuredClone(writes));
    Object.assign(this.user, structuredClone(writes[0].fields));
  }
  async rollback() {
    this.rollbacks += 1;
  }
}

const payload = {
  sub: "self",
  iat: Math.floor(Date.now() / 1000),
};

test("07-A updateVisibility rejects old VIP even if vipLevel is high", async () => {
  const db = new FakeDb({
    accountStatus: "active",
    vipLevel: 10,
    wealthPoints: 123,
  });
  await assert.rejects(
    updateLevelVisibility(db, payload, {
      visibility: {
        hideWealthLevel: true,
        hideAttractionLevel: false,
        hideGameLevel: false,
      },
    }),
    /vip_required/,
  );
  assert.equal(db.commits.length, 0);
  assert.equal(db.user.wealthPoints, 123);
});

test("07-A updateVisibility writes only privacy fields for effective VIP3+", async () => {
  const db = new FakeDb({
    accountStatus: "active",
    effectiveVipLevel: 3,
    wealthPoints: 123,
    attractionPoints: 456,
    gamePoints: 789,
  });
  const result = await updateLevelVisibility(db, payload, {
    visibility: {
      hideWealthLevel: true,
      hideAttractionLevel: false,
      hideGameLevel: true,
    },
  });
  assert.equal(result.hideWealthLevel, true);
  assert.equal(result.hideAttractionLevel, false);
  assert.equal(result.hideGameLevel, true);
  assert.equal(db.commits.length, 1);
  assert.deepEqual(db.commits[0][0].fieldPaths, [
    "hideWealthLevel",
    "hideAttractionLevel",
    "hideGameLevel",
    "levelVisibilityUpdatedAt",
  ]);
  assert.equal(db.user.wealthPoints, 123);
  assert.equal(db.user.attractionPoints, 456);
  assert.equal(db.user.gamePoints, 789);
});
