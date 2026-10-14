// Reporter-facing notifications are committed with the authoritative report
// transition. The operation key is unique and already checked by the caller.
// Nothing is sent for a mere UI selection or an unsuccessful moderation action.
const clean = (value) => String(value ?? "").trim();
const RECIPIENT_RE = /^[A-Za-z0-9_-]{1,180}$/;
const KEY_RE = /^[A-Za-z0-9_-]{12,180}$/;

function reportOutcomeText(status, actionKind, reason) {
  if (status === "under_review") {
    return {
      title: "بلاغك قيد المراجعة",
      body: "وصل بلاغك للإدارة، وهو الآن قيد المراجعة.",
    };
  }
  if (status === "rejected") {
    return {
      title: "نتيجة مراجعة بلاغك",
      body: "تمت مراجعة بلاغك ورفضه." +
        (reason ? " السبب: " + reason : ""),
    };
  }
  if (status === "actioned") {
    const actions = {
      diary_deleted: "تم حذف اليومية المخالفة بعد مراجعة بلاغك.",
      diary_comment_deleted: "تم حذف التعليق المخالف بعد مراجعة بلاغك.",
      warning: "تم اتخاذ إجراء تحذيري بعد مراجعة بلاغك.",
      account_suspended: "تم تعليق الحساب المخالف بعد مراجعة بلاغك.",
      private_messages_restricted: "تم تقييد إرسال الرسائل الخاصة للحساب المخالف بعد مراجعة بلاغك.",
      account_banned: "تم حظر الحساب المخالف بعد مراجعة بلاغك.",
    };
    return actionKind && actions[actionKind]
      ? { title: "تم اتخاذ إجراء بشأن بلاغك", body: actions[actionKind] }
      : {
          title: "نتيجة مراجعة بلاغك",
          body: "اكتملت المراجعة وتم توثيق قرار الإدارة بشأن بلاغك.",
        };
  }
  if (status === "closed") {
    return {
      title: "اكتملت مراجعة بلاغك",
      body: "تم إغلاق البلاغ بعد الانتهاء من مراجعته.",
    };
  }
  return null;
}

// The action kind comes from the completed server operation, not from an
// unverified free-text note submitted by Control.
export function reporterReportNotificationWrites(db, {
  reportId,
  reporterUid,
  status,
  actionKind = "",
  reason = "",
  operationKey,
  now = new Date(),
  subject = "general",
} = {}) {
  const recipient = clean(reporterUid);
  const key = clean(operationKey);
  if (!recipient || !RECIPIENT_RE.test(recipient)) return [];
  if (!KEY_RE.test(key)) throw new Error("invalid_notification_operation_key");
  const text = reportOutcomeText(status, actionKind, clean(reason).slice(0, 200));
  if (!text) return [];
  return [db.writeCreate("notifications/report_result_" + key, {
    userId: recipient,
    type: "report_status",
    category: "social",
    title: text.title,
    body: text.body,
    read: false,
    reportId: clean(reportId).slice(0, 768),
    reportStatus: status,
    reportSubject: subject,
    actionKind: clean(actionKind) || null,
    createdAt: now,
    updatedAt: now,
  })];
}

export const reporterReportNotificationTestHooks = Object.freeze({
  reportOutcomeText,
});
