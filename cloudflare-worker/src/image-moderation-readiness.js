// Read-only operator diagnostics for final U6 acceptance. This module must
// NEVER call an inference provider, read R2 bytes, make billable requests or
// turn on automatic publication. Binding presence != live provider health.
const clean = value => String(value ?? "").trim();

export function assessImageModerationReadiness({
  policy = {}, env = {}, providerConfigured = false,
  publicationGateReady = false,
} = {}) {
  const storage = env?.USER_STORAGE;
  const storageBound = typeof storage?.head === "function" &&
    typeof storage?.get === "function" &&
    typeof storage?.put === "function";
  const paid = clean(policy.mode) === "paid";
  const privateScope = clean(policy.scope) === "public_and_private";
  const checks = [
    {
      id: "publication_gate",
      status: publicationGateReady ? "configured" : "blocked",
    },
    {
      id: "storage_binding",
      status: storageBound ? "configured" : "missing",
    },
    {
      id: "provider_binding",
      status: providerConfigured ? "configured" : "missing",
    },
    {
      id: "provider_live_acceptance",
      status: "not_verified",
    },
    {
      id: "private_user_notice",
      status: privateScope ? "not_verified" : "not_required",
    },
    {
      id: "paid_billing_approval",
      status: paid ? "not_verified" : "not_required",
    },
  ];
  // This is an operational acceptance report, not permission to enable.
  // Live provider testing, private-message notice (when selected), and
  // operator sign-off are not automated or silently inferred from bindings.
  return {
    version: 1,
    activationStatus: "not_approved",
    automaticActivationAllowed: false,
    configuredScope: privateScope ? "public_and_private" : "public",
    selectedMode: paid ? "paid" : "free",
    checks,
    capabilities: {
      manualReviewStorageBound: storageBound,
      providerBindingPresent: providerConfigured === true,
    },
    liveProviderTestPerformed: false,
    billableRequestMade: false,
  };
}
