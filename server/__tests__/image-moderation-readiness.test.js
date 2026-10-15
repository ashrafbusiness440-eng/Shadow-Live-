import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { assessImageModerationReadiness } from
  "../../cloudflare-worker/src/image-moderation-readiness.js";
import { imageModerationProviderReady } from
  "../../cloudflare-worker/src/image-moderation-policy.js";
import { IMAGE_MODERATION_PUBLICATION_GATE_READY } from
  "../../cloudflare-worker/src/image-moderation-control.js";
import { uploadModerationSnapshot } from
  "../../cloudflare-worker/src/image-moderation-gate.js";

const policy = {
  enabled: false, scope: "public", mode: "free",
  provider: "cloudflare_vision", dailyLimit: 20,
};
const status = (report, id) =>
  report.checks.find(check => check.id === id)?.status;

test("U6-L5/A owner readiness cannot turn on scanning and defaults fail closed", () => {
  const result = assessImageModerationReadiness({ policy });
  assert.equal(IMAGE_MODERATION_PUBLICATION_GATE_READY, false);
  assert.equal(result.activationStatus, "not_approved");
  assert.equal(result.automaticActivationAllowed, false);
  assert.equal(result.liveProviderTestPerformed, false);
  assert.equal(result.billableRequestMade, false);
  assert.equal(status(result, "publication_gate"), "blocked");
  assert.equal(status(result, "storage_binding"), "missing");
  assert.equal(status(result, "provider_binding"), "missing");
  assert.equal(status(result, "provider_live_acceptance"), "not_verified");
  assert.equal(status(result, "private_user_notice"), "not_required");
  assert.equal(status(result, "paid_billing_approval"), "not_required");
  assert.equal(result.checks.length, 6);
});
test("U6-L5/A bound R2 and AI do not imply successful live provider tests", () => {
  let calls = 0;
  const env = {
    USER_STORAGE: {
      head: async () => { calls++; },
      get: async () => { calls++; },
      put: async () => { calls++; },
    },
    AI: { run: async () => { calls++; return {response: "SAFE"}; } },
  };
  const configured = imageModerationProviderReady(env, policy.provider);
  const report = assessImageModerationReadiness({
    policy, env, providerConfigured: configured,
    publicationGateReady: false,
  });
  assert.equal(configured, true);
  assert.equal(status(report, "storage_binding"), "configured");
  assert.equal(status(report, "provider_binding"), "configured");
  assert.equal(status(report, "provider_live_acceptance"), "not_verified");
  assert.equal(report.automaticActivationAllowed, false);
  assert.equal(calls, 0);
});
test("U6-L5/A private scope and paid service are never silently accepted", () => {
  let paidCalls = 0;
  const secret = "secret_key_should_never_return_abcdefgh";
  const env = {
    USER_STORAGE: {get(){paidCalls++},head(){paidCalls++},put(){paidCalls++}},
    GOOGLE_VISION_API_KEY: secret,
  };
  const paidPolicy = {
    ...policy, scope: "public_and_private",
    mode: "paid", provider: "google_safesearch",
  };
  const report = assessImageModerationReadiness({
    policy: paidPolicy, env,
    providerConfigured: imageModerationProviderReady(env, "google_safesearch"),
    publicationGateReady: false,
  });
  assert.equal(status(report, "private_user_notice"), "not_verified");
  assert.equal(status(report, "paid_billing_approval"), "not_verified");
  assert.equal(report.selectedMode, "paid");
  assert.equal(report.automaticActivationAllowed, false);
  assert.equal(paidCalls, 0);
  assert.equal(JSON.stringify(report).includes(secret), false);
});
test("U6-L5/A diagnostics only appear after owner read authorization", () => {
  const backend = fs.readFileSync(
    "cloudflare-worker/src/image-moderation-control.js", "utf8");
  const screen = fs.readFileSync(
    "lib/admin/image_moderation_settings_page.dart", "utf8");
  assert.ok(backend.indexOf('clean(user.data?.role) !== "owner"') <
    backend.indexOf('action === "read"'));
  assert.match(backend, /assessImageModerationReadiness/);
  assert.match(backend, /publicationGateReady: IMAGE_MODERATION_PUBLICATION_GATE_READY/);
  assert.match(screen, /فحص الجاهزية قبل تشغيل الحماية/);
  assert.match(screen, /الفحص الآلي ما زال معطّلًا/);
  assert.match(screen, /_readinessChecks/);
  assert.match(screen, /canEnable = _gateReady/);
  assert.ok(!screen.includes("لحين اكتمال ربط النشر الآمن"));
});

test("U6-L5/B stale enabled config cannot authorize public/private scans", async () => {
  const calls = { get: 0, ai: 0, r2: 0, writes: 0 };
  const db = {
    async get(path) {
      calls.get++;
      assert.equal(path, "system_config/image_moderation");
      return { exists: true, data: {
        ...policy, enabled: true, scope: "public_and_private",
      } };
    },
    async commit() { calls.writes++; },
  };
  const env = {
    AI: { run: async () => { calls.ai++; return {response:"SAFE"}; } },
    USER_STORAGE: {
      get: async () => { calls.r2++; },
      head: async () => { calls.r2++; },
      put: async () => { calls.r2++; },
    },
  };
  assert.equal(IMAGE_MODERATION_PUBLICATION_GATE_READY, false);
  assert.equal(imageModerationProviderReady(env, "cloudflare_vision"), true);
  await assert.rejects(
    uploadModerationSnapshot(db, "profile_image"),
    /publication_gate_not_ready/,
  );
  await assert.rejects(
    uploadModerationSnapshot(db, "chat_image"),
    /publication_gate_not_ready/,
  );
  // These paths are deliberately outside the configured moderation scope.
  assert.equal(await uploadModerationSnapshot(db, "unknown_scope"), null);
  assert.equal(calls.get, 3);
  assert.equal(calls.ai, 0);
  assert.equal(calls.r2, 0);
  assert.equal(calls.writes, 0);
});

test("U6-L5/B an old cached SAFE upload receipt cannot bypass the OFF gate", () => {
  const source = fs.readFileSync("cloudflare-worker/src/user-storage.js","utf8");
  const policySource = fs.readFileSync(
    "cloudflare-worker/src/image-moderation-policy.js","utf8");
  const control = fs.readFileSync(
    "cloudflare-worker/src/image-moderation-control.js","utf8");
  assert.match(policySource,/IMAGE_MODERATION_PUBLICATION_GATE_READY = false/);
  assert.match(control,/export \{ IMAGE_MODERATION_PUBLICATION_GATE_READY \}/);
  assert.match(source,/moderationDecision = !IMAGE_MODERATION_PUBLICATION_GATE_READY/);
  assert.match(source,/status: "needs_review", reason: "publication_gate_not_ready"/);
  assert.match(source,/ticket\.moderationDecision \|\|/);
  assert.match(source,/if \(moderationDecision\.status !== "approved"\)/);
  assert.match(source,/throw new StorageApiError\("publication_gate_not_ready", 409\)/);
  assert.match(source,/moderationStatus: status, publicationPending: true/);
});
