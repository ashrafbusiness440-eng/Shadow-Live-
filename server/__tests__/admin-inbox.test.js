import assert from "node:assert/strict";
import test from "node:test";

import { adminInboxTestHooks } from "../../cloudflare-worker/src/admin-inbox.js";

const { safeKey, loadItems, loadReadKeys, listInbox } = adminInboxTestHooks;

class FakeDb {
  constructor(seed = {}) {
    this.getCalls = 0;
    this.queryCalls = 0;
    this.listCalls = 0;
    this.commitCalls = 0;
    this.docs = new Map(
      Object.entries(seed).map(([path, data]) => [path, structuredClone(data)]),
    );
  }

  async get(path) {
    this.getCalls += 1;
    if (!this.docs.has(path)) return { exists: false, data: null };
    return { exists: true, data: structuredClone(this.docs.get(path)) };
  }

  async list(collection, pageSize = 200) {
    this.listCalls += 1;
    return [...this.docs.entries()]
      .filter(([path]) => path.startsWith(collection + "/"))
      .filter(([path]) => path.slice(collection.length + 1).indexOf("/") < 0)
      .slice(0, pageSize)
      .map(([path, data]) => ({
        id: path.slice(collection.length + 1),
        path,
        data: structuredClone(data),
      }));
  }

  writeCreate(path, fields) {
    return { kind: "create", path, fields: structuredClone(fields) };
  }

  writeUpdate(path, fields) {
    return { kind: "update", path, fields: structuredClone(fields) };
  }

  writeDelete(path) {
    return { kind: "delete", path };
  }

  async commit(_transaction, writes = []) {
    this.commitCalls += 1;
    for (const write of writes) {
      if (write.kind === "delete") {
        this.docs.delete(write.path);
        continue;
      }
      const previous = this.docs.get(write.path) || {};
      this.docs.set(write.path, {
        ...structuredClone(previous),
        ...structuredClone(write.fields || {}),
      });
    }
    return {};
  }

  async runQuery(collection, options = {}) {
    this.queryCalls += 1;
    const filters = Array.isArray(options.filters) ? options.filters : [];
    const limit = Math.max(0, Number(options.limit || 100));
    return [...this.docs.entries()]
      .filter(([path]) => path.startsWith(collection + "/"))
      .filter(([path]) => path.slice(collection.length + 1).indexOf("/") < 0)
      .map(([path, data]) => ({
        id: path.slice(collection.length + 1),
        path,
        data: structuredClone(data),
      }))
      .filter((row) =>
        filters.every((filter) => {
          if (filter.op !== "==") return false;
          return row.data?.[filter.field] === filter.value;
        }),
      )
      .slice(0, limit);
  }
}

function actor(capabilities = [], extra = {}) {
  return {
    uid: "admin_uid",
    owner: false,
    adminEnabled: true,
    capabilities: new Set(capabilities),
    ...extra,
  };
}

test("admin inbox exposes only approval sources allowed by capabilities", async () => {
  const db = new FakeDb({
    "diary_reports/report_1": {
      reportId: "report_1",
      status: "new",
      targetType: "diary",
      reasonLabel: "محتوى مسيء",
      createdAt: new Date(3000),
    },
    "agency_applications/app_1": {
      applicationId: "app_1",
      status: "pending",
      name: "Agency One",
      applicantPublicId: "12345678",
      createdAt: new Date(2000),
    },
    "agency_identity_change_requests/change_1": {
      requestId: "change_1",
      agencyId: "123456",
      requestedName: "Next",
      status: "pending",
      createdAt: new Date(1000),
    },
  });

  const reportsOnly = await loadItems(db, actor(["viewReports"]));
  assert.deepEqual(reportsOnly.map((item) => item.type), ["diary_report"]);

  const agenciesOnly = await loadItems(
    db,
    actor(["reviewAgencyApplications", "manageAgencies"]),
  );
  assert.equal(
    agenciesOnly.some((item) => item.type === "agency_application"),
    true,
  );
  assert.equal(
    agenciesOnly.some((item) => item.type === "agency_identity_change"),
    true,
  );
  assert.equal(
    agenciesOnly.some((item) => item.type === "diary_report"),
    false,
  );
});

test("admin inbox merges pending work and overlays per-admin read receipts", async () => {
  const db = new FakeDb({
    "diary_reports/report_a": {
      reportId: "report_a",
      status: "new",
      targetType: "diary_comment",
      reasonLabel: "تحرش/تنمر",
      createdAt: new Date(4000),
    },
    "agency_applications/app_a": {
      applicationId: "app_a",
      status: "under_review",
      name: "Agency A",
      applicantPublicId: "76543210",
      createdAt: new Date(3000),
    },
    "admin_notification_reads/admin_uid__diary_report_report_a": {
      userId: "admin_uid",
      key: "diary_report_report_a",
      readAt: new Date(),
    },
  });

  const snapshot = await listInbox(
    db,
    actor(["viewReports", "reviewAgencyApplications"]),
  );

  assert.equal(snapshot.items.length, 2);
  assert.equal(snapshot.items[0].type, "diary_report");
  assert.equal(snapshot.items[0].read, true);
  assert.equal(snapshot.items[1].type, "agency_application");
  assert.equal(snapshot.items[1].read, false);
  assert.equal(snapshot.unreadCount, 1);
});

test("admin inbox loads read receipts with one bounded query instead of per-item gets", async () => {
  const db = new FakeDb({
    "diary_reports/report_a": {
      reportId: "report_a",
      status: "new",
      targetType: "diary",
      reasonLabel: "spam",
      createdAt: new Date(3000),
    },
    "diary_reports/report_b": {
      reportId: "report_b",
      status: "under_review",
      targetType: "diary",
      reasonLabel: "spam",
      createdAt: new Date(2000),
    },
    "admin_notification_reads/admin_uid__diary_report_report_a": {
      userId: "admin_uid",
      key: "diary_report_report_a",
      readAt: new Date(),
    },
  });

  const readKeys = await loadReadKeys(db, "admin_uid");
  assert.equal(readKeys.has("diary_report_report_a"), true);

  const beforeGets = db.getCalls;
  const snapshot = await listInbox(db, actor(["viewReports"]));
  assert.equal(snapshot.items.length, 2);
  assert.equal(db.getCalls, beforeGets + 1);
  assert.equal(snapshot.items[0].read, true);
});

test("admin inbox stays bounded per source and globally", async () => {
  const seed = {};
  for (let index = 0; index < 50; index += 1) {
    seed[`diary_reports/report_${index}`] = {
      reportId: `report_${index}`,
      status: index % 2 === 0 ? "new" : "under_review",
      targetType: "diary",
      reasonLabel: "spam",
      createdAt: new Date(10_000 + index),
    };
  }
  const db = new FakeDb(seed);
  const items = await loadItems(db, actor(["viewReports"]));
  assert.equal(items.length <= 24, true);
});

test("admin inbox uses unified index after one-time fallback backfill", async () => {
  const db = new FakeDb({
    "diary_reports/report_a": {
      reportId: "report_a",
      status: "new",
      targetType: "diary",
      reasonLabel: "spam",
      createdAt: new Date(3000),
    },
  });

  const first = await listInbox(db, actor(["viewReports"]));
  assert.equal(first.items.length, 1);
  const sourceQueriesAfterFirst = db.queryCalls;
  assert.equal(db.docs.has("admin_inbox_items/__meta"), true);
  assert.equal(
    db.docs.has("admin_inbox_items/diary_report__report_a"),
    true,
  );

  const second = await listInbox(db, actor(["viewReports"]));
  assert.equal(second.items.length, 1);
  assert.equal(db.queryCalls, sourceQueriesAfterFirst);
  assert.equal(db.listCalls >= 2, true);
});

test("admin inbox key sanitizer rejects path separators implicitly", () => {
  assert.equal(safeKey("diary/report:123"), "diary_report_123");
  assert.equal(safeKey(""), "");
});
