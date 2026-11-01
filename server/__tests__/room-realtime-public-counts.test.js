import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readPresenceCount } from "../../cloudflare-worker/src/room-realtime.js";

test("discovery counts read only the Durable Object's public count endpoint", async () => {
  let path = "";
  const count = await readPresenceCount({
    fetch: async url => {
      path = new URL(url).pathname;
      return Response.json({ ok: true, onlineCount: 7 });
    },
  });
  assert.equal(path, "/presence/public-count");
  assert.equal(count, 7);
});

test("a private or unknown policy is not surfaced as a discovery count", async () => {
  await assert.rejects(readPresenceCount({
    fetch: async () => Response.json({ ok: false, code: "room_private" },
      { status: 403 }),
  }), /realtime_presence_failed/);
});

test("DO policy is synchronized by room settings and initialized only on first authorized ticket", () => {
  const object = readFileSync(
    new URL("../../cloudflare-worker/src/room-realtime-object.js", import.meta.url),
    "utf8",
  );
  const legacy = readFileSync(
    new URL("../../cloudflare-worker/src/voice-session-legacy.js", import.meta.url),
    "utf8",
  );
  const realtime = readFileSync(
    new URL("../../cloudflare-worker/src/room-realtime.js", import.meta.url),
    "utf8",
  );
  const publicCount = object.slice(
    object.indexOf('if (url.pathname === "/presence/public-count"'),
    object.indexOf('if (url.pathname === "/presence/count"'),
  );
  assert.match(publicCount, /storage\.get\("room_visibility_v1"\)/);
  assert.match(publicCount, /visibility !== "public"/);
  assert.match(publicCount, /status: 403/);
  assert.match(publicCount, /onlineCount: this\.#presenceSnapshot\(\)\.length/);

  const ticket = object.slice(object.indexOf("async #issueTicket("),
    object.indexOf("async #connect("));
  assert.match(ticket, /currentVisibility === undefined/);
  assert.match(ticket, /storage\.put\("room_visibility_v1", visibility\)/);
  assert.match(ticket, /body\.roomVisibility/);

  const policy = object.slice(object.indexOf("async #updateChatPolicy("),
    object.indexOf("async #contentFilterPolicy("));
  assert.match(policy, /Object\.hasOwn\(body, "visibility"\)/);
  assert.match(policy, /storage\.put\("room_visibility_v1", visibility\)/);
  assert.match(legacy, /setRoomRealtimeChatPolicy\(legacyEnv,roomId,chatEnabled,visibility\)/);
  assert.match(realtime, /roomVisibility: roomData\.isHidden === true/);
  assert.match(realtime, /\.\.\.\(visibility === null \? \{\} : \{ visibility \}\)/);
});

test("admin room visibility changes also synchronize without changing chat", () => {
  const object = readFileSync(
    new URL("../../cloudflare-worker/src/room-realtime-object.js", import.meta.url), "utf8");
  const legacy = readFileSync(
    new URL("../../cloudflare-worker/src/voice-session-legacy.js", import.meta.url), "utf8");
  const realtime = readFileSync(
    new URL("../../cloudflare-worker/src/room-realtime.js", import.meta.url), "utf8");
  const policy = legacy.slice(legacy.indexOf("async function controlRoomPolicy("),
    legacy.indexOf("export async function announceRoomEntrance("));
  assert.match(policy, /isHidden:visibility==="hidden"/);
  assert.match(policy, /setRoomRealtimeVisibilityPolicy\(legacyEnv,result\.roomId,result\.visibility\)/);
  assert.match(policy, /includes\(result\.visibility\)/);
  assert.match(policy, /const result=await db\.runTransaction/);
  const synchronized = realtime.slice(
    realtime.indexOf("export async function setRoomRealtimeVisibilityPolicy("),
    realtime.indexOf("export async function publishGlobalRocketEvents("));
  assert.match(synchronized, /JSON\.stringify\(\{ roomId: normalized, visibility \}\)/);
  assert.doesNotMatch(synchronized, /chatEnabled/);
  const doChat = object.slice(object.indexOf("async #updateChatPolicy("),
    object.indexOf("async #contentFilterPolicy("));
  assert.match(doChat, /if \(!changeChat\) continue/);
});
