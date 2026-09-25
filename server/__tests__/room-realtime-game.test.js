import assert from "node:assert/strict";
import test from "node:test";

import {
  gameScheduleStorageKey,
  normalizeGameSchedule,
  processGameSchedule,
} from "../../cloudflare-worker/src/room-realtime-game.js";

function schedule(overrides = {}) {
  return {
    roomId: "room_1",
    round: {
      gameId: "greedy_cat",
      mode: "",
      roundId: "greedy_cat:2026-09-25:10",
      dayKey: "2026-09-25",
      roundNumber: 10,
      opensAtMs: 1000,
      bettingClosesAtMs: 28000,
      revealAtMs: 31000,
      resultHoldEndsAtMs: 35000,
      nextRoundOpensAtMs: 35000,
    },
    outcomeId: "fish15",
    nextRound: {
      gameId: "greedy_cat",
      mode: "",
      roundId: "greedy_cat:2026-09-25:11",
      dayKey: "2026-09-25",
      roundNumber: 11,
      opensAtMs: 35000,
      bettingClosesAtMs: 62000,
      revealAtMs: 65000,
      resultHoldEndsAtMs: 69000,
      nextRoundOpensAtMs: 69000,
    },
    ...overrides,
  };
}

test("game schedule never exposes outcome before reveal", () => {
  const normalized = normalizeGameSchedule(schedule(), 2000);
  assert.ok(normalized);

  const bettingClose = processGameSchedule(normalized, 28000);
  assert.deepEqual(
    bettingClose.events.map((event) => event.type),
    ["game.betting_closed"],
  );
  assert.equal(
    JSON.stringify(bettingClose.events).includes("fish15"),
    false,
  );

  const result = processGameSchedule(bettingClose.schedule, 31000);
  assert.deepEqual(
    result.events.map((event) => event.type),
    ["game.result"],
  );
  assert.equal(result.events[0].payload.outcomeId, "fish15");
});

test("next round event carries the next server schedule", () => {
  const normalized = normalizeGameSchedule(schedule(), 2000);
  const afterBetting = processGameSchedule(normalized, 28000);
  const afterResult = processGameSchedule(afterBetting.schedule, 31000);
  const nextRound = processGameSchedule(afterResult.schedule, 35000);

  assert.deepEqual(
    nextRound.events.map((event) => event.type),
    ["game.next_round"],
  );
  assert.equal(
    nextRound.events[0].payload.nextRound.roundId,
    "greedy_cat:2026-09-25:11",
  );
  assert.equal(nextRound.complete, true);
});

test("future round emits round_started at its open time", () => {
  const future = schedule({
    round: schedule().nextRound,
    outcomeId: "steak25",
    nextRound: {
      ...schedule().nextRound,
      roundId: "greedy_cat:2026-09-25:12",
      roundNumber: 12,
      opensAtMs: 69000,
      bettingClosesAtMs: 96000,
      revealAtMs: 99000,
      resultHoldEndsAtMs: 103000,
      nextRoundOpensAtMs: 103000,
    },
  });
  const normalized = normalizeGameSchedule(future, 34000);
  const opened = processGameSchedule(normalized, 35000);
  assert.deepEqual(
    opened.events.map((event) => event.type),
    ["game.round_started"],
  );
  assert.equal(opened.events[0].payload.round.status, "betting");
});

test("re-registering a schedule preserves already sent phases", () => {
  const normalized = normalizeGameSchedule(schedule(), 2000);
  const afterBetting = processGameSchedule(normalized, 28000);
  const refreshed = normalizeGameSchedule(
    schedule(),
    28500,
    afterBetting.schedule,
  );
  const duplicateCheck = processGameSchedule(refreshed, 29000);
  assert.deepEqual(duplicateCheck.events, []);
});

test("schedule keys are deterministic per game mode and round", () => {
  const normalized = normalizeGameSchedule(schedule(), 2000);
  assert.equal(
    gameScheduleStorageKey(normalized),
    "game_schedule:greedy_cat::greedy_cat%3A2026-09-25%3A10",
  );
});

test("slot is not accepted as a collective websocket schedule", () => {
  const invalid = normalizeGameSchedule(
    schedule({
      round: {
        ...schedule().round,
        gameId: "slot",
        roundId: "slot:user:key",
      },
    }),
    2000,
  );
  assert.equal(invalid, null);
});
