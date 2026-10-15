import {
  adminInboxDeleteWrite, adminInboxUpsertWrite,
} from "./admin-inbox-index.js";

const clean = (value) => String(value ?? "").trim();
const safeId = (v) => /^[A-Za-z0-9_-]{12,180}$/.test(clean(v));
const ACTIONS = Object.freeze({
  suspend: ["account_suspended", "enable"],
  ban: ["account_banned", "unban"],
  restrictPrivateMessages: ["private_messages_restricted", "liftPrivateMessagesRestriction"],
  restrictRoomChat: ["room_chat_restricted", "liftRoomChatRestriction"],
  restrictRoomEntry: ["room_entry_restricted", "liftRoomEntryRestriction"],
  restrictRoomMic: ["room_mic_restricted", "liftRoomMicRestriction"],
});

export class AccountActionAppealError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function sourceVerified(operation, uid, report) {
  const action = clean(operation?.action);
  const reportId = clean(operation?.result?.linkedReportId);
  return Boolean(ACTIONS[action] && reportId &&
    clean(operation.targetType) === "user" &&
    clean(operation.targetId) === uid &&
    clean(operation.status) === "completed" &&
    clean(operation.result?.targetUid) === uid &&
    clean(operation.result?.action) === action &&
    ["actioned", "closed"].includes(clean(report?.status)) &&
    clean(report.moderationAction) === ACTIONS[action][0] &&
    clean(report.targetUid || report.targetUserId) === uid);
}

const appealPath = id => "account_action_appeals/" + id;
const operationPath = id => "control_operations/" + id;

// One immutable appeal per actually executed and reviewed sanction.
// Never count a mere complaint as wrongdoing, and never mutate account state.
export async function submitAccountActionAppeal(db, uid, body = {}) {
  const operationId = clean(body.operationId);
  const explanation = clean(body.explanation);
  if (!safeId(operationId) || !uid ||
      explanation.length > 800) {
    throw new AccountActionAppealError("invalid_appeal_request");
  }
  const tx = await db.beginTransaction();
  try {
    const [user, source, previous] = await Promise.all([
      db.get("users/" + uid, tx),
      db.get(operationPath(operationId), tx),
      db.get(appealPath(operationId), tx),
    ]);
    if (!user.exists || user.data?.authDeleted === true ||
        clean(user.data?.role) === "owner") {
      throw new AccountActionAppealError("appeal_not_available", 403);
    }
    const operation = source.data || {};
    const reportId = clean(operation.result?.linkedReportId);
    if (!source.exists || !ACTIONS[clean(operation.action)] ||
        !/^[A-Za-z0-9_-]{1,180}$/.test(reportId)) {
      throw new AccountActionAppealError("sanction_not_found", 404);
    }
    const report = await db.get("reports/" + reportId, tx);
    if (!sourceVerified(operation, uid, report.data || {}) ||
        !report.exists) {
      // The same generic response hides other users' sanctions and reports.
      throw new AccountActionAppealError("sanction_not_found", 404);
    }
    if (previous.exists) {
      if (clean(previous.data?.userUid) !== uid ||
          clean(previous.data?.operationId) !== operationId) {
        throw new AccountActionAppealError("appeal_conflict", 409);
      }
      await db.rollback(tx);
      return {
        ok: true, duplicate: true,
        operationId, status: clean(previous.data?.status),
      };
    }
    const now = new Date();
    await db.commit(tx, [
      db.writeCreate(appealPath(operationId), {
        operationId, userUid: uid, linkedReportId: reportId,
        action: clean(operation.action),
        explanation, status: "under_review",
        createdAt: now, updatedAt: now,
      }),
      adminInboxUpsertWrite(db, {
        type: "account_action_appeal",
        title: "اعتراض على إجراء إداري",
        body: "اعتراض موثّق على عقوبة منفّذة يحتاج مراجعة",
        targetId: operationId,
        route: "account_action_appeals", createdAt: now,
        priority: "important",
        meta: { userUid: uid, linkedReportId: reportId,
          status: "under_review" },
      }),
      db.writeCreate("notifications/account_appeal_received_" + operationId, {
        userId: uid, type: "account_action_appeal",
        title: "اعتراضك قيد المراجعة",
        body: "وصل اعتراضك للإدارة. ستصلك نتيجة المراجعة.",
        operationId, read: false, createdAt: now, updatedAt: now,
      }),
      db.writeCreate("admin_audit_logs/account_appeal_submit_" + operationId, {
        action: "submitAccountActionAppeal",
        actorUid: uid, targetType: "account_operation",
        targetId: operationId, createdAt: now,
      }),
    ]);
    return { ok: true, operationId, status: "under_review" };
  } catch (error) {
    await db.rollback(tx).catch(() => {});
    throw error;
  }
}

export async function getOwnAccountActionAppeal(db, uid, body = {}) {
  const id = clean(body.operationId);
  if (!safeId(id)) throw new AccountActionAppealError("invalid_appeal_request");
  const snap = await db.get(appealPath(id));
  if (!snap.exists || clean(snap.data?.userUid) !== uid) {
    throw new AccountActionAppealError("appeal_not_found", 404);
  }
  return {
    ok: true, operationId: id, status: clean(snap.data.status),
    decisionReason: clean(snap.data.decisionReason),
  };
}

export async function listAccountActionAppeals(db) {
  const rows = await db.runQuery("account_action_appeals", {
    filters: [{ field: "status", op: "==", value: "under_review" }],
    limit: 21,
  });
  return {
    ok: true,
    appeals: rows.slice(0, 20).map(row => ({
      operationId: clean(row.data?.operationId || row.id),
      userUid: clean(row.data?.userUid),
      action: clean(row.data?.action),
      linkedReportId: clean(row.data?.linkedReportId),
      explanation: clean(row.data?.explanation).slice(0, 800),
      status: "under_review",
    })).filter(row => safeId(row.operationId)),
    capped: rows.length > 20,
  };
}

// Acceptance is allowed only after a DIFFERENT, genuine completed reversal
// operation. Reviewing an appeal never lifts a sanction on its own.
export async function reviewAccountActionAppeal(db, reviewerUid, body = {}) {
  const operationId = clean(body.operationId);
  const key = clean(body.idempotencyKey);
  const decision = clean(body.decision);
  const reason = clean(body.reason);
  const reversalId = clean(body.reversalOperationId);
  if (!safeId(operationId) || !safeId(key) ||
      !["accepted", "rejected"].includes(decision) ||
      reason.length < 3 || reason.length > 200 ||
      (decision === "accepted" && !safeId(reversalId)) ||
      (decision === "rejected" && reversalId)) {
    throw new AccountActionAppealError("invalid_appeal_review");
  }
  const tx = await db.beginTransaction();
  try {
    const [previous, appeal, source] = await Promise.all([
      db.get(operationPath(key), tx),
      db.get(appealPath(operationId), tx),
      db.get(operationPath(operationId), tx),
    ]);
    if (previous.exists) {
      const d = previous.data || {};
      if (clean(d.actorUid) !== reviewerUid ||
          clean(d.action) !== "reviewAccountActionAppeal" ||
          clean(d.targetId) !== operationId ||
          clean(d.result?.decision) !== decision ||
          clean(d.result?.reversalOperationId) !== reversalId) {
        throw new AccountActionAppealError("appeal_conflict", 409);
      }
      await db.rollback(tx);
      return { ok: true, duplicate: true,
        operationId, decision };
    }
    if (!appeal.exists || !source.exists ||
        clean(appeal.data?.status) !== "under_review") {
      throw new AccountActionAppealError("appeal_not_pending", 409);
    }
    const targetUid = clean(appeal.data.userUid);
    const sourceAction = clean(source.data?.action);
    if (!ACTIONS[sourceAction] ||
        clean(source.data?.targetId) !== targetUid ||
        clean(source.data?.result?.targetUid) !== targetUid ||
        clean(appeal.data?.operationId) !== operationId ||
        clean(appeal.data?.action) !== sourceAction) {
      throw new AccountActionAppealError("appeal_source_conflict", 409);
    }
    if (decision === "accepted") {
      const reversal = await db.get(operationPath(reversalId), tx);
      const r = reversal.data || {};
      const lifecycle = source.data?.lifecycle || {};
      if (!reversal.exists || clean(r.action) !== ACTIONS[sourceAction][1] ||
          clean(r.status) !== "completed" ||
          clean(r.targetId) !== targetUid ||
          clean(r.result?.targetUid) !== targetUid ||
          clean(r.result?.originalOperationId) !== operationId ||
          clean(lifecycle.type) !== "lifted" ||
          clean(lifecycle.operationId) !== reversalId) {
        throw new AccountActionAppealError("reversal_not_verified", 409);
      }
    }
    const now = new Date();
    const result = { operationId, decision,
      reversalOperationId: decision === "accepted" ? reversalId : "" };
    await db.commit(tx, [
      db.writeUpdate(appealPath(operationId), {
        status: decision, decisionReason: reason,
        reviewedBy: reviewerUid, reviewedAt: now,
        reversalOperationId: result.reversalOperationId,
        updatedAt: now,
      }, ["status", "decisionReason", "reviewedBy",
        "reviewedAt", "reversalOperationId", "updatedAt"]),
      adminInboxDeleteWrite(db, "account_action_appeal", operationId),
      db.writeCreate("notifications/account_appeal_decision_" + operationId, {
        userId: targetUid, type: "account_action_appeal",
        title: decision === "accepted"
          ? "تم قبول اعتراضك" : "تم رفض اعتراضك",
        body: (decision === "accepted"
          ? "تم التحقق من رفع العقوبة المرتبطة باعتراضك. "
          : "تمت مراجعة الاعتراض ولم يتغير القرار. ") + reason,
        operationId, decision, read: false,
        createdAt: now, updatedAt: now,
      }),
      db.writeCreate("admin_audit_logs/account_appeal_review_" + key, {
        action: "reviewAccountActionAppeal", actorUid: reviewerUid,
        targetType: "account_operation", targetId: operationId,
        targetUid, decision, reason, reversalOperationId: result.reversalOperationId,
        createdAt: now,
      }),
      db.writeCreate(operationPath(key), {
        action: "reviewAccountActionAppeal",
        actorUid: reviewerUid, targetType: "account_operation",
        targetId: operationId, status: "completed",
        result, createdAt: now,
      }),
    ]);
    return { ok: true, ...result };
  } catch (error) {
    await db.rollback(tx).catch(() => {});
    throw error;
  }
}
