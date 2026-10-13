import assert from "node:assert/strict";
import test from "node:test";
import {
  reporterReportNotificationWrites,
  reporterReportNotificationTestHooks,
} from "../../cloudflare-worker/src/reporter-report-notifications.js";

const fakeDb = {
  writeCreate(path, fields) { return { kind: "create", path, fields }; },
};

test("notification content is bounded and respects optional refusal reason", () => {
  const build = (status, actionKind, reason = "") =>
    reporterReportNotificationTestHooks.reportOutcomeText(status, actionKind, reason);
  assert.match(build("under_review", "").title, /قيد المراجعة/);
  assert.match(build("rejected", "", "").body, /رفضه/);
  assert.doesNotMatch(build("rejected", "", "").body, /السبب:/);
  assert.match(build("rejected", "", "إساءة غير مثبتة").body, /السبب: إساءة غير مثبتة/);
  assert.match(build("actioned", "diary_deleted").body, /حذف اليومية/);
  assert.match(build("actioned", "diary_comment_deleted").body, /حذف التعليق/);
  assert.match(build("actioned", "account_suspended").body, /تعليق الحساب/);
  assert.match(build("actioned", "account_banned").body, /حظر الحساب/);
  assert.doesNotMatch(build("actioned", "unverified").body, /حظر الحساب/);
});

test("notice is addressed to the reporter only, not the accused account", () => {
  const [notice] = reporterReportNotificationWrites(fakeDb, {
    reporterUid: "reporterUid01",
    reportId: "diary_report_d1",
    status: "under_review",
    operationKey: "report_change_123456",
  });
  assert.equal(notice.path, "notifications/report_result_report_change_123456");
  assert.equal(notice.fields.userId, "reporterUid01");
  assert.equal(notice.fields.category, "social");
  assert.equal(notice.fields.read, false);
  assert.equal(notice.fields.reportStatus, "under_review");
  assert.deepEqual(reporterReportNotificationWrites(fakeDb, {
    reporterUid: "", status: "under_review", operationKey: "report_change_123456",
  }), []);
  assert.throws(() => reporterReportNotificationWrites(fakeDb, {
    reporterUid: "reporterUid01", status: "under_review",
    operationKey: "illegal/path",
  }), /invalid_notification_operation_key/);
});
