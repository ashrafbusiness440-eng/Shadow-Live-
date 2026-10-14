// Prevent repeated submissions of the same room or conversation complaint.
// The existing per-reporter rate-limit document owns this bounded history;
// no new document reads, scans, timers, background jobs or auto-sanctions.
export const REPORT_DUPLICATE_WINDOW_MS = 10 * 60_000;
const MAX_RECENT_KEYS = 12;

export function checkReportDuplicateWindow(rate = {}, signature, nowMs = Date.now()) {
  const key = String(signature || "");
  if (!key || key.length > 600 || !Number.isFinite(nowMs) || nowMs <= 0) {
    throw new Error("invalid_report_dedup_input");
  }
  const seen = new Set();
  const recent = [];
  const source = Array.isArray(rate.recentReportKeys)
    ? rate.recentReportKeys.slice(-MAX_RECENT_KEYS)
    : [];
  for (const raw of source) {
    const candidate = String(raw?.key || "");
    const atMs = Number(raw?.atMs);
    if (!candidate || candidate.length > 600 ||
        !Number.isFinite(atMs) ||
        atMs > nowMs || nowMs - atMs >= REPORT_DUPLICATE_WINDOW_MS ||
        seen.has(candidate)) continue;
    recent.push({ key: candidate, atMs });
    seen.add(candidate);
  }
  if (seen.has(key)) {
    return { duplicate: true, recent };
  }
  return {
    duplicate: false,
    recent: [...recent, { key, atMs: nowMs }].slice(-MAX_RECENT_KEYS),
  };
}

export function reportDuplicateSignature(type, targetId, scope, reason) {
  const values = [type, targetId, scope, reason].map((part) =>
    String(part || "").trim());
  if (values.some((part) => !part || part.length > 180)) {
    throw new Error("invalid_report_dedup_signature");
  }
  return JSON.stringify(values);
}
