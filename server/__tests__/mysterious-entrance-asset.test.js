import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";

test("mysterious room entrance reuses the existing announcement path", async () => {
  const source = await readFile(
    new URL("../../cloudflare-worker/src/voice-session-legacy.js", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("export async function announceRoomEntrance");
  const end = source.indexOf("async function syncMysteriousRoomIdentity", start);
  const block = source.slice(start, end);
  assert.notEqual(start, -1);
  assert.equal(block.includes("activeMysteriousIdentity(user)"), true);
  assert.equal(block.includes('"mysterious.entrance"'), true);
  assert.equal(block.includes('uid:mysteriousMode?"":uid'), true);
  assert.equal(block.includes('displayName:mysteriousMode'), true);
  assert.equal(block.includes('vipLevel:mysteriousMode?0'), true);
});

test("mysterious entrance does not create a second realtime channel", async () => {
  const source = await readFile(
    new URL("../../cloudflare-worker/src/voice-session-legacy.js", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("export async function announceRoomEntrance");
  const end = source.indexOf("async function syncMysteriousRoomIdentity", start);
  const block = source.slice(start, end);
  assert.equal(block.includes('broadcastRoomRealtimeEvent('), true);
  assert.equal(block.includes('new WebSocket'), false);
  assert.equal(block.includes('setInterval'), false);
});
