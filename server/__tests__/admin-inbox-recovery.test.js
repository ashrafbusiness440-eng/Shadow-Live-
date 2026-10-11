import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

import {
  recoverLongDiaryAlertsPage,
  longDiaryAlertRecoveryStatus,
} from "../../cloudflare-worker/src/admin-inbox-recovery.js";
import {
  adminInboxIndexPath,
  adminInboxLegacyIndexPath,
} from "../../cloudflare-worker/src/admin-inbox-index.js";

class RecoveryDb {
  constructor(seed = {}) {
    this.docs = new Map(
      Object.entries(seed).map(([path, data]) => [path, structuredClone(data)]),
    );
    this.queryCalls = 0;
    this.commitCalls = 0;
    this.rollbackCalls = 0;
    this.maxQuery = 0;
    this.maxWrites = 0;
  }
  async beginTransaction() { return "tx"; }
  async rollback() { this.rollbackCalls += 1; }
  async get(path) {
    return this.docs.has(path)
      ? { exists: true, data: structuredClone(this.docs.get(path)) }
      : { exists: false, data: null };
  }
  async runQuery(collection, options = {}) {
    assert.equal(collection, "diary_reports");
    assert.equal(options.transaction, "tx");
    assert.deepEqual(options.orderBy, [{ field: "__name__", direction: "asc" }]);
    this.queryCalls += 1;
    this.maxQuery = Math.max(this.maxQuery, options.limit);
    const cursor = (options.startAfter?.[0]?.referencePath || "").split("/").pop();
    return [...this.docs.entries()]
      .filter(([path]) => path.startsWith("diary_reports/"))
      .map(([path, data]) => ({ path, id: path.split("/")[1], data: structuredClone(data) }))
      .filter((row) => !cursor || row.id > cursor)
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(0, options.limit);
  }
  writeUpdate(path, fields) {
    return { kind: "update", path, fields: structuredClone(fields) };
  }
  writeDelete(path) { return { kind: "delete", path }; }
  async commit(_transaction, writes) {
    this.commitCalls += 1;
    this.maxWrites = Math.max(this.maxWrites, writes.length);
    for (const write of writes) {
      if (write.kind === "delete") this.docs.delete(write.path);
      else this.docs.set(write.path, {
        ...this.docs.get(write.path),
        ...structuredClone(write.fields),
      });
    }
  }
}

test("long diary repair safely restores only active reports in bounded cursor pages", async () => {
  const common = "diary_comment_" + "d".repeat(95) + "_" + "c".repeat(90) + "_";
  const ids = Array.from({ length: 17 }, (_, i) => common + "reporter_" + String(i).padStart(2, "0"));
  assert.ok(ids[0].slice(0, 160) === ids[1].slice(0, 160));
  const seed = {
    "admin_inbox_items/__meta": { schemaVersion: 2, ready: true },
  };
  ids.forEach((id, i) => {
    seed["diary_reports/" + id] = {
      targetType: "diary_comment",
      status: i === 2 ? "rejected" : i === 3 ? "actioned" : "new",
      diaryId: "diary_1",
      commentId: "comment_1",
      reporterUid: "reporter_" + i,
      targetAuthorUid: "author",
      targetOwnerUid: "owner",
      reasonLabel: "مضايقة",
      createdAtMs: 9000 + i,
    };
  });
  const oldPath = adminInboxLegacyIndexPath("diary_report", ids[0]);
  seed[oldPath] = { type: "diary_report", targetId: ids[1], key: "diary_report_" + ids[1] };
  const db = new RecoveryDb(seed);
  const beforeSources = ids.map((id) => structuredClone(db.docs.get("diary_reports/" + id)));

  const first = await recoverLongDiaryAlertsPage(db);
  assert.equal(first.ok, true);
  assert.equal(first.done, false);
  assert.equal(first.pageSize, 12);
  assert.equal(first.processed, 12);
  assert.equal(db.docs.get("admin_inbox_items/__meta").diaryLongRepairDone, false);

  const second = await recoverLongDiaryAlertsPage(db);
  assert.equal(second.done, true);
  assert.equal(second.processed, 17);
  assert.equal(second.reindexed, 15);
  assert.equal(db.docs.has(oldPath), false);
  ids.forEach((id, i) => {
    const active = i !== 2 && i !== 3;
    assert.equal(db.docs.has(adminInboxIndexPath("diary_report", id)), active);
    if (active) {
      assert.equal(db.docs.get(adminInboxIndexPath("diary_report", id)).meta.reporterUid, "reporter_" + i);
    }
    assert.deepEqual(db.docs.get("diary_reports/" + id), beforeSources[i]);
  });
  assert.ok(db.maxQuery <= 13);
  assert.ok(db.maxWrites <= 25);
  assert.equal(db.queryCalls, 2);

  const repeat = await recoverLongDiaryAlertsPage(db);
  assert.equal(repeat.done, true);
  assert.equal(repeat.pageSize, 0);
  assert.equal(db.queryCalls, 2);
  assert.equal(db.commitCalls, 2);
  assert.deepEqual(longDiaryAlertRecoveryStatus(db.docs.get("admin_inbox_items/__meta"), true), {
    available: true,
    done: true,
    processed: 17,
    reindexed: 15,
  });
});

test("repair refuses indexes not ready and never starts an unbounded scan", async () => {
  const db = new RecoveryDb({});
  const result = await recoverLongDiaryAlertsPage(db);
  assert.equal(result.code, "inbox_index_not_ready");
  assert.equal(db.queryCalls, 0);
  assert.equal(db.commitCalls, 0);
});

test("admin inbox recovery endpoint requires owner and exposes no open anonymous scan", () => {
  const source = fs.readFileSync("cloudflare-worker/src/admin-inbox.js", "utf8");
  assert.match(source, /if \(action === "repairDiaryReportInbox"\) \{\s*if \(!actor\.owner\)/);
  assert.match(source, /recoverLongDiaryAlertsPage\(db\)/);
});
