import assert from "node:assert/strict";
import test from "node:test";

import { diaryModerationTestHooks } from "../../cloudflare-worker/src/diary-moderation.js";

const {
  listReports,
  reviewReport,
  normalizeReport,
  parseCursor,
} = diaryModerationTestHooks;

class FakeDb {
  constructor(seed = {}) {
    this.docs = new Map(
      Object.entries(seed).map(([path, data]) => [path, structuredClone(data)]),
    );
  }

  async beginTransaction() { return "tx"; }
  async rollback() {}

  async get(path) {
    if (!this.docs.has(path)) return { exists: false, data: null };
    return { exists: true, data: structuredClone(this.docs.get(path)) };
  }

  writeCreate(path, fields) {
    return { kind: "create", path, fields: structuredClone(fields) };
  }

  writeUpdate(path, fields, fieldPaths = null) {
    return {
      kind: "update",
      path,
      fields: structuredClone(fields),
      fieldPaths: Array.isArray(fieldPaths) ? [...fieldPaths] : null,
    };
  }

  writeDelete(path) {
    return { kind: "delete", path };
  }

  async commit(_transaction, writes) {
    for (const write of writes) {
      if (write.kind === "create") {
        if (this.docs.has(write.path)) {
          const error = new Error("ALREADY_EXISTS");
          error.status = 409;
          throw error;
        }
        this.docs.set(write.path, structuredClone(write.fields));
      } else if (write.kind === "update") {
        if (!this.docs.has(write.path)) {
          const error = new Error("NOT_FOUND");
          error.status = 404;
          throw error;
        }
        const current = this.docs.get(write.path) || {};
        this.docs.set(write.path, {
          ...structuredClone(current),
          ...structuredClone(write.fields),
        });
      } else if (write.kind === "delete") {
        this.docs.delete(write.path);
      }
    }
  }

  async runQuery(collectionPath, options = {}) {
    assert.equal(collectionPath, "diary_reports");
    let rows = [...this.docs.entries()]
      .filter(([path]) => /^diary_reports\/[^/]+$/.test(path))
      .map(([path, data]) => ({
        id: path.split("/")[1],
        path,
        data: structuredClone(data),
      }));
    rows.sort((a, b) => {
      const ms = Number(b.data.createdAtMs || 0) - Number(a.data.createdAtMs || 0);
      if (ms !== 0) return ms;
      return b.id.localeCompare(a.id);
    });
    const cursorMs = options.startAfter?.[0]?.value;
    const cursorRef = options.startAfter?.[1]?.referencePath || "";
    if (cursorMs) {
      const cursorId = String(cursorRef).split("/").pop() || "";
      rows = rows.filter((row) => {
        const ms = Number(row.data.createdAtMs || 0);
        if (ms < Number(cursorMs)) return true;
        if (ms > Number(cursorMs)) return false;
        return row.id < cursorId;
      });
    }
    return rows.slice(0, Number(options.limit || 100));
  }
}

function report(id, createdAtMs, status = "new") {
  return {
    reportId: id,
    targetType: "diary",
    targetId: "diary_1",
    diaryId: "diary_1",
    reporterUid: "reporter",
    targetOwnerUid: "owner",
    targetAuthorUid: "owner",
    reason: "spam",
    reasonLabel: "سبام",
    status,
    evidence: { text: "evidence" },
    createdAtMs,
    createdAt: new Date(createdAtMs),
    updatedAt: new Date(createdAtMs),
  };
}

test("diary moderation report listing is bounded and cursor based", async () => {
  const db = new FakeDb({
    "diary_reports/report_3": report("report_3", 3000),
    "diary_reports/report_2": report("report_2", 2000),
    "diary_reports/report_1": report("report_1", 1000),
  });

  const first = await listReports(db, { limit: 2 });
  assert.equal(first.items.length, 2);
  assert.equal(first.items[0].reportId, "report_3");
  assert.equal(first.items[1].reportId, "report_2");
  assert.equal(first.hasMore, true);
  assert.equal(first.nextCursor, "2000|report_2");

  const second = await listReports(db, {
    limit: 2,
    cursor: first.nextCursor,
  });
  assert.equal(second.items.length, 1);
  assert.equal(second.items[0].reportId, "report_1");
  assert.equal(second.hasMore, false);
});

test("report review transition updates mirror and global record with audit", async () => {
  const db = new FakeDb({
    "diary_reports/report_review": report("report_review", 4000),
    "reports/report_review": report("report_review", 4000),
  });

  const result = await reviewReport(db, "admin_uid", {
    reportId: "report_review",
    status: "under_review",
    reason: "manual review",
    idempotencyKey: "review_report_0000000001",
  });

  assert.equal(result.status, "under_review");
  assert.equal(
    db.docs.get("diary_reports/report_review").status,
    "under_review",
  );
  assert.equal(
    db.docs.get("reports/report_review").status,
    "under_review",
  );
  assert.equal(
    [...db.docs.keys()].some((path) =>
      path.startsWith("admin_audit_logs/diary_report_")
    ),
    true,
  );
  assert.equal(
    db.docs.get("control_operations/review_report_0000000001").status,
    "completed",
  );
});

test("invalid report transition is rejected", async () => {
  const db = new FakeDb({
    "diary_reports/report_done": report("report_done", 5000, "actioned"),
    "reports/report_done": report("report_done", 5000, "actioned"),
  });

  await assert.rejects(
    () => reviewReport(db, "admin_uid", {
      reportId: "report_done",
      status: "under_review",
      reason: "reopen",
      idempotencyKey: "review_report_0000000002",
    }),
    /invalid_report_transition/,
  );
});

test("report normalization and cursor parsing stay strict", () => {
  const item = normalizeReport("report_a", report("report_a", 6000));
  assert.equal(item.reportId, "report_a");
  assert.equal(item.targetType, "diary");
  assert.equal(item.evidence.text, "evidence");
  assert.deepEqual(parseCursor("6000|report_a"), {
    createdAtMs: 6000,
    reportId: "report_a",
  });
  assert.throws(() => parseCursor("bad"), /invalid_cursor/);
});
