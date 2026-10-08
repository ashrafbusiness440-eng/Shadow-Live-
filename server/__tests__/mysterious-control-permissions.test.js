import assert from "node:assert/strict";
import { test } from "node:test";

import { mysteriousControlAccess } from "../../cloudflare-worker/src/manage-mysterious-person.js";

test("mysterious control permissions keep permanent and prices owner-only", () => {
  const owner = mysteriousControlAccess({ role: "owner" });
  assert.equal(owner.canManage, true);
  assert.equal(owner.canReveal, true);
  assert.equal(owner.canUpdatePrices, true);
  assert.equal(owner.canGrantPermanent, true);

  const manager = mysteriousControlAccess({
    role: "admin",
    adminEnabled: true,
    capabilities: ["manageMysteriousPerson"],
  });
  assert.equal(manager.canManage, true);
  assert.equal(manager.canReveal, false);
  assert.equal(manager.canUpdatePrices, false);
  assert.equal(manager.canGrantPermanent, false);

  const revealer = mysteriousControlAccess({
    role: "super_admin",
    adminEnabled: true,
    capabilities: ["revealMysteriousIdentity"],
  });
  assert.equal(revealer.canManage, false);
  assert.equal(revealer.canReveal, true);
});

test("mysterious capabilities stay inside the central owner delegation path", async () => {
  const { readFile } = await import("node:fs/promises");
  const access = await readFile(
    new URL("../../cloudflare-worker/src/manage-user-access.js", import.meta.url),
    "utf8",
  );
  assert.equal(access.includes('"manageMysteriousPerson"'), true);
  assert.equal(access.includes('"revealMysteriousIdentity"'), true);
  assert.equal(access.includes('actor.role !== "owner"'), true);
});
