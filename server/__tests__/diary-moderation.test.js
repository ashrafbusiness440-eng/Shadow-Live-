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
    if (collectionPath === "admin_audit_logs" ||
        collectionPath === "diary_audit_logs") {
      this.historyQueries = (this.historyQueries || 0) + 1;
      assert.equal(options.limit, 11);
      assert.equal(options.filters?.length, 1);
      const filter = options.filters[0];
      assert.equal(filter.op, "==");
      assert.equal(filter.field,
        collectionPath === "admin_audit_logs" ? "reportId" : "diaryId");
      return [...this.docs.entries()]
        .filter(([path, data]) =>
          path.startsWith(collectionPath + "/") &&
          !path.substring(collectionPath.length + 1).includes("/") &&
          data?.[filter.field] === filter.value)
        .slice(0, options.limit)
        .map(([path, data]) => ({
          id: path.substring(collectionPath.length + 1),
          data: structuredClone(data),
        }));
    }
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
  assert.equal(item.evidence, undefined);
  assert.equal(item.hasSensitiveEvidence, true);
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

test("a warning receipt cannot resolve a different diary report about the same account", async () => {
  const key = "diary_replayed_warning_123456";
  const reportOne = {...report("first_report", 8000, "under_review"),
    targetOwnerUid:"writer",targetAuthorUid:"writer"};
  const reportTwo = {...report("second_report", 9000, "under_review"),
    targetOwnerUid:"writer",targetAuthorUid:"writer"};
  const db = new FakeDb({
    "diary_reports/first_report": reportOne,
    "reports/first_report": reportOne,
    "diary_reports/second_report": reportTwo,
    "reports/second_report": reportTwo,
    "users/admin_uid": {role:"owner",adminEnabled:true,accountStatus:"active"},
    "users/writer": {role:"user",accountStatus:"active"},
  });
  const input = {accountAction:"warn",reason:"تحذير مثبت لمخالفة محددة",
    idempotencyKey:key};
  await diaryModerationTestHooks.resolveDiaryWithAccountAction(
    db,{}, {sub:"admin_uid"}, "admin_uid", {...input,reportId:"first_report"});
  assert.equal(db.docs.get("control_operations/" + key + "_account")
    .result.linkedReportId,"first_report");
  await assert.rejects(() => diaryModerationTestHooks.resolveDiaryWithAccountAction(
    db,{}, {sub:"admin_uid"}, "admin_uid", {...input,reportId:"second_report"}),
    /unverified_account_action/);
  assert.equal(db.docs.get("diary_reports/second_report").status,"under_review");
  assert.equal(db.docs.get("users/writer").warningCount,1);
  assert.equal([...db.docs.keys()].filter(k =>
    k === "notifications/report_result_" + key).length,1);
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


test("U6-E3 verified diary deletion is indexed once for the real author", async () => {
  const key="u6e3_diary_delete_12345";
  const item=report("u6e3_report",9000,"under_review");
  const db=new FakeDb({
    "diary_reports/u6e3_report":item,
    "reports/u6e3_report":item,
    ["diary_operations/"+key]:{
      action:"moderatorDeleteDiary",actorUid:"admin_uid",
      targetUid:"owner",diaryId:"diary_1",status:"completed",
    },
    ["admin_audit_logs/diary_delete_"+key]:{
      action:"moderatorDeleteDiary",actorUid:"admin_uid",
      reason:"تم حذف اليومية بعد إثبات الإساءة",
    },
  });
  await diaryModerationTestHooks.markReportActioned(
    db,"admin_uid","u6e3_report","تم التحقق من الواقعة",
    key,"diary_deleted",
  );
  const history=db.docs.get("control_operations/history_diary_"+key);
  assert.equal(history.targetId,"owner");
  assert.equal(history.targetType,"user");
  assert.equal(history.action,"moderatorDeleteDiary");
  assert.equal(history.result.linkedReportId,"u6e3_report");
  assert.equal(db.docs.get("reports/u6e3_report").status,"actioned");
  await diaryModerationTestHooks.markReportActioned(
    db,"admin_uid","u6e3_report","تم التحقق من الواقعة",
    key,"diary_deleted",
  );
  assert.equal([...db.docs.keys()].filter(path=>
    path.startsWith("control_operations/history_diary_")).length,1);
});

test("U6-E3 comment deletion belongs to comment writer, never diary owner", async () => {
  const key="u6e3_comment_delete_12345";
  const item={...report("u6e3_comment",9000,"under_review"),
    targetType:"diary_comment",commentId:"comment_1",
    targetAuthorUid:"comment_writer",targetOwnerUid:"diary_owner"};
  const db=new FakeDb({
    "diary_reports/u6e3_comment":item,
    "reports/u6e3_comment":item,
    ["diary_operations/"+key]:{
      action:"moderatorDeleteDiaryComment",actorUid:"admin_uid",
      targetUid:"comment_writer",diaryId:"diary_1",
      commentId:"comment_1",status:"completed",
    },
  });
  await diaryModerationTestHooks.markReportActioned(
    db,"admin_uid","u6e3_comment","تم حذف تعليق مخالف",
    key,"diary_comment_deleted",
  );
  const history=db.docs.get("control_operations/history_diary_"+key);
  assert.equal(history.targetId,"comment_writer");
  assert.notEqual(history.targetId,"diary_owner");
});

test("U6-E3 never indexes a deletion without a matching completed receipt", async () => {
  const key="u6e3_no_proof_12345";
  const item=report("u6e3_unverified",9000,"under_review");
  const db=new FakeDb({
    "diary_reports/u6e3_unverified":item,
    "reports/u6e3_unverified":item,
    ["diary_operations/"+key]:{
      action:"moderatorDeleteDiary",actorUid:"admin_uid",
      targetUid:"different_person",diaryId:"diary_1",status:"completed",
    },
  });
  await diaryModerationTestHooks.markReportActioned(
    db,"admin_uid","u6e3_unverified","الحذف منفذ",
    key,"diary_deleted",
  );
  assert.equal(db.docs.has("control_operations/history_diary_"+key),false);
  assert.equal(db.docs.get("diary_reports/u6e3_unverified").status,"actioned");
});


test("U6-E3 real moderated diary removal records the canonical owner and case", async () => {
  const key="u6e3_real_diary_123456";
  const item=report("u6e3_real_report",9000,"under_review");
  const db=new FakeDb({
    "diary_reports/u6e3_real_report":item,
    "reports/u6e3_real_report":item,
    "diaries/diary_1":{ownerUid:"owner",images:[],commentCount:0},
    "users/owner/diaries/diary_1":{commentCount:0},
  });
  const out=await diaryModerationTestHooks.deleteDiaryTarget(
    db,"admin_uid",{diaryId:"diary_1",reportId:"u6e3_real_report",
      reason:"مخالفة محتوى مؤكدة",idempotencyKey:key});
  assert.equal(out.ok,true);
  assert.equal(db.docs.has("diaries/diary_1"),false);
  assert.equal(db.docs.get("diary_operations/"+key).targetUid,"owner");
  assert.equal(db.docs.get("reports/u6e3_real_report").status,"actioned");
  assert.equal(db.docs.get("control_operations/history_diary_"+key).targetId,"owner");
});

test("U6-E3 real comment removal records its author rather than diary owner", async () => {
  const key="u6e3_real_comment_123456";
  const item={...report("u6e3_real_comment_report",9000,"under_review"),
    targetType:"diary_comment",targetId:"comment_1",
    commentId:"comment_1",targetOwnerUid:"owner",
    targetAuthorUid:"writer"};
  const db=new FakeDb({
    "diary_reports/u6e3_real_comment_report":item,
    "reports/u6e3_real_comment_report":item,
    "diaries/diary_1":{ownerUid:"owner",commentCount:1},
    "users/owner/diaries/diary_1":{commentCount:1},
    "diaries/diary_1/comments/comment_1":{authorUid:"writer"},
  });
  const out=await diaryModerationTestHooks.deleteCommentTarget(
    db,"admin_uid",{diaryId:"diary_1",commentId:"comment_1",
      reportId:"u6e3_real_comment_report",reason:"تعليق مخالف مؤكّد",
      idempotencyKey:key});
  assert.equal(out.ok,true);
  assert.equal(db.docs.has("diaries/diary_1/comments/comment_1"),false);
  assert.equal(db.docs.get("diary_operations/"+key).targetUid,"writer");
  assert.equal(db.docs.get("control_operations/history_diary_"+key).targetId,"writer");
});


function oldRemovalCase({
  isComment = false, targetUid = "writer",
  receiptActor = "moderator", reportStatus = "actioned",
  reportId = "history_case", key = "legacy_delete_1234567",
} = {}) {
  const kind = isComment ? "diary_comment_deleted" : "diary_deleted";
  const action = isComment ? "moderatorDeleteDiaryComment"
    : "moderatorDeleteDiary";
  const reportData = {
    ...report(reportId, 5000, reportStatus),
    targetType: isComment ? "diary_comment" : "diary",
    targetOwnerUid: isComment ? "diary_owner" : targetUid,
    targetAuthorUid: targetUid,
    commentId: isComment ? "comment_7" : null,
    moderationAction:kind,reviewedBy:"moderator",
  };
  const now = new Date(7000);
  return {
    ["diary_reports/" + reportId]: reportData,
    ["reports/" + reportId]: reportData,
    ["admin_audit_logs/diary_report_action_" + key]: {
      action:"actionDiaryReport", actorUid:"moderator", reportId,
      operationId:key, after:{status:"actioned",moderationAction:kind},
      createdAt:now,
    },
    ["diary_operations/" + key]:{
      action,actorUid:receiptActor,diaryId:"diary_1",
      ...(isComment?{commentId:"comment_7"}:{}),
      status:"completed",createdAt:now,
    },
    ["admin_audit_logs/" + (isComment
      ? "diary_comment_delete_" : "diary_delete_") + key]:{
      action,actorUid:"moderator",reportId,
      targetId:isComment?"comment_7":"diary_1",
      ...(isComment?{diaryId:"diary_1"}:{}),
      reason:"حذف قديم تم تنفيذه",createdAt:now,
    },
    ["diary_audit_logs/deletion_" + key]:{
      action,actorUid:"moderator",diaryId:"diary_1",
      ownerUid:isComment?"diary_owner":targetUid,
      ...(isComment?{commentId:"comment_7",authorUid:targetUid}:{}),
      createdAt:now,
    },
  };
}

test("U6-E5 reuses one old deletion receipt, with no new penalty or notifications", async () => {
  const key="legacy_delete_1234567";
  const db=new FakeDb(oldRemovalCase({key}));
  const input={reportId:"history_case"};
  const out=await diaryModerationTestHooks.restoreVerifiedDeletionHistory(
    db,"owner",input);
  assert.equal(out.code,"restored");
  assert.equal(out.targetUid,"writer");
  assert.equal(db.historyQueries,2);
  const receipt=db.docs.get("control_operations/history_diary_"+key);
  assert.equal(receipt.actorUid,"moderator");
  assert.equal(receipt.targetId,"writer");
  assert.equal(receipt.result.linkedReportId,"history_case");
  assert.equal(receipt.reconciledBy,"owner");
  assert.ok(db.docs.has("admin_audit_logs/diary_history_restore_"+key));
  assert.deepEqual([...db.docs.keys()].filter(x=>
    x.startsWith("notifications/")),[]);
  const again=await diaryModerationTestHooks.restoreVerifiedDeletionHistory(
    db,"owner",input);
  assert.equal(again.code,"duplicate");
  assert.equal([...db.docs.keys()].filter(x=>
    x.startsWith("control_operations/history_diary_")).length,1);
});

test("U6-E5 verified old comment deletion belongs to author, not diary owner", async () => {
  const db=new FakeDb(oldRemovalCase({isComment:true}));
  const result=await diaryModerationTestHooks.restoreVerifiedDeletionHistory(
    db,"owner",{reportId:"history_case"});
  assert.equal(result.targetUid,"writer");
  assert.equal(db.docs.get(
    "control_operations/history_diary_legacy_delete_1234567").targetId,"writer");
});

test("U6-E5 refuses rejected reports, unmatched owners, incomplete receipts and ambiguous audits", async () => {
  const root=oldRemovalCase();
  const scenarios=[
    (docs)=>{docs["diary_reports/history_case"].status="rejected";},
    (docs)=>{docs["diary_audit_logs/deletion_legacy_delete_1234567"].ownerUid="someone_else";},
    (docs)=>{docs["diary_operations/legacy_delete_1234567"].status="pending";},
    (docs)=>{docs["diary_operations/legacy_delete_1234567"].actorUid="other";},
    (docs)=>{delete docs["admin_audit_logs/diary_delete_legacy_delete_1234567"];},
    (docs)=>{docs["admin_audit_logs/diary_report_action_duplicate"]={
      ...docs["admin_audit_logs/diary_report_action_legacy_delete_1234567"],
      operationId:"duplicate",
    };},
  ];
  for(const change of scenarios){
    const docs=structuredClone(root); change(docs);
    const db=new FakeDb(docs);
    await assert.rejects(()=>
      diaryModerationTestHooks.restoreVerifiedDeletionHistory(
        db,"owner",{reportId:"history_case"}),
      /history_case_not_verified|history_proof_missing/);
    assert.equal([...db.docs.keys()].some(k=>
      k.startsWith("control_operations/history_diary_")),false);
  }
});

test("U6-E5 audit queries are capped and oversized historical samples fail closed", async () => {
  const docs=oldRemovalCase();
  for(let i=0;i<11;i++){
    docs["diary_audit_logs/extra_"+i]={
      action:"unrelated",diaryId:"diary_1",ownerUid:"other",
    };
  }
  const db=new FakeDb(docs);
  await assert.rejects(()=>
    diaryModerationTestHooks.restoreVerifiedDeletionHistory(
      db,"owner",{reportId:"history_case"}),/history_sample_capped/);
  assert.equal(db.historyQueries,2);
  assert.equal(db.docs.has("control_operations/history_diary_legacy_delete_1234567"),false);
});

test("U6-E5 old report identifiers remain path-safe and may exceed 180 chars", async () => {
  const long="case_"+"x".repeat(270);
  const docs=oldRemovalCase({reportId:long});
  const db=new FakeDb(docs);
  const result=await diaryModerationTestHooks.restoreVerifiedDeletionHistory(
    db,"owner",{reportId:long});
  assert.equal(result.reportId,long);
  await assert.rejects(()=>
    diaryModerationTestHooks.restoreVerifiedDeletionHistory(
      db,"owner",{reportId:"bad/id"}),/invalid_report_id/);
});

test("U6-E7 diary list and deep link withhold evidence; access is scoped and audited", async () => {
  const db=new FakeDb({
    "diary_reports/report_private": {
      ...report("report_private", 5000),
      evidence:{text:"SECRET_DIARY_EVIDENCE"},
    },
  });
  const list=await listReports(db,{limit:20});
  const detail=await getReport(db,{reportId:"report_private"});
  assert.equal(list.items[0].hasSensitiveEvidence,true);
  assert.equal(detail.item.hasSensitiveEvidence,true);
  assert.equal(JSON.stringify(list).includes("SECRET_DIARY_EVIDENCE"),false);
  assert.equal(JSON.stringify(detail).includes("SECRET_DIARY_EVIDENCE"),false);
  const open=(actor,reportId="report_private")=>
    diaryModerationTestHooks.openDiarySensitiveEvidence(db,actor,{reportId});
  await assert.rejects(()=>open({uid:"reviewer",owner:false,capabilities:["reviewReports"]}),
    /forbidden_evidence/);
  const permitted=await open({uid:"reviewer",owner:false,capabilities:["viewReportEvidence"]});
  assert.equal(permitted.evidence.text,"SECRET_DIARY_EVIDENCE");
  await assert.rejects(()=>open({uid:"owner",owner:true,capabilities:[]},"../report_private"),
    /invalid_report_id/);
  const audit=[...db.docs.entries()].filter(([k])=>
    k.startsWith("admin_audit_logs/report_evidence_open_"));
  assert.equal(audit.length,1);
  assert.equal(audit[0][1].actorUid,"reviewer");
  assert.equal(audit[0][1].sourceCollection,"diary_reports");
  assert.equal(JSON.stringify(audit).includes("SECRET_DIARY_EVIDENCE"),false);
});

test("U6-E7 diary legacy long IDs have safe audited evidence access", async () => {
  const reportId="diary_comment_"+"x".repeat(250);
  const db=new FakeDb({
    ["diary_reports/"+reportId]: {...report(reportId,5000),
      evidence:{text:"LONG_PRIVATE_PROOF"}},
  });
  const out=await diaryModerationTestHooks.openDiarySensitiveEvidence(
    db,{uid:"owner",owner:true,capabilities:[]},{reportId});
  assert.equal(out.evidence.text,"LONG_PRIVATE_PROOF");
  const audit=[...db.docs.values()].filter(x=>x.action==="openSensitiveReportEvidence");
  assert.equal(audit.length,1);
  assert.equal(audit[0].reportId,reportId);
  db.commit=async()=>{throw Error("audit_unavailable")};
  await assert.rejects(()=>diaryModerationTestHooks.openDiarySensitiveEvidence(
    db,{uid:"owner",owner:true,capabilities:[]},{reportId}),/audit_unavailable/);
});
