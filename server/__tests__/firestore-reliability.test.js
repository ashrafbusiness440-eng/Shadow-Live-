import assert from "node:assert/strict";
import test from "node:test";

import {
  FIRESTORE_RETRY_BASE_DELAY_MS,
  FIRESTORE_RETRY_JITTER_MS,
  FIRESTORE_RETRY_MAX_DELAY_MS,
  FIRESTORE_TRANSIENT_MAX_ATTEMPTS,
  firestoreRetryDelayMs,
  isTransientFirestoreError,
  isTransientFirestoreStatus,
} from "../../cloudflare-worker/src/firestore.js";

test("Firestore transient retry cap stays small", () => {
  assert.equal(FIRESTORE_TRANSIENT_MAX_ATTEMPTS, 3);
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

test("Firestore transient error detection supports transaction retries", () => {
  assert.equal(isTransientFirestoreError(new Error("RESOURCE_EXHAUSTED")), true);
  assert.equal(isTransientFirestoreError(new Error("UNAVAILABLE")), true);
  assert.equal(isTransientFirestoreError(Object.assign(new Error("x"), { status: 409 })), true);
  assert.equal(isTransientFirestoreError(Object.assign(new Error("x"), { status: 403 })), false);
});
