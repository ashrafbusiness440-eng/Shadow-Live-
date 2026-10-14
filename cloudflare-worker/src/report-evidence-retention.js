import { firestoreClient } from "./firestore.js";

// Only final, explicitly timestamped decisions start the 90-day clock.
// Pending, reopened, disputed or historic unverified reports are never
// guessed from creation timestamps.
export const REPORT_EVIDENCE_RETENTION_DAYS = 90;
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const RETRY_MS = 7 * 24 * 60 * 60 * 1000;

export const evidenceDeadline = (now = new Date()) =>
  new Date(now.getTime() + RETENTION_MS);

export function evidenceHoldActive(data = {}) {
  return data.evidenceHold === true ||
    data.legalHold === true ||
    data.investigationHold === true ||
    data.appealPending === true ||
    ["pending", "open", "under_review"].includes(
      String(data.appealStatus || "").trim().toLowerCase(),
    );
}

export function evidenceRetentionExpired(data = {}, nowMs = Date.now()) {
  const at = data.evidencePurgeAt instanceof Date
    ? data.evidencePurgeAt.getTime()
    : Date.parse(String(data.evidencePurgeAt || ""));
  return ["rejected", "actioned", "closed"].includes(
    String(data.status || "").trim()) &&
    Number.isFinite(at) && at <= nowMs &&
    !evidenceHoldActive(data);
}

// A single bounded point-operation. Transactional re-read keeps an
// appeal/hold from racing with a cleanup of the same document.
export async function purgeReportEvidenceDocument(db, collection, reportId,
  now = new Date()) {
  if (!["reports", "diary_reports"].includes(collection) ||
      !/^[A-Za-z0-9_-]{1,512}$/.test(String(reportId || ""))) {
    throw new Error("invalid_report_id");
  }
  const tx = await db.beginTransaction();
  try {
    const path = collection + "/" + reportId;
    const snap = await db.get(path, tx);
    if (!snap.exists || !snap.data?.evidencePurgeAt) {
      await db.rollback(tx);
      return "skipped";
    }
    const data = snap.data || {};
    if (["new", "open", "under_review"].includes(String(data.status || ""))) {
      await db.rollback(tx);
      return "skipped";
    }
    const due = data.evidencePurgeAt instanceof Date
      ? data.evidencePurgeAt.getTime()
      : Date.parse(String(data.evidencePurgeAt));
    if (!Number.isFinite(due) || due > now.getTime()) {
      await db.rollback(tx);
      return "skipped";
    }
    // The diary mirror in reports/ must never outlive its diary hold.
    let linkedDiaryHold = false;
    if (collection === "reports" &&
        ["diary", "diary_comment"].includes(String(data.targetType || ""))) {
      const diary = await db.get("diary_reports/" + reportId, tx);
      linkedDiaryHold = diary.exists && evidenceHoldActive(diary.data || {});
    }
    if (evidenceHoldActive(data) || linkedDiaryHold) {
      const patch = {
        evidencePurgeAt: new Date(now.getTime() + RETRY_MS),
        evidenceRetentionDeferredAt: now,
      };
      await db.commit(tx, [
        db.writeUpdate(path, patch, Object.keys(patch)),
        db.writeCreate("admin_audit_logs/report_evidence_hold_" +
          crypto.randomUUID(), {
          action: "deferReportEvidenceDeletion",
          reportId, collection, createdAt: now,
          reason: "active_appeal_investigation_or_legal_hold",
        }),
      ]);
      return "held";
    }
    const patch = {
      evidence: null,
      evidencePurgeAt: null,
      evidencePurgedAt: now,
    };
    await db.commit(tx, [
      db.writeUpdate(path, patch, Object.keys(patch)),
      db.writeCreate("admin_audit_logs/report_evidence_purge_" +
        crypto.randomUUID(), {
        action: "purgeReportEvidenceAfterRetention",
        reportId, collection, createdAt: now,
      }),
    ]);
    return "purged";
  } catch (error) {
    await db.rollback(tx);
    throw error;
  }
}

// Existing Worker cron invokes this once at a designated hourly boundary.
// No global scan, no listener; at most 20 due rows per source per hour.
// Explicit deadlines only: historical uncertain reports remain preserved.
export async function runDueReportEvidenceCleanup(env, {
  nowMs = Date.now(), limit = 20,
} = {}) {
  const db = firestoreClient(env);
  const now = new Date(nowMs);
  const bounded = Math.max(1, Math.min(20, Math.trunc(limit || 20)));
  const result = { checked: 0, purged: 0, held: 0, failed: 0 };
  for (const collection of ["reports", "diary_reports"]) {
    const rows = await db.runQuery(collection, {
      filters: [{ field: "evidencePurgeAt", op: "<=", value: now }],
      orderBy: [{ field: "evidencePurgeAt", direction: "asc" }],
      limit: bounded,
    });
    for (const row of rows) {
      result.checked++;
      try {
        const outcome = await purgeReportEvidenceDocument(
          db, collection, row.id, now);
        if (outcome === "purged") result.purged++;
        if (outcome === "held") result.held++;
      } catch (error) {
        result.failed++;
        console.error("Report evidence cleanup failed", collection,
          String(error?.code || error?.message || "failed").slice(0,90));
      }
    }
  }
  return result;
}

// Explicit owner-controlled preservation for investigation, appeal or
// legal necessity. Record every toggle, and mirror diary state atomically
// to the legacy general-report copy so no sweeper bypasses a hold.
export async function setReportEvidenceHold(db, {
  collection, reportId, actorUid, hold, reason, operationKey,
}) {
  if (!["reports", "diary_reports"].includes(collection) ||
      !/^[A-Za-z0-9_-]{1,512}$/.test(String(reportId || "")) ||
      !/^[A-Za-z0-9_-]{12,180}$/.test(String(operationKey || "")) ||
      typeof hold !== "boolean" ||
      String(reason || "").trim().length < 3 ||
      String(reason || "").trim().length > 200) {
    throw new Error("invalid_request");
  }
  const tx = await db.beginTransaction();
  try {
    const path = collection + "/" + reportId;
    const opPath = "control_operations/" + operationKey;
    const [snapshot, operation] = await Promise.all([
      db.get(path, tx), db.get(opPath, tx),
    ]);
    if (operation.exists) {
      if (operation.data?.action !== "setReportEvidenceHold" ||
          operation.data?.actorUid !== actorUid ||
          operation.data?.targetId !== reportId ||
          operation.data?.collection !== collection ||
          operation.data?.hold !== hold) {
        throw new Error("idempotency_key_conflict");
      }
      await db.rollback(tx);
      return { ok: true, code: "duplicate", hold };
    }
    if (!snapshot.exists) throw new Error("report_not_found");
    const current = snapshot.data || {};
    const patch = {
      evidenceHold: hold,
      evidenceHoldReason: String(reason).trim(),
      evidenceHoldChangedBy: actorUid,
      evidenceHoldChangedAt: new Date(),
      ...(!hold && current.evidenceRetentionDueAt
        ? { evidencePurgeAt: current.evidenceRetentionDueAt } : {}),
    };
    const writes = [db.writeUpdate(path, patch, Object.keys(patch))];
    if (collection === "diary_reports") {
      const mirror = await db.get("reports/" + reportId, tx);
      if (mirror.exists) {
        writes.push(db.writeUpdate("reports/" + reportId, patch,
          Object.keys(patch)));
      }
    }
    const now = new Date();
    writes.push(db.writeCreate("admin_audit_logs/report_evidence_hold_" +
      operationKey, {
      action: "setReportEvidenceHold", actorUid, reportId,
      collection, reason: String(reason).trim(),
      before: { hold: current.evidenceHold === true },
      after: { hold }, createdAt: now,
    }));
    writes.push(db.writeCreate(opPath, {
      action: "setReportEvidenceHold", actorUid,
      targetId: reportId, collection, hold,
      status: "completed", createdAt: now,
    }));
    await db.commit(tx, writes);
    return { ok: true, code: "ok", hold };
  } catch (error) {
    await db.rollback(tx);
    throw error;
  }
}
