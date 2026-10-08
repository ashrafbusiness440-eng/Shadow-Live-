import assert from "node:assert/strict";
import { test } from "node:test";

import {
  mysteriousControlAccess,
} from "../../cloudflare-worker/src/manage-mysterious-person.js";

test("voice catalog configuration stays Owner-only", () => {
  const owner = mysteriousControlAccess({ role: "owner" });
  assert.equal(owner.canConfigureVoices, true);

  const delegated = mysteriousControlAccess({
    role: "super_admin",
    adminEnabled: true,
    capabilities: ["manageMysteriousPerson", "revealMysteriousIdentity"],
  });
  assert.equal(delegated.canConfigureVoices, false);
});

test("voice configuration uses the shared mysterious config and audit path", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(
    new URL("../../cloudflare-worker/src/manage-mysterious-person.js", import.meta.url),
    "utf8",
  );
  assert.equal(source.includes('action === "controlUpdateVoices"'), true);
  assert.equal(source.includes('"system_config/mysterious_person"'), true);
  assert.equal(source.includes('"update_voice_options"'), true);
  assert.equal(source.includes('id === "original" ? true'), true);
});
