import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";

test("room realtime reuses the existing ticket path for mysterious identity", async () => {
  const source = await readFile(
    new URL("../../cloudflare-worker/src/room-realtime.js", import.meta.url),
    "utf8",
  );
  assert.equal(source.includes("roomRealtimeIdentityPresentation("), true);
  assert.equal(source.includes("applyMysteriousIdentityPresentation"), true);
  assert.equal(source.includes('action === "refreshIdentity"'), true);
  assert.equal(
    source.includes("mysteriousRoomAuthoritySuppressed(user)"),
    true,
  );
});

test("durable room presence updates identity in place without reconnect", async () => {
  const source = await readFile(
    new URL("../../cloudflare-worker/src/room-realtime-object.js", import.meta.url),
    "utf8",
  );
  assert.equal(source.includes('"/presence/identity"'), true);
  assert.equal(source.includes("async #updatePresenceIdentity(request)"), true);
  assert.equal(source.includes('"room.presence_updated"'), true);
  assert.equal(
    source.includes("serializeAttachment({ ...attachment, ...patch })"),
    true,
  );
});

test("room seats reuse existing user/profile transaction for identity sync", async () => {
  const source = await readFile(
    new URL("../../cloudflare-worker/src/voice-session-legacy.js", import.meta.url),
    "utf8",
  );
  assert.equal(source.includes("syncMysteriousRoomIdentity"), true);
  assert.equal(source.includes("mysteriousMode:mysteriousActive"), true);
  assert.equal(source.includes('?"الشخص الغامض"'), true);
});

test("private profile paths stay outside mysterious room identity", async () => {
  const publicProfile = await readFile(
    new URL("../../cloudflare-worker/src/public-profile-presentation.js", import.meta.url),
    "utf8",
  );
  const chatActions = await readFile(
    new URL("../../cloudflare-worker/src/chat-safety-actions.js", import.meta.url),
    "utf8",
  );
  assert.equal(publicProfile.includes("applyMysteriousIdentityPresentation"), false);
  assert.equal(chatActions.includes("applyMysteriousIdentityPresentation"), false);
});
