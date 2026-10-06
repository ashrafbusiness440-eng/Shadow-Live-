import assert from "node:assert/strict";
import test from "node:test";

import {
  vipLevelControlInternals,
} from "../../cloudflare-worker/src/manage-vip-level.js";
import {
  manageUserAccessInternals,
} from "../../cloudflare-worker/src/manage-user-access.js";

const {
  normalizeAllowedVipGrantLevels,
  vipControlAccess,
  updateAdminVipGrant,
} = vipLevelControlInternals;

const nowMs = Date.UTC(2026, 9, 6, 9, 0, 0);
const payload = (sub) => ({
  sub,
  auth_time: Math.floor(nowMs / 1000),
  iat: Math.floor(nowMs / 1000),
});

function clone(value) {
  return value == null ? value : structuredClone(value);
}

class FakeDb {
  constructor(seed = {}) {
    this.docs = new Map(
      Object.entries(seed).map(([path, data]) => [path, clone(data)]),
    );
    this.commits = [];
    this.rollbacks = 0;
  }

  async beginTransaction() {
    return { active: true };
  }

  async rollback(transaction) {
    this.rollbacks += 1;
    if (transaction) transaction.active = false;
  }

  async get(path) {
    if (!this.docs.has(path)) return { exists: false, data: null };
    return { exists: true, data: clone(this.docs.get(path)) };
  }

  async runQuery() {
    return [];
  }

  writeUpdate(path, fields, fieldPaths = []) {
    return {
      kind: "update",
      path,
      fields: clone(fields),
      fieldPaths: [...fieldPaths],
    };
  }

  writeCreate(path, fields) {
    return { kind: "create", path, fields: clone(fields) };
  }

  async commit(transaction, writes = []) {
    this.commits.push(clone(writes));
    for (const write of writes) {
      if (write.kind === "create") {
        if (this.docs.has(write.path)) {
          const error = new Error("ALREADY_EXISTS");
          error.status = 409;
          throw error;
        }
        this.docs.set(write.path, clone(write.fields));
      } else if (write.kind === "update") {
        const current = this.docs.get(write.path) || {};
        this.docs.set(write.path, {
          ...clone(current),
          ...clone(write.fields),
        });
      }
    }
    if (transaction) transaction.active = false;
  }
}

function user({
  role = "user",
  adminEnabled = false,
  capabilities = [],
  allowedVipGrantLevels = [],
  earnedVipLevel = 0,
  effectiveVipLevel = earnedVipLevel,
  earnedVipExpiresAt = null,
  adminGrantVipLevel = 0,
  adminGrantExpiresAt = null,
  trialVipLevel = 0,
  trialVipExpiresAt = null,
  vipGrowthPoints = 0,
  vipMaintenancePoints = 0,
  ...rest
} = {}) {
  return {
    role,
    adminEnabled,
    capabilities,
    allowedVipGrantLevels,
    accountStatus: "active",
    earnedVipLevel,
    effectiveVipLevel,
    earnedVipExpiresAt,
    adminGrantVipLevel,
    adminGrantExpiresAt,
    trialVipLevel,
    trialVipExpiresAt,
    vipGrowthPoints,
    vipMaintenancePoints,
    ...rest,
  };
}

function grantBody(targetUid, {
  mode = "grant",
  vipLevel = 7,
  durationMinutes = 7 * 24 * 60,
  key = "vip_control_0001",
  reason = "VIP admin grant test",
} = {}) {
  return {
    targetUid,
    mode,
    vipLevel,
    durationMinutes,
    reason,
    idempotencyKey: key,
  };
}

test("07-A capability is explicit; role and legacy manageVip never authorize", () => {
  assert.equal(vipControlAccess(user({ role: "super_admin", adminEnabled: true })).canManageVipLevels, false);
  assert.equal(
    vipControlAccess(user({
      role: "super_admin",
      adminEnabled: true,
      capabilities: ["manageVip"],
      allowedVipGrantLevels: [1, 7],
    })).canManageVipLevels,
    false,
  );
  const empty = vipControlAccess(user({
    role: "admin",
    adminEnabled: true,
    capabilities: ["manageVipLevels"],
    allowedVipGrantLevels: [],
  }));
  assert.equal(empty.canManageVipLevels, true);
  assert.deepEqual(empty.allowedVipGrantLevels, []);
});

test("07-A Owner always gets VIP1-10 grant authority without adminEnabled", () => {
  const access = vipControlAccess(user({ role: "owner", adminEnabled: false }));
  assert.equal(access.canManageVipLevels, true);
  assert.equal(access.isOwner, true);
  assert.deepEqual(access.allowedVipGrantLevels, [1,2,3,4,5,6,7,8,9,10]);
});

test("07-A allowed VIP grant levels are normalized and bounded", () => {
  assert.deepEqual(normalizeAllowedVipGrantLevels([7, 1, 7, 2]), [1, 2, 7]);
  assert.deepEqual(normalizeAllowedVipGrantLevels([0, 1]), []);
  assert.deepEqual(normalizeAllowedVipGrantLevels([11]), []);
  assert.deepEqual(normalizeAllowedVipGrantLevels("1,2"), []);
});

test("07-A Owner can grant VIP10 to own account and natural VIP keeps running", async () => {
  const uid = "owner_self";
  const earnedExpiry = new Date(nowMs + 25 * 24 * 60 * 60 * 1000);
  const db = new FakeDb({
    ["users/" + uid]: user({
      role: "owner",
      adminEnabled: false,
      earnedVipLevel: 2,
      effectiveVipLevel: 2,
      earnedVipExpiresAt: earnedExpiry,
      vipGrowthPoints: 1_500_000,
      vipMaintenancePoints: 123,
    }),
  });

  const result = await updateAdminVipGrant(
    db,
    payload(uid),
    grantBody(uid, {
      vipLevel: 10,
      durationMinutes: 7 * 24 * 60,
      key: "vip_owner_self_0001",
    }),
    nowMs,
  );

  assert.equal(result.newAdminGrantVipLevel, 10);
  assert.equal(result.newVipLevel, 10);
  const stored = db.docs.get("users/" + uid);
  assert.equal(stored.earnedVipLevel, 2);
  assert.equal(stored.vipGrowthPoints, 1_500_000);
  assert.equal(stored.vipMaintenancePoints, 123);
  assert.equal(new Date(stored.earnedVipExpiresAt).getTime(), earnedExpiry.getTime());
  assert.equal(stored.adminGrantVipLevel, 10);
  assert.equal(stored.vipSource, "admin_grant");
});

test("07-A Admin [1,7] can grant 7 but server rejects VIP8", async () => {
  const actorUid = "admin_17";
  const targetUid = "target_17";
  const seed = {
    ["users/" + actorUid]: user({
      role: "admin",
      adminEnabled: true,
      capabilities: ["manageVipLevels"],
      allowedVipGrantLevels: [1, 7],
    }),
    ["users/" + targetUid]: user(),
  };

  const okDb = new FakeDb(seed);
  const ok = await updateAdminVipGrant(
    okDb,
    payload(actorUid),
    grantBody(targetUid, { vipLevel: 7, key: "vip_admin_17_ok01" }),
    nowMs,
  );
  assert.equal(ok.newAdminGrantVipLevel, 7);

  const deniedDb = new FakeDb(seed);
  await assert.rejects(
    updateAdminVipGrant(
      deniedDb,
      payload(actorUid),
      grantBody(targetUid, { vipLevel: 8, key: "vip_admin_17_no08" }),
      nowMs,
    ),
    (error) => error?.message === "vip_level_not_allowed",
  );
  assert.equal(deniedDb.commits.length, 0);
});

test("07-A manageVipLevels with an empty allowed list grants nothing", async () => {
  const actorUid = "admin_empty";
  const targetUid = "target_empty";
  const db = new FakeDb({
    ["users/" + actorUid]: user({
      role: "super_admin",
      adminEnabled: true,
      capabilities: ["manageVipLevels"],
      allowedVipGrantLevels: [],
    }),
    ["users/" + targetUid]: user(),
  });

  await assert.rejects(
    updateAdminVipGrant(
      db,
      payload(actorUid),
      grantBody(targetUid, { vipLevel: 1, key: "vip_empty_levels01" }),
      nowMs,
    ),
    (error) => error?.message === "vip_level_not_allowed",
  );
});

test("07-A non-owner cannot manage the Owner VIP", async () => {
  const actorUid = "admin_owner_target";
  const ownerUid = "owner_target";
  const db = new FakeDb({
    ["users/" + actorUid]: user({
      role: "admin",
      adminEnabled: true,
      capabilities: ["manageVipLevels"],
      allowedVipGrantLevels: [10],
    }),
    ["users/" + ownerUid]: user({ role: "owner" }),
  });

  await assert.rejects(
    updateAdminVipGrant(
      db,
      payload(actorUid),
      grantBody(ownerUid, { vipLevel: 10, key: "vip_owner_protect1" }),
      nowMs,
    ),
    (error) => error?.message === "owner_protected",
  );
});

test("07-A change/remove cannot touch a grant outside admin allowed levels", async () => {
  const actorUid = "admin_remove";
  const targetUid = "target_remove";
  const existingExpiry = new Date(nowMs + 10 * 24 * 60 * 60 * 1000);
  const seed = {
    ["users/" + actorUid]: user({
      role: "admin",
      adminEnabled: true,
      capabilities: ["manageVipLevels"],
      allowedVipGrantLevels: [1, 7],
    }),
    ["users/" + targetUid]: user({
      adminGrantVipLevel: 10,
      adminGrantExpiresAt: existingExpiry,
      effectiveVipLevel: 10,
    }),
  };

  await assert.rejects(
    updateAdminVipGrant(
      new FakeDb(seed),
      payload(actorUid),
      grantBody(targetUid, { mode: "remove", key: "vip_remove_denied1" }),
      nowMs,
    ),
    (error) => error?.message === "vip_level_not_allowed",
  );
  await assert.rejects(
    updateAdminVipGrant(
      new FakeDb(seed),
      payload(actorUid),
      grantBody(targetUid, {
        mode: "change",
        vipLevel: 7,
        key: "vip_change_denied1",
      }),
      nowMs,
    ),
    (error) => error?.message === "vip_level_not_allowed",
  );
});

test("07-A removing admin grant returns to earned VIP without deleting Growth", async () => {
  const ownerUid = "owner_remove";
  const targetUid = "target_remove_ok";
  const earnedExpiry = new Date(nowMs + 18 * 24 * 60 * 60 * 1000);
  const db = new FakeDb({
    ["users/" + ownerUid]: user({ role: "owner" }),
    ["users/" + targetUid]: user({
      earnedVipLevel: 2,
      earnedVipExpiresAt: earnedExpiry,
      adminGrantVipLevel: 7,
      adminGrantExpiresAt: new Date(nowMs + 7 * 24 * 60 * 60 * 1000),
      effectiveVipLevel: 7,
      vipGrowthPoints: 2_000_000,
      vipMaintenancePoints: 222,
    }),
  });

  const result = await updateAdminVipGrant(
    db,
    payload(ownerUid),
    grantBody(targetUid, {
      mode: "remove",
      key: "vip_remove_owner01",
    }),
    nowMs,
  );

  assert.equal(result.newAdminGrantVipLevel, 0);
  assert.equal(result.newVipLevel, 2);
  assert.equal(result.effectiveVipSource, "progression");
  const stored = db.docs.get("users/" + targetUid);
  assert.equal(stored.vipGrowthPoints, 2_000_000);
  assert.equal(stored.vipMaintenancePoints, 222);
  assert.equal(new Date(stored.earnedVipExpiresAt).getTime(), earnedExpiry.getTime());

  const audit = db.docs.get("vip_audit_logs/control_vip_remove_owner01");
  assert.equal(audit.actorId, ownerUid);
  assert.equal(audit.targetUserId, targetUid);
  assert.equal(audit.oldVipLevel, 7);
  assert.equal(audit.newVipLevel, 2);
  assert.equal(audit.action, "removeAdminVipGrant");
  assert.ok(audit.timestamp instanceof Date);
});

test("07-A Owner access edit persists allowedVipGrantLevels and audits old/new", async () => {
  const ownerUid = "owner_access";
  const adminUid = "admin_access";
  const db = new FakeDb({
    ["users/" + ownerUid]: user({ role: "owner", adminEnabled: false }),
    ["users/" + adminUid]: user({
      role: "admin",
      adminEnabled: true,
      capabilities: ["manageVipLevels"],
      allowedVipGrantLevels: [1, 2],
    }),
  });

  const result = await manageUserAccessInternals.execute(
    db,
    payload(ownerUid),
    {
      targetUid: adminUid,
      role: "super_admin",
      adminEnabled: true,
      capabilities: ["manageVipLevels"],
      allowedVipGrantLevels: [1, 7],
      reason: "change VIP grant scope",
      idempotencyKey: "access_vip_levels01",
    },
  );

  assert.deepEqual(result.allowedVipGrantLevels, [1, 7]);
  const stored = db.docs.get("users/" + adminUid);
  assert.deepEqual(stored.allowedVipGrantLevels, [1, 7]);
  const audit = db.docs.get("admin_audit_logs/admin_access_vip_levels01");
  assert.equal(audit.actorId, ownerUid);
  assert.equal(audit.targetAdminId, adminUid);
  assert.deepEqual(audit.oldAllowedLevels, [1, 2]);
  assert.deepEqual(audit.newAllowedLevels, [1, 7]);
  assert.ok(audit.timestamp instanceof Date);
});

test("07-A removing manageVipLevels clears allowed levels server-side", async () => {
  const ownerUid = "owner_clear";
  const adminUid = "admin_clear";
  const db = new FakeDb({
    ["users/" + ownerUid]: user({ role: "owner" }),
    ["users/" + adminUid]: user({
      role: "admin",
      adminEnabled: true,
      capabilities: ["manageVipLevels"],
      allowedVipGrantLevels: [1, 7, 10],
    }),
  });

  const result = await manageUserAccessInternals.execute(
    db,
    payload(ownerUid),
    {
      targetUid: adminUid,
      role: "admin",
      adminEnabled: true,
      capabilities: [],
      allowedVipGrantLevels: [1, 7, 10],
      reason: "remove VIP capability",
      idempotencyKey: "access_vip_clear001",
    },
  );
  assert.deepEqual(result.allowedVipGrantLevels, []);
  assert.deepEqual(db.docs.get("users/" + adminUid).allowedVipGrantLevels, []);
});
