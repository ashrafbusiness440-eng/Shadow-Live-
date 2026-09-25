import assert from "node:assert/strict";
import test from "node:test";

import {
  firestoreE2eFetch,
  sleep,
} from "../../cloudflare-worker/scripts/firestore-e2e-retry.mjs";

test("E2E Firestore helper retries 429 with pacing and backoff", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls < 3) {
      return new Response("{}", { status: 429 });
    }
    return new Response("{}", { status: 200 });
  };

  try {
    const response = await firestoreE2eFetch(
      "https://example.test/firestore",
      {},
      { paceMs: 0, maxAttempts: 3 },
    );
    assert.equal(response.status, 200);
    assert.equal(calls, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("E2E Firestore helper does not retry permanent 403", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response("{}", { status: 403 });
  };

  try {
    const response = await firestoreE2eFetch(
      "https://example.test/firestore",
      {},
      { paceMs: 0, maxAttempts: 4 },
    );
    assert.equal(response.status, 403);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("E2E sleep accepts zero", async () => {
  await sleep(0);
  assert.ok(true);
});
