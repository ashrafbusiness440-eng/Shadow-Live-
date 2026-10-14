// Shared, bounded administrative evidence read for general and diary reports.
// Callers MUST validate the report ID and enforce separate evidence permission
// before calling. An audit write must succeed before returning any content.
export async function readProtectedReportEvidence(db, {
  collection, reportId, actorUid,
}) {
  if (!["reports", "diary_reports"].includes(collection) ||
      !reportId || reportId.includes("/") || reportId.includes("\\")) {
    throw new Error("invalid_report_id");
  }
  const snapshot = await db.get(collection + "/" + reportId);
  if (!snapshot.exists) {
    const error = new Error("report_not_found");
    error.status = 404;
    throw error;
  }
  const source = snapshot.data || {};
  const raw = source.evidence;
  // Do not record the content itself in the access log.
  await db.commit(null, [db.writeCreate(
    "admin_audit_logs/report_evidence_open_" + crypto.randomUUID(), {
      action: "openSensitiveReportEvidence",
      actorUid,
      targetType: "report",
      targetId: reportId,
      reportId,
      sourceCollection: collection,
      createdAt: new Date(),
    },
  )]);
  return {
    ok: true,
    reportId,
    evidence: raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {},
  };
}
