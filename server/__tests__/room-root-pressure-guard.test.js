import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("room gifts no longer fan support counters out through rooms/{roomId}", () => {
  const roomGift = source("../../cloudflare-worker/src/room-gift.js");

  assert.equal(roomGift.includes("const roomDailySupport ="), false);
  assert.equal(roomGift.includes("dailySupport: roomDailySupport"), false);
  assert.equal(roomGift.includes("weeklySupport: roomWeeklySupport"), false);
  assert.equal(roomGift.includes("monthlySupport: roomMonthlySupport"), false);

  assert.equal(roomGift.includes("const roomDailyPath ="), true);
  assert.equal(roomGift.includes("const roomWeeklyPath ="), true);
  assert.equal(roomGift.includes("const roomMonthlyPath ="), true);
  assert.equal(
    roomGift.includes("High-frequency room support lives in the period support documents"),
    true,
  );
});

test("room insights and bootstrap read exact support period documents", () => {
  const voice = source("../../cloudflare-worker/src/voice-session-legacy.js");

  assert.equal(
    voice.includes('roomRef.collection("support_daily").doc(periods.day)'),
    true,
  );
  assert.equal(
    voice.includes('roomRef.collection("support_weekly").doc(periods.week)'),
    true,
  );
  assert.equal(
    voice.includes('roomRef.collection("support_monthly").doc(periods.month)'),
    true,
  );
  assert.equal(
    voice.includes("Number(weeklySupportSnap.data()?.supportCoins||0)"),
    true,
  );
  assert.equal(
    voice.includes("Number(monthlySupportSnap.data()?.supportCoins||0)"),
    true,
  );
});

test("room chat touches the room root at most once per minute", () => {
  const voice = source("../../cloudflare-worker/src/voice-session-legacy.js");

  assert.equal(
    voice.includes("const ROOM_CHAT_ROOT_TOUCH_INTERVAL_MS=60_000;"),
    true,
  );
  assert.equal(
    voice.includes(
      "lastChatAtMs<=0||nowMs-lastChatAtMs>=ROOM_CHAT_ROOT_TOUCH_INTERVAL_MS",
    ),
    true,
  );
});
