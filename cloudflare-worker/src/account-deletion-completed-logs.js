// Owner-only read projection. Receipt documents are authored exclusively by a
// future verified finalizer; neither requests nor checkpoints prove erasure.
// Keep this bounded and deliberately omit target UID, profile data and evidence.
const clean = value => String(value ?? "").trim();
const allowedFinancial = new Set(["settled", "retained_under_policy", "not_applicable"]);
const allowedEvidence = new Set(["none", "retained_under_policy", "expired"]);
const allowedExecutor = new Set(["system", "owner"]);
const retainedKinds = new Set(["financial_audit", "moderation_evidence", "legal_hold"]);

const safeTime = value => {
  const time = typeof value?.toDate === "function" ? value.toDate()
    : value instanceof Date ? value : new Date(clean(value));
  return Number.isFinite(time.getTime()) ? time.toISOString() : null;
};

export async function listCompletedAccountDeletionLogs(db, { limit = 20 } = {}) {
  const pageSize = Number.isSafeInteger(limit) && limit >= 1
    ? Math.min(limit, 20) : 20;
  // One explicit owner click, at most 21 indexed rows; no broad scans.
  const rows = await db.runQuery("account_deletion_erasure_receipts", {
    orderBy: [{ field: "completedAt", direction: "desc" }],
    limit: pageSize + 1,
  });
  if (!Array.isArray(rows)) throw Error("invalid_deletion_log_results");
  const items = rows.slice(0, pageSize).flatMap(row => {
    const d = row.data || {};
    // A preflight checkpoint, request status, or partial cleanup does not count.
    if (d.status !== "completed" || d.erasureVerified !== true ||
        !/^[A-Za-z0-9_-]{12,180}$/.test(clean(d.requestId))) return [];
    const financialStatus = clean(d.financialStatus);
    const evidenceStatus = clean(d.evidenceStatus);
    const executor = clean(d.executorKind);
    return [{
      operationId: clean(d.requestId),
      requestedAt: safeTime(d.requestedAt),
      completedAt: safeTime(d.completedAt),
      executor: allowedExecutor.has(executor) ? executor : "not_recorded",
      financialStatus: allowedFinancial.has(financialStatus)
        ? financialStatus : "not_recorded",
      evidenceStatus: allowedEvidence.has(evidenceStatus)
        ? evidenceStatus : "not_recorded",
      retentionCategories: Array.isArray(d.retentionCategories)
        ? [...new Set(d.retentionCategories.filter(value =>
            retainedKinds.has(value)))].slice(0, 3)
        : [],
    }];
  });
  return { ok: true, items, capped: rows.length > pageSize };
}
