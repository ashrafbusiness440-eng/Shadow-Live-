import assert from "node:assert/strict";
import test from "node:test";

import {
  manageUserAccessInternals,
} from "../../cloudflare-worker/src/manage-user-access.js";

const { execute } = manageUserAccessInternals;

const nowSec = () => Math.floor(Date.now() / 1000);
const payload = (sub) => ({ sub, iat: nowSec(), auth_time: nowSec() });

function clone(value) {
  return value == null ? value : structuredClone(value);
}

class FakeDb {
  constructor(seed = {}) {
    this.docs = new Map(
      Object.entries(seed).map(([path, data]) => [path, clone(data)]),
    );
    this.commits = [];
  }

  async beginTransaction() {
    return { active: true };
  }

  async rollback(transaction) {
    if (transaction) transaction.active = false;
  }

  async get(path) {
    if (!this.docs.has(path)) return { exists: false, data: null };
    return { exists: true, data: clone(this.docs.get(path)) };
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

function owner() {
  return {
    role: "owner",
    adminEnabled: true,
    accountStatus: "active",
    capabilities: [],
  };
}

function admin(capabilities = []) {
  return {
    role: "admin",
    adminEnabled: true,
    accountStatus: "active",
    capabilities,
  };
}

test("06-C Owner can grant and revoke delegated level capability with Audit delta", async () => {
  const actorUid = "level_owner_access";
  const targetUid = "level_admin_access";
  const db = new FakeDb({
    ["users/" + actorUid]: owner(),
    ["users/" + targetUid]: admin(),
  });

  const grant = await execute(db, payload(actorUid), {
    targetUid,
    role: "admin",
    adminEnabled: true,
    capabilities: ["manageWealthLevel"],
    reason: "grant wealth level permission",
    idempotencyKey: "level_access_grant_0001",
  });
  assert.equal(grant.code, "ok");
  assert.deepEqual(grant.capabilities, ["manageWealthLevel"]);

  const grantAudit = db.docs.get(
    "admin_audit_logs/admin_level_access_grant_0001",
  );
  assert.deepEqual(grantAudit.capabilityChanges, [
    {
      capability: "manageWealthLevel",
      oldState: false,
      newState: true,
    },
  ]);

  const revoke = await execute(db, payload(actorUid), {
    targetUid,
    role: "admin",
    adminEnabled: true,
    capabilities: [],
    reason: "revoke wealth level permission",
    idempotencyKey: "level_access_revoke_0001",
  });
  assert.equal(revoke.code, "ok");
  assert.deepEqual(revoke.capabilities, []);

  const revokeAudit = db.docs.get(
    "admin_audit_logs/admin_level_access_revoke_0001",
  );
  assert.deepEqual(revokeAudit.capabilityChanges, [
    {
      capability: "manageWealthLevel",
      oldState: true,
      newState: false,
    },
  ]);
});

test("06-C full level permission remains explicit and is never implied by admin role", async () => {
  const actorUid = "level_owner_full";
  const targetUid = "level_admin_full";
  const db = new FakeDb({
    ["users/" + actorUid]: owner(),
    ["users/" + targetUid]: admin(),
  });

  assert.deepEqual(db.docs.get("users/" + targetUid).capabilities, []);

  const result = await execute(db, payload(actorUid), {
    targetUid,
    role: "super_admin",
    adminEnabled: true,
    capabilities: ["manageUserLevels"],
    reason: "grant explicit full level permission",
    idempotencyKey: "level_access_full_0001",
  });

  assert.equal(result.role, "super_admin");
  assert.deepEqual(result.capabilities, ["manageUserLevels"]);
});

test("06-C delegated level capabilities are rejected for user and moderator roles", async () => {
  const actorUid = "level_owner_role_guard";
  for (const role of ["user", "moderator"]) {
    const targetUid = "level_target_" + role;
    const db = new FakeDb({
      ["users/" + actorUid]: owner(),
      ["users/" + targetUid]: {
        role,
        adminEnabled: role === "moderator",
        accountStatus: "active",
        capabilities: [],
      },
    });

    await assert.rejects(
      execute(db, payload(actorUid), {
        targetUid,
        role,
        adminEnabled: role === "moderator",
        capabilities: ["manageGameLevel"],
        reason: "must be rejected",
        idempotencyKey: "level_role_guard_" + role + "_0001",
      }),
      (error) =>
        error?.code === "invalid_level_capability_role" &&
        error?.status === 400,
    );
    assert.equal(db.commits.length, 0);
  }
});

test("06-C delegated level permission operation is idempotent", async () => {
  const actorUid = "level_owner_idempotent";
  const targetUid = "level_admin_idempotent";
  const db = new FakeDb({
    ["users/" + actorUid]: owner(),
    ["users/" + targetUid]: admin(),
  });
  const body = {
    targetUid,
    role: "admin",
    adminEnabled: true,
    capabilities: ["manageGameLevel"],
    reason: "idempotency test",
    idempotencyKey: "level_access_idem_0001",
  };

  const first = await execute(db, payload(actorUid), body);
  const duplicate = await execute(db, payload(actorUid), body);
  assert.equal(first.code, "ok");
  assert.equal(duplicate.code, "duplicate");
  assert.equal(db.commits.length, 1);
});


test("07-A Owner can grant read-only hidden-level visibility to Safety moderator", async () => {
  const actorUid = "hidden_level_owner";
  const targetUid = "hidden_level_safety";
  const db = new FakeDb({
    ["users/" + actorUid]: owner(),
    ["users/" + targetUid]: {
      role: "moderator",
      adminEnabled: true,
      accountStatus: "active",
      capabilities: [],
    },
  });

  const result = await execute(db, payload(actorUid), {
    targetUid,
    role: "moderator",
    adminEnabled: true,
    capabilities: ["viewHiddenUserLevels"],
    reason: "grant Safety read-only hidden level visibility",
    idempotencyKey: "hidden_level_safety_0001",
  });

  assert.equal(result.code, "ok");
  assert.deepEqual(result.capabilities, ["viewHiddenUserLevels"]);
  const audit = db.docs.get(
    "admin_audit_logs/admin_hidden_level_safety_0001",
  );
  assert.deepEqual(audit.capabilityChanges, [
    {
      capability: "viewHiddenUserLevels",
      oldState: false,
      newState: true,
    },
  ]);
});
