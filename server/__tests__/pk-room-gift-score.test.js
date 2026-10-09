import assert from "node:assert/strict";
import test from "node:test";
import { pkGiftScoreTwice, pkRoundDecision } from "../../cloudflare-worker/src/pk-gift-scoring.js";

test("PK first paid gift scores exact x10.5 and next scores x10", () => {
  assert.equal(pkGiftScoreTwice(100, true), 2100);
  assert.equal(pkGiftScoreTwice(100, false), 2000);
  assert.equal(pkGiftScoreTwice(1, true), 21); // 10.5 points
  assert.equal(pkGiftScoreTwice(1, false), 20); // 10 points
});
test("PK excludes non-paid values and rejects overflow", () => {
  assert.equal(pkGiftScoreTwice(0, true), null);
  assert.equal(pkGiftScoreTwice(-1, true), null);
  assert.equal(pkGiftScoreTwice(1.5, true), null);
  assert.equal(pkGiftScoreTwice(Number.MAX_SAFE_INTEGER, true), null);
});

test("PK overtime occurs only on the first tied expiry", () => {
  assert.deepEqual(pkRoundDecision(100, 100, false),
    { overtime: true, winner: "" });
  assert.deepEqual(pkRoundDecision(100, 100, true),
    { overtime: false, winner: "draw" });
});

test("PK winner is based on actual team totals, including halves", () => {
  assert.deepEqual(pkRoundDecision(10.5, 10, false),
    { overtime: false, winner: "a" });
  assert.deepEqual(pkRoundDecision(0, 12, true),
    { overtime: false, winner: "b" });
  assert.equal(pkRoundDecision(Number.NaN, 3), null);
});
