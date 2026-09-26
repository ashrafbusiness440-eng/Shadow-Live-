import assert from "node:assert/strict";
import test from "node:test";

import {
  FIRESTORE_RETRY_BASE_DELAY_MS,
  FIRESTORE_QUOTA_BREAKER_MS,
  FIRESTORE_QUOTA_BREAKER_THRESHOLD,
  FIRESTORE_QUOTA_MAX_ATTEMPTS,
  FIRESTORE_QUOTA_MIN_RETRY_DELAY_MS,
  FIRESTORE_RETRY_JITTER_MS,
  FIRESTORE_RETRY_MAX_DELAY_MS,
  FIRESTORE_TRANSIENT_MAX_ATTEMPTS,
  createFirestoreQuotaCircuitState,
  firestoreRetryDelayMs,
  isFirestoreQuotaCircuitOpen,
  isFirestoreQuotaStatus,
  isTransientFirestoreError,
  isTransientFirestoreStatus,
  registerFirestoreQuotaFailure,
  resetFirestoreQuotaCircuit,
} from "../../cloudflare-worker/src/firestore.js";
import { firestoreQuotaResponse } from "../../cloudflare-worker/src/http.js";
import { shouldRetryLegacyTransaction } from "../../cloudflare-worker/src/legacy-firebase-admin-shim.js";

test("Firestore transient retry cap stays small", () => {
  assert.equal(FIRESTORE_TRANSIENT_MAX_ATTEMPTS, 3);
});

test("Firestore quota retries and breaker stay bounded", () => {
  assert.equal(FIRESTORE_QUOTA_MAX_ATTEMPTS, 2);
  assert.equal(FIRESTORE_QUOTA_MIN_RETRY_DELAY_MS, 1000);
  assert.equal(FIRESTORE_QUOTA_BREAKER_THRESHOLD, 2);
  assert.equal(FIRESTORE_QUOTA_BREAKER_MS, 10000);

  const state = createFirestoreQuotaCircuitState();
  const nowMs = 5000;
  registerFirestoreQuotaFailure(state, nowMs);
  assert.equal(isFirestoreQuotaCircuitOpen(state, nowMs), false);

  registerFirestoreQuotaFailure(state, nowMs);
  assert.equal(isFirestoreQuotaCircuitOpen(state, nowMs), true);
  assert.equal(state.openUntilMs, nowMs + FIRESTORE_QUOTA_BREAKER_MS);

  resetFirestoreQuotaCircuit(state);
  assert.deepEqual(state, { failures: 0, openUntilMs: 0 });
});

test("Firestore quota detection recognizes HTTP and status payloads", () => {
  assert.equal(isFirestoreQuotaStatus(429, {}), true);
  assert.equal(
    isFirestoreQuotaStatus(400, {
      error: { status: "RESOURCE_EXHAUSTED" },
    }),
    true,
  );
  assert.equal(
    isFirestoreQuotaStatus(400, {
      error: { message: "8 RESOURCE_EXHAUSTED: quota exceeded" },
    }),
    true,
  );
  assert.equal(isFirestoreQuotaStatus(403, {}), false);
});

test("HTTP quota response is explicit and retryable", async () => {
  const error = Object.assign(new Error("firestore_quota_exhausted"), {
    code: "firestore_quota_exhausted",
    status: 503,
    retryAfterSeconds: 10,
  });
  const response = firestoreQuotaResponse(
    new Request("https://example.test/api"),
    {},
    error,
  );
  assert.ok(response);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("retry-after"), "10");
  const body = await response.json();
  assert.equal(body.code, "firestore_quota_exhausted");
  assert.equal(body.retryAfterSeconds, 10);
});

test("Firestore transient status detection covers quota and availability", () => {
  assert.equal(isTransientFirestoreStatus(429, {}), true);
  assert.equal(isTransientFirestoreStatus(503, {}), true);
  assert.equal(
    isTransientFirestoreStatus(400, { error: { status: "RESOURCE_EXHAUSTED" } }),
    true,
  );
  assert.equal(
    isTransientFirestoreStatus(400, { error: { status: "UNAVAILABLE" } }),
    true,
  );
  assert.equal(isTransientFirestoreStatus(403, {}), false);
});

test("Firestore backoff uses exponential delay plus bounded jitter", () => {
  const first = firestoreRetryDelayMs(null, 0, { randomImpl: () => 0.5 });
  const second = firestoreRetryDelayMs(null, 1, { randomImpl: () => 0.5 });

  assert.equal(FIRESTORE_RETRY_BASE_DELAY_MS, 350);
  assert.equal(FIRESTORE_RETRY_JITTER_MS, 250);
  assert.ok(first >= 350 && first <= 600);
  assert.ok(second >= 700 && second <= 950);
  assert.ok(second > first);
});

test("Firestore Retry-After is honored but bounded", () => {
  const response = new Response("{}", {
    status: 429,
    headers: { "retry-after": "9" },
  });
  assert.equal(
    firestoreRetryDelayMs(response, 0, { randomImpl: () => 0 }),
    FIRESTORE_RETRY_MAX_DELAY_MS,
  );
});

test("Legacy transaction retries fail fast once quota breaker is explicit", () => {
  assert.equal(
    shouldRetryLegacyTransaction(
      Object.assign(new Error("firestore_quota_exhausted"), {
        code: "firestore_quota_exhausted",
        status: 503,
      }),
      0,
      3,
    ),
    false,
  );
  assert.equal(shouldRetryLegacyTransaction(new Error("UNAVAILABLE"), 0, 3), true);
  assert.equal(shouldRetryLegacyTransaction(new Error("UNAVAILABLE"), 2, 3), false);
});

test("Firestore transient error detection supports transaction retries", () => {
  assert.equal(isTransientFirestoreError(new Error("RESOURCE_EXHAUSTED")), true);
  assert.equal(isTransientFirestoreError(new Error("firestore_quota_exhausted")), true);
  assert.equal(isTransientFirestoreError(new Error("UNAVAILABLE")), true);
  assert.equal(isTransientFirestoreError(Object.assign(new Error("x"), { status: 409 })), true);
  assert.equal(isTransientFirestoreError(Object.assign(new Error("x"), { status: 403 })), false);
});
