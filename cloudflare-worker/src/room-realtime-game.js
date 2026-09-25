function clean(value) {
  return String(value || "").trim();
}

function finiteMs(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : 0;
}

function validGame(gameId, mode) {
  if (gameId === "greedy_cat") return mode === "";
  if (gameId === "witch") return mode === "normal" || mode === "advanced";
  return false;
}

export const GAME_SCHEDULE_PREFIX = "game_schedule:";

export function normalizeGameRound(raw = {}) {
  const roundId = clean(raw.roundId);
  const gameId = clean(raw.gameId);
  const mode = gameId === "witch" ? clean(raw.mode) : "";
  const opensAtMs = finiteMs(raw.opensAtMs);
  const bettingClosesAtMs = finiteMs(raw.bettingClosesAtMs);
  const revealAtMs = finiteMs(raw.revealAtMs || raw.closesAtMs);
  const resultHoldEndsAtMs = finiteMs(raw.resultHoldEndsAtMs);
  const nextRoundOpensAtMs = finiteMs(
    raw.nextRoundOpensAtMs || resultHoldEndsAtMs,
  );
  if (
    !roundId ||
    !validGame(gameId, mode) ||
    opensAtMs <= 0 ||
    bettingClosesAtMs < opensAtMs ||
    revealAtMs < bettingClosesAtMs ||
    resultHoldEndsAtMs < revealAtMs ||
    nextRoundOpensAtMs < resultHoldEndsAtMs
  ) {
    return null;
  }

  return {
    roundId,
    gameId,
    mode,
    dayKey: clean(raw.dayKey),
    roundNumber: Math.max(0, Number(raw.roundNumber || 0)),
    opensAtMs,
    closesAtMs: revealAtMs,
    bettingClosesAtMs,
    revealAtMs,
    resultHoldEndsAtMs,
    nextRoundOpensAtMs,
    locked: false,
    status: "betting",
  };
}

export function gameScheduleStorageKey(schedule) {
  const round = schedule?.round || {};
  return [
    GAME_SCHEDULE_PREFIX,
    encodeURIComponent(clean(round.gameId)),
    ":",
    encodeURIComponent(clean(round.mode)),
    ":",
    encodeURIComponent(clean(round.roundId)),
  ].join("");
}

export function normalizeGameSchedule(raw = {}, nowMs = Date.now(), existing = null) {
  const roomId = clean(raw.roomId);
  const round = normalizeGameRound(raw.round);
  const nextRound = normalizeGameRound(raw.nextRound);
  const outcomeId = clean(raw.outcomeId);
  if (!roomId || !round || !outcomeId) return null;

  const previous =
    existing && typeof existing === "object" ? existing : {};
  const previousSent =
    previous.sent && typeof previous.sent === "object" ? previous.sent : {};
  const sent = {
    roundStarted:
      previousSent.roundStarted === true || Number(nowMs) >= round.opensAtMs,
    bettingClosed:
      previousSent.bettingClosed === true ||
      Number(nowMs) >= round.bettingClosesAtMs,
    result:
      previousSent.result === true || Number(nowMs) >= round.revealAtMs,
    nextRound:
      previousSent.nextRound === true ||
      Number(nowMs) >= round.nextRoundOpensAtMs,
  };

  return {
    roomId,
    round,
    nextRound,
    outcomeId,
    sent,
    registeredAtMs: Number(nowMs),
    updatedAtMs: Number(nowMs),
  };
}

function eventPayload(schedule, round, extra = {}) {
  return {
    roomId: schedule.roomId,
    gameId: round.gameId,
    mode: round.mode,
    roundId: round.roundId,
    roundNumber: round.roundNumber,
    dayKey: round.dayKey,
    round,
    ...extra,
  };
}

export function processGameSchedule(schedule, nowMs = Date.now()) {
  if (!schedule?.round || !schedule?.sent) {
    return { schedule, events: [], complete: true, nextAtMs: null };
  }

  const next = {
    ...schedule,
    sent: { ...schedule.sent },
    updatedAtMs: Number(nowMs),
  };
  const events = [];
  const round = next.round;

  if (!next.sent.roundStarted && nowMs >= round.opensAtMs) {
    next.sent.roundStarted = true;
    events.push({
      type: "game.round_started",
      payload: eventPayload(next, {
        ...round,
        status: "betting",
        locked: false,
      }),
    });
  }

  if (!next.sent.bettingClosed && nowMs >= round.bettingClosesAtMs) {
    next.sent.bettingClosed = true;
    events.push({
      type: "game.betting_closed",
      payload: eventPayload(next, {
        ...round,
        status: "spinning",
        locked: true,
      }),
    });
  }

  if (!next.sent.result && nowMs >= round.revealAtMs) {
    next.sent.result = true;
    events.push({
      type: "game.result",
      payload: eventPayload(
        next,
        {
          ...round,
          status: "result_hold",
          locked: true,
        },
        {
          outcomeId: next.outcomeId,
          closedAtMs: round.revealAtMs,
        },
      ),
    });
  }

  if (!next.sent.nextRound && nowMs >= round.nextRoundOpensAtMs) {
    next.sent.nextRound = true;
    events.push({
      type: "game.next_round",
      payload: eventPayload(
        next,
        round,
        next.nextRound
          ? {
              nextRound: {
                ...next.nextRound,
                status: "betting",
                locked: false,
              },
            }
          : {},
      ),
    });
  }

  const due = [];
  if (!next.sent.roundStarted) due.push(round.opensAtMs);
  if (!next.sent.bettingClosed) due.push(round.bettingClosesAtMs);
  if (!next.sent.result) due.push(round.revealAtMs);
  if (!next.sent.nextRound) due.push(round.nextRoundOpensAtMs);

  return {
    schedule: next,
    events,
    complete: due.length === 0,
    nextAtMs: due.length ? Math.min(...due) : null,
  };
}
