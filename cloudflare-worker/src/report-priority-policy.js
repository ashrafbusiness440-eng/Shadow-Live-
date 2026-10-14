// Deterministic, non-punitive triage from the verified report source fields.
// An administrator may override this classification with an audited decision.
const LEVELS = Object.freeze({ urgent: 0, high: 1, normal: 2 });
const URGENT_REASONS = new Set(["scam", "hate", "violence", "threat"]);
const HIGH_REASONS = new Set([
  "harassment", "abuse", "abusive_content", "inappropriate_content", "sexual",
]);

export function validReportPriority(value) {
  return Object.hasOwn(LEVELS, String(value || ""));
}

export function reportPriority(type = "", reason = "", override = "") {
  const manual = String(override || "");
  if (validReportPriority(manual)) return manual;
  const category = String(reason || "").trim().toLowerCase();
  if (URGENT_REASONS.has(category)) return "urgent";
  if (HIGH_REASONS.has(category)) return "high";
  // Unknown or other reasons require a human review, not a presumption.
  return "normal";
}

export function reportPriorityRank(priority) {
  return Object.hasOwn(LEVELS, priority) ? LEVELS[priority] : LEVELS.normal;
}
