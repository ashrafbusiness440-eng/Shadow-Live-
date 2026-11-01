import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readPresence } from "../../cloudflare-worker/src/room-realtime.js";

test("presenceState requests the roster only for the authenticated caller", async () => {
  const requested = [];
  const stub = {
    async fetch(url) {
      requested.push(new URL(url));
      return Response.json({
        ok: true, onlineCount: 1,
        participants: [{ uid: "current-user" }],
      });
    },
  };
  assert.equal(await readPresence(stub, ""), null);
  assert.equal(requested.length, 0);
  const roster = await readPresence(stub, "current-user");
  assert.equal(requested.length, 1);
  assert.equal(requested[0].pathname, "/presence");
  assert.equal(requested[0].searchParams.get("requiredUid"), "current-user");
  assert.equal(roster.onlineCount, 1);
  assert.equal(roster.participants[0].uid, "current-user");
});

test("denied or invalid live socket membership fails closed", async () => {
  let requests = 0;
  const stub = {
    async fetch() {
      requests++;
      return Response.json(
        { ok: false, code: "room_presence_required" },
        { status: 403 },
      );
    },
  };
  assert.equal(await readPresence(stub, "disconnected-user"), null);
  assert.equal(requests, 1);
});

test("public roster route is bound to verified auth UID and checked inside the DO", () => {
  const handler = readFileSync(
    new URL("../../cloudflare-worker/src/room-realtime.js", import.meta.url),
    "utf8",
  );
  const object = readFileSync(
    new URL("../../cloudflare-worker/src/room-realtime-object.js", import.meta.url),
    "utf8",
  );
  const action = handler.slice(
    handler.indexOf('if (action === "presenceState")'),
    handler.indexOf('if (action !== "ticket")'),
  );
  assert.match(action, /readPresence\(stub, String\(payload\.sub \|\| ""\)\)/);
  assert.match(action, /room_presence_required/);
  assert.match(action, /403/);
  const roster = object.slice(
    object.indexOf('if (url.pathname === "\/presence"'),
    object.indexOf('if (url.pathname === "\/presence\/internal"'),
  );
  assert.match(roster, /requiredUid && !hasPresenceUid/);
  assert.match(roster, /status: 403/);
  assert.match(roster, /this\.#presenceSnapshot\(\)/);
});
