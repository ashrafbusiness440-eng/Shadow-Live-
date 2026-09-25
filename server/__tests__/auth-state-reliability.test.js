import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTH_STATE_MAX_ATTEMPTS,
  authStateRetryDelayMs,
  fetchAuthStateResponse,
  isTransientAuthStateStatus,
} from "../../cloudflare-worker/src/auth-state-reliability.js";
import {
  assertUserDocumentSessionState,
} from "../../cloudflare-worker/src/firebase-auth.js";

function response(status, retryAfter = null) {
  return new Response("{}", {
    status,
    headers: retryAfter === null ? {} : { "retry-after": retryAfter },
  });
}

test("auth-state retry policy treats only 429 and 5xx as transient", () => {
  assert.equal(isTransientAuthStateStatus(429), true);
  assert.equal(isTransientAuthStateStatus(500), true);
  assert.equal(isTransientAuthStateStatus(503), true);
  assert.equal(isTransientAuthStateStatus(404), false);
  assert.equal(isTransientAuthStateStatus(403), false);
});

test("auth-state retries are capped at three attempts with jittered backoff", async () => {
  const statuses = [429, 500, 200];
  const sleeps = [];
  let calls = 0;
  const result = await fetchAuthStateResponse("https://example.test/user", "token", {
    fetchImpl: async () => response(statuses[calls++]),
    sleepImpl: async (ms) => sleeps.push(ms),
    randomImpl: () => 0.5,
  });

  assert.equal(AUTH_STATE_MAX_ATTEMPTS, 3);
  assert.equal(calls, 3);
  assert.equal(result.response.status, 200);
  assert.equal(sleeps.length, 2);
  assert.ok(sleeps[0] >= 350 && sleeps[0] <= 570);
  assert.ok(sleeps[1] >= 700 && sleeps[1] <= 920);
});

test("auth-state retry honors bounded Retry-After", () => {
  const delay = authStateRetryDelayMs(response(429, "9"), 0, {
    randomImpl: () => 0,
    nowMs: 0,
  });
  assert.equal(delay, 2500);
});

test("auth-state hard failures do not multiply reads", async () => {
  let calls = 0;
  const result = await fetchAuthStateResponse("https://example.test/user", "token", {
    fetchImpl: async () => {
      calls += 1;
      return response(403);
    },
    sleepImpl: async () => {
      throw new Error("sleep should not run");
    },
  });

  assert.equal(calls, 1);
  assert.equal(result.response.status, 403);
});

test("auth-state network failures stop at the retry cap", async () => {
  let calls = 0;
  const sleeps = [];
  const result = await fetchAuthStateResponse("https://example.test/user", "token", {
    fetchImpl: async () => {
      calls += 1;
      throw new Error("network");
    },
    sleepImpl: async (ms) => sleeps.push(ms),
    randomImpl: () => 0,
  });

  assert.equal(calls, 3);
  assert.equal(sleeps.length, 2);
  assert.equal(result.response, null);
  assert.equal(result.error.message, "network");
});

test("user document session state accepts active non-revoked users", () => {
  assert.equal(
    assertUserDocumentSessionState(
      { iat: 100 },
      { accountStatus: "active" },
    ),
    true,
  );
});

test("user document session state rejects suspended accounts", () => {
  assert.throws(
    () =>
      assertUserDocumentSessionState(
        { iat: 100 },
        { accountStatus: "suspended" },
      ),
    /unauthorized/,
  );
});

test("user document session state rejects tokens issued before revocation", () => {
  assert.throws(
    () =>
      assertUserDocumentSessionState(
        { iat: 100 },
        { accountStatus: "active", sessionsRevokedAt: "1970-01-01T00:01:41.000Z" },
      ),
    /unauthorized/,
  );
});

test("user document session state accepts tokens issued after revocation", () => {
  assert.equal(
    assertUserDocumentSessionState(
      { iat: 102 },
      { accountStatus: "active", sessionsRevokedAt: "1970-01-01T00:01:41.000Z" },
    ),
    true,
  );
});
