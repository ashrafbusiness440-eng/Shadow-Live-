import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ACCOUNT_ERASURE_PROBES,
  ACCOUNT_ERASURE_PROBE_LIMIT,
  inspectAccountErasureInventory,
  AccountErasureInventoryError,
} from "../../cloudflare-worker/src/account-deletion-erasure-inventory.js";

const uid = "testAccount_2026";
class LimitedDb {
  constructor() {
    this.calls = [];
    this.results = new Map();
    this.failFor = null;
  }
  async runQuery(collection, config) {
    this.calls.push({ collection, config });
    assert.equal(config.limit, 1);
    assert.equal(config.filters.length, 1);
    assert.equal(config.filters[0].value, uid);
    const key = collection + "/" + config.filters[0].field;
    if (this.failFor === key) throw Error("index_or_network_failed");
    return this.results.get(key) || [];
  }
}

test("bounded targeted queries discover linked content without authorizing erasure", async () => {
  const db = new LimitedDb();
  db.results.set("diaries/ownerUid", [{ id: "privateDiary" }]);
  db.results.set("storage_objects/ownerUid", [{ id: "privateObject" }]);
  db.results.set("conversations/participants", [{ id: "privateConversation" }]);
  const result = await inspectAccountErasureInventory(db, uid);
  assert.equal(result.ok, true);
  assert.equal(result.probesPerformed, ACCOUNT_ERASURE_PROBES.length);
  assert.equal(result.exhaustive, false);
  assert.equal(result.erasureAllowed, false);
  assert.equal(result.erasureExecuted, false);
  assert.deepEqual(result.domains, {
    diaries: "found",
    storage: "found",
    rooms: "not_seen",
    legacyRooms: "not_seen",
    conversations: "found",
  });
  assert.equal(JSON.stringify(result).includes("privateObject"), false);
  assert.equal(JSON.stringify(result).includes("privateDiary"), false);
  assert.equal(JSON.stringify(result).includes("privateConversation"), false);
  assert.ok(result.manualReviewRequired.includes("moneyAndPurchaseLedger"));
  assert.ok(result.manualReviewRequired.includes("moderationReportsEvidenceAndLegalHolds"));
  assert.ok(result.manualReviewRequired.includes("publicProfilesAndFirebaseAuth"));
  assert.ok(db.calls.length <= ACCOUNT_ERASURE_PROBE_LIMIT);
  assert.ok(db.calls.every(x => x.config.limit === 1));
  assert.deepEqual(db.calls.map(x => [
    x.collection, x.config.filters[0].field, x.config.filters[0].op,
  ]), [
    ["diaries", "ownerUid", "=="],
    ["storage_objects", "ownerUid", "=="],
    ["rooms", "ownerUid", "=="],
    ["rooms", "ownerId", "=="],
    ["conversations", "participants", "array-contains"],
  ]);
});

test("failed query is always not_verified rather than an ungrounded success", async () => {
  const db = new LimitedDb();
  db.failFor = "rooms/ownerUid";
  const result = await inspectAccountErasureInventory(db, uid);
  assert.equal(result.domains.rooms, "not_verified");
  assert.equal(result.exhaustive, false);
  assert.equal(result.erasureAllowed, false);
  assert.equal(db.calls.length, ACCOUNT_ERASURE_PROBE_LIMIT);
});

test("quota errors are propagated, and no global scans are used", async () => {
  const db = new LimitedDb();
  db.failFor = "rooms/ownerUid";
  db.runQuery = async (collection, config) => {
    if (collection === "rooms" && config.filters[0].field === "ownerUid") {
      throw Object.assign(Error("RESOURCE_EXHAUSTED"), {
        code: "RESOURCE_EXHAUSTED",
      });
    }
    return [];
  };
  await assert.rejects(() => inspectAccountErasureInventory(db, uid),
    /RESOURCE_EXHAUSTED/);
});

test("invalid identity blocks all reads", async () => {
  const db = new LimitedDb();
  await assert.rejects(() => inspectAccountErasureInventory(db, "../uid"),
    AccountErasureInventoryError);
  await assert.rejects(() => inspectAccountErasureInventory(db, ""),
    AccountErasureInventoryError);
  assert.equal(db.calls.length, 0);
});

test("source: owner-only route checks current request ID and UI is read-only", () => {
  const server = readFileSync("cloudflare-worker/src/admin-inbox.js","utf8");
  const client = readFileSync("lib/admin/account_deletion_owner_review_page.dart","utf8");
  const source = readFileSync("cloudflare-worker/src/account-deletion-erasure-inventory.js","utf8");
  assert.match(server, /"accountDeletionInventory"/);
  assert.match(server, /if \(!actor.owner\) throw new AdminInboxError\("forbidden", 403\)/);
  assert.match(server, /body.requestId\) !== details.requestId/);
  assert.match(server, /inspectAccountDeletionForOwner\(db, targetUid\)/);
  assert.match(client, /'accountDeletionInventory'/);
  assert.match(client, /result\['erasureAllowed'\] != false/);
  assert.match(client, /result\['erasureExecuted'\] != false/);
  assert.doesNotMatch(source, /db\.list\(|writeDelete\(|writeUpdate\(|deleteAuthUser\(|setInterval\(/);
  assert.doesNotMatch(client, /accountDeletionErase|deleteAuthUser/);
});
