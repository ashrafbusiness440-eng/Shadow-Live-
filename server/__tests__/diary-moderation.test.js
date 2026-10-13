import assert from "node:assert/strict";
import test from "node:test";

import { diaryModerationTestHooks } from "../../cloudflare-worker/src/diary-moderation.js";

const {
  listReports,
  getReport,
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
  const notice = db.docs.get("notifications/report_result_review_report_0000000001");
  assert.equal(notice.userId, "reporter");
  assert.match(notice.body, /قيد المراجعة/);
  const repeated = await reviewReport(db, "admin_uid", {
    reportId: "report_review", status: "under_review",
    reason: "manual review", idempotencyKey: "review_report_0000000001",
  });
  assert.equal(repeated.code, "duplicate");
  assert.equal([...db.docs.keys()].filter(x => x ===
    "notifications/report_result_review_report_0000000001").length, 1);
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


test("exact report lookup supports admin notification deep links", async () => {
  const db = new FakeDb({
    "diary_reports/report_exact": report("report_exact", 7000),
  });

  const result = await getReport(db, { reportId: "report_exact" });
  assert.equal(result.ok, true);
  assert.equal(result.item.reportId, "report_exact");
  assert.equal(result.item.targetType, "diary");

  await assert.rejects(
    () => getReport(db, { reportId: "missing_report" }),
    /report_not_found/,
  );
});


test("legacy long comment report ids remain actionable and cursor-safe", async () => {
  const diaryId = "diary_" + "a".repeat(90);
  const commentId = "comment_" + "b".repeat(88);
  const reporterUid = "reporter_" + "c".repeat(87);
  const reportId = `diary_comment_${diaryId}_${commentId}_${reporterUid}`;
  assert.equal(reportId.length > 220, true);
  assert.equal(reportId.length <= 512, true);
  const db = new FakeDb({
    [`diary_reports/${reportId}`]: {
      ...report(reportId, 9000),
      targetType: "diary_comment",
      targetId: commentId,
      diaryId,
      commentId,
      reporterUid,
      targetAuthorUid: "comment_author",
      targetOwnerUid: "diary_owner",
    },
    [`reports/${reportId}`]: report(reportId, 9000),
    [`public_profiles/${reporterUid}`]: {
      displayName: "صاحب البلاغ",
      publicId: "12345678",
    },
    "public_profiles/comment_author": {
      displayName: "صاحب التعليق",
      publicId: "87654321",
    },
    "public_profiles/diary_owner": {
      displayName: "صاحب اليومية",
      publicId: "11112222",
    },
  });
  const focused = await getReport(db, { reportId });
  assert.equal(focused.item.reportId, reportId);
  assert.equal(focused.item.reporterProfile.displayName, "صاحب البلاغ");
  assert.equal(focused.item.targetAuthorProfile.displayName, "صاحب التعليق");
  assert.equal(focused.item.diaryOwnerProfile.displayName, "صاحب اليومية");
  assert.equal(focused.item.reporterProfile.publicId, "12345678");

  const list = await listReports(db, { limit: 20 });
  assert.equal(list.items[0].reportId, reportId);
  assert.deepEqual(parseCursor(`9000|${reportId}`), { createdAtMs: 9000, reportId });

  const reviewed = await reviewReport(db, "admin_uid", {
    reportId,
    status: "under_review",
    reason: "راجعنا البلاغ",
    idempotencyKey: "diaryctl_review_12345678901",
  });
  assert.equal(reviewed.status, "under_review");
  assert.equal(db.docs.get(`diary_reports/${reportId}`).status, "under_review");
});

test("report-only long id validation rejects path injection and >512 chars", () => {
  assert.equal(diaryModerationTestHooks.safeReportId("x".repeat(310)), "x".repeat(310));
  assert.throws(() => diaryModerationTestHooks.safeReportId("x".repeat(513)), /invalid_report_id/);
  assert.throws(() => diaryModerationTestHooks.safeReportId("a/b"), /invalid_report_id/);
  assert.throws(() => diaryModerationTestHooks.safeReportId("a\\\\b"), /invalid_report_id/);
});

test("rejecting one long report preserves another reporter's colliding legacy alert", async () => {
  const base = "diary_comment_" + "same".repeat(46);
  const reportA = base + "_reporter_A";
  const reportB = base + "_reporter_B";
  const legacyPath = "admin_inbox_items/diary_report__" + reportA.slice(0, 160);
  const db = new FakeDb({
    [`diary_reports/${reportA}`]: report(reportA, 8000),
    [`reports/${reportA}`]: report(reportA, 8000),
    [`diary_reports/${reportB}`]: report(reportB, 8100),
    [`reports/${reportB}`]: report(reportB, 8100),
    [legacyPath]: { type: "diary_report", targetId: reportB, key: "diary_report_" + reportB },
    [`admin_inbox_items/diary_report__${reportA}`]: { targetId: reportA },
  });
  await reviewReport(db, "admin_uid", {
    reportId: reportA,
    status: "rejected",
    reason: "بلاغ غير مؤكد",
    idempotencyKey: "diaryctl_reject_report_A_123456",
  });
  assert.equal(db.docs.get(`diary_reports/${reportA}`).status, "rejected");
  assert.equal(db.docs.has(`admin_inbox_items/diary_report__${reportA}`), false);
  assert.equal(db.docs.get(legacyPath).targetId, reportB);

  await reviewReport(db, "admin_uid", {
    reportId: reportB,
    status: "rejected",
    reason: "انتهت المراجعة",
    idempotencyKey: "diaryctl_reject_report_B_123456",
  });
  assert.equal(db.docs.has(legacyPath), false);
});

test("diary rejection reason is optional and reporter alone is notified", async () => {
  const db = new FakeDb({
    "diary_reports/report_rejected": report("report_rejected", 6000),
    "reports/report_rejected": report("report_rejected", 6000),
  });
  const out = await reviewReport(db, "admin_uid", {
    reportId: "report_rejected", status: "rejected", reason: "",
    idempotencyKey: "diary_reject_optional_123456",
  });
  assert.equal(out.status, "rejected");
  const note = db.docs.get("notifications/report_result_diary_reject_optional_123456");
  assert.equal(note.userId, "reporter");
  assert.equal(note.reportStatus, "rejected");
  assert.doesNotMatch(note.body, /السبب:/);
  await assert.rejects(() => reviewReport(new FakeDb({
    "diary_reports/r1": report("r1", 5000),
    "reports/r1": report("r1", 5000),
  }), "admin", {
    reportId: "r1", status: "under_review", reason: "",
    idempotencyKey: "diary_review_bad_123456",
  }), /invalid_reason/);
});

test("moderation refuses mismatched report reference before deleting content", async () => {
  const db = new FakeDb({
    "diary_reports/another_report": report("another_report", 6000),
  });
  await assert.rejects(() => diaryModerationTestHooks.assertReportTarget(
    db, "another_report", "someone_elses_diary",
  ), /report_target_mismatch/);
  await assert.rejects(() => diaryModerationTestHooks.assertReportTarget(
    db, "another_report", "diary_1", "wrong_comment",
  ), /report_target_mismatch/);
  await diaryModerationTestHooks.assertReportTarget(db, "another_report", "diary_1");
});

test("real suspension on reported diary account precedes owner's report notice", async () => {
  const db = new FakeDb({
    "diary_reports/report_suspend": report("report_suspend", 6000, "under_review"),
    "reports/report_suspend": report("report_suspend", 6000, "under_review"),
    "users/admin_uid": {role:"owner",adminEnabled:true,accountStatus:"active"},
    "users/owner": {role:"user",accountStatus:"active"},
  });
  const result = await diaryModerationTestHooks.resolveDiaryWithAccountAction(
    db, {}, {sub:"admin_uid"}, "admin_uid", {
      reportId:"report_suspend",accountAction:"suspend",
      durationMinutes:60,reason:"مخالفة واضحة في المحتوى",
      idempotencyKey:"diary_suspend_123456",
    },
  );
  assert.equal(result.status,"actioned");
  assert.equal(db.docs.get("users/owner").accountStatus,"suspended");
  assert.equal(db.docs.get("diary_reports/report_suspend").status,"actioned");
  const message = db.docs.get(
    "notifications/report_result_diary_suspend_123456");
  assert.equal(message.userId,"reporter");
  assert.equal(message.actionKind,"account_suspended");
  assert.match(message.body,/تعليق الحساب/);
});


test("warning reported diary owner uses audited account action and notifies both parties", async () => {
  const key = "diary_warning_123456789";
  const db = new FakeDb({
    "diary_reports/report_warning": report("report_warning", 8000, "under_review"),
    "reports/report_warning": report("report_warning", 8000, "under_review"),
    "users/admin_uid": {role:"owner",adminEnabled:true,accountStatus:"active"},
    "users/owner": {role:"user",accountStatus:"active",warningCount:0},
  });
  const body = {reportId:"report_warning",accountAction:"warn",
    reason:"تحذير بسبب محتوى غير مناسب",idempotencyKey:key};
  const result = await diaryModerationTestHooks.resolveDiaryWithAccountAction(
    db, {}, {sub:"admin_uid"}, "admin_uid", body);
  assert.equal(result.moderationAction,"warning");
  assert.equal(db.docs.get("diary_reports/report_warning").status,"actioned");
  assert.equal(db.docs.get("reports/report_warning").moderationAction,"warning");
  const target = db.docs.get("users/owner");
  assert.equal(target.accountStatus,"active");
  assert.equal(target.warningCount,1);
  assert.equal(target.lastWarnedBy,"admin_uid");
  assert.equal(target.lastWarningReason,body.reason);
  const accountReceipt = db.docs.get("control_operations/" + key + "_account");
  assert.equal(accountReceipt.action,"warn");
  assert.equal(accountReceipt.status,"completed");
  const targetNotification = db.docs.get("notifications/account_warning_" + key + "_account");
  assert.equal(targetNotification.userId,"owner");
  assert.match(targetNotification.body,/تحذير بسبب محتوى/);
  const reporterNotification = db.docs.get("notifications/report_result_" + key);
  assert.equal(reporterNotification.userId,"reporter");
  assert.equal(reporterNotification.actionKind,"warning");
  assert.match(reporterNotification.body,/تحذيري/);
  const repeated = await diaryModerationTestHooks.resolveDiaryWithAccountAction(
    db, {}, {sub:"admin_uid"}, "admin_uid", body);
  assert.equal(repeated.status,"actioned");
  assert.equal(db.docs.get("users/owner").warningCount,1);
  assert.equal([...db.docs.keys()].filter(k=>k.startsWith(
    "notifications/account_warning_" + key)).length,1);
});

test("warning on a reported comment targets its writer, not diary owner", async () => {
  const key = "diary_comment_warn_123456789";
  const item = {...report("report_comment_warning", 9000, "under_review"),
    targetType:"diary_comment",commentId:"comment_1",
    targetAuthorUid:"comment_writer",targetOwnerUid:"diary_owner"};
  const db = new FakeDb({
    "diary_reports/report_comment_warning": item,
    "reports/report_comment_warning": item,
    "users/admin_uid": {role:"owner",adminEnabled:true,accountStatus:"active"},
    "users/comment_writer": {role:"user",accountStatus:"active"},
    "users/diary_owner": {role:"user",accountStatus:"active"},
  });
  const result = await diaryModerationTestHooks.resolveDiaryWithAccountAction(
    db, {}, {sub:"admin_uid"}, "admin_uid", {
      reportId:"report_comment_warning",accountAction:"warn",
      reason:"تعليق مسيء يستحق التحذير",idempotencyKey:key,
    });
  assert.equal(result.moderationAction,"warning");
  assert.equal(db.docs.get("users/comment_writer").warningCount,1);
  assert.equal(db.docs.get("users/diary_owner").warningCount,undefined);
  assert.equal(db.docs.get("notifications/account_warning_" + key + "_account").userId,"comment_writer");
  assert.equal(db.docs.get("notifications/report_result_" + key).userId,"reporter");
});

test("diary warning rejects owner targets and reviewers without sanction capabilities", async () => {
  const ownerItem = report("report_protected", 8000, "under_review");
  const db = new FakeDb({
    "diary_reports/report_protected": ownerItem,
    "reports/report_protected": ownerItem,
    "users/admin_uid": {role:"owner",adminEnabled:true,accountStatus:"active"},
    "users/owner": {role:"owner",adminEnabled:true,accountStatus:"active"},
  });
  await assert.rejects(() => diaryModerationTestHooks.resolveDiaryWithAccountAction(
    db, {}, {sub:"admin_uid"}, "admin_uid", {
      reportId:"report_protected",accountAction:"warn",
      reason:"تحذير غير مسموح",idempotencyKey:"diary_protected_warn_123456",
    }), /owner_protected/);
  assert.equal(db.docs.get("diary_reports/report_protected").status,"under_review");
  assert.equal(db.docs.has("notifications/report_result_diary_protected_warn_123456"),false);

  const reviewer = new FakeDb({
    "diary_reports/report_reviewer": report("report_reviewer", 9000, "under_review"),
    "reports/report_reviewer": report("report_reviewer", 9000, "under_review"),
    "users/reviewer": {role:"moderator",adminEnabled:true,
      capabilities:["reviewReports"],accountStatus:"active"},
    "users/owner": {role:"user",accountStatus:"active"},
  });
  await assert.rejects(() => diaryModerationTestHooks.resolveDiaryWithAccountAction(
    reviewer, {}, {sub:"reviewer"}, "reviewer", {
      reportId:"report_reviewer",accountAction:"warn",
      reason:"تحذير دون صلاحية",idempotencyKey:"diary_reviewer_warn_123456",
    }), /forbidden/);
  assert.equal(reviewer.docs.get("diary_reports/report_reviewer").status,"under_review");
  assert.equal(reviewer.docs.get("users/owner").warningCount,undefined);
  assert.equal(reviewer.docs.has("notifications/report_result_diary_reviewer_warn_123456"),false);
});

test("missing or mismatched reported target prevents account punishment", async () => {
  const db = new FakeDb({
    "diary_reports/report_missing_target": {
      ...report("report_missing_target", 9000, "under_review"),
      targetOwnerUid:"", targetAuthorUid:"",
    },
    "users/admin_uid": {role:"owner",adminEnabled:true},
  });
  await assert.rejects(
    () => diaryModerationTestHooks.resolveDiaryWithAccountAction(
      db, {}, {sub:"admin_uid"}, "admin_uid", {
        reportId:"report_missing_target",accountAction:"ban",
        reason:"مخالفة أخرى",idempotencyKey:"diary_no_target_123456",
      }),
    /report_target_mismatch/,
  );
  assert.equal(db.docs.has("notifications/report_result_diary_no_target_123456"),false);
});

test("a plain review request cannot falsely claim a diary punishment", async () => {
  const db = new FakeDb({
    "diary_reports/report_not_actioned": report("report_not_actioned", 7000, "under_review"),
    "reports/report_not_actioned": report("report_not_actioned", 7000, "under_review"),
  });
  await assert.rejects(() => reviewReport(db, "admin_uid", {
    reportId: "report_not_actioned", status: "actioned",
    reason: "نفذنا إجراء", idempotencyKey: "fake_action_12345678",
  }), /action_requires_execution/);
  assert.equal(db.docs.get("diary_reports/report_not_actioned").status,
    "under_review");
  assert.equal([...db.docs.keys()].filter(k =>
    k.startsWith("notifications/report_result_fake_action_")).length, 0);
});
