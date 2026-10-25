// Shared fail-closed hold check for internal account erasure stages.
// Recheck inside the same Firestore transaction as each proposed data write.
// This module does not grant erasure authorization or access to user data.
const clean = value => String(value ?? "").trim();

export function accountDeletionHasActiveHold(data) {
  return [
    data?.reviewHold, data?.legalHold, data?.retentionHold,
    data?.deletionHold, data?.evidenceHold, data?.investigationHold,
    data?.reported, data?.appealPending,
  ].some(value => value === true) ||
    ["pending", "open", "under_review"].includes(
      clean(data?.appealStatus).toLowerCase());
}
