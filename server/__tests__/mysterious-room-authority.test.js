import assert from "node:assert/strict";
import { test } from "node:test";

import {
  mysteriousRoomAuthoritySuppressed,
} from "../../cloudflare-worker/src/mysterious-identity.js";

const now = Date.UTC(2026, 9, 8);

test("mysterious mode suppresses room authority without deleting roles", () => {
  const ordinaryOwner = {
    role: "user",
    adminEnabled: false,
    mysteriousEnabled: true,
    mysteriousId: "123456789",
    mysteriousExpiresAt: new Date(now + 86400000),
  };
  assert.equal(
    mysteriousRoomAuthoritySuppressed(ordinaryOwner, now),
    true,
  );

  const admin = {
    role: "admin",
    adminEnabled: true,
    capabilities: ["manageRooms"],
    mysteriousEnabled: true,
    mysteriousId: "223456789",
    mysteriousPermanent: true,
  };
  assert.equal(mysteriousRoomAuthoritySuppressed(admin, now), true);

  const disabled = { ...admin, mysteriousEnabled: false };
  assert.equal(mysteriousRoomAuthoritySuppressed(disabled, now), false);
});

test("platform owner absolute room safety remains available", () => {
  assert.equal(
    mysteriousRoomAuthoritySuppressed({
      role: "owner",
      mysteriousEnabled: true,
      mysteriousId: "323456789",
      mysteriousPermanent: true,
    }, now),
    false,
  );
});

test("voice-session enforces suppression server-side", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(
    new URL("../../cloudflare-worker/src/voice-session-legacy.js", import.meta.url),
    "utf8",
  );
  assert.equal(
    source.includes("if(mysteriousRoomAuthoritySuppressed(actor))return false;"),
    true,
  );
  assert.equal(source.includes("authoritySuppressed"), true);
});
