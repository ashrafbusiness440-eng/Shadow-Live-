import assert from "node:assert/strict";
import { test } from "node:test";

import {
  mysteriousPolicyFromConfig,
  mysteriousStateFromUser,
  mysteriousVoiceOptionsFromConfig,
} from "../../cloudflare-worker/src/mysterious-person.js";

test("mysterious voice catalog exposes original plus eight bounded presets", () => {
  const voices = mysteriousVoiceOptionsFromConfig();
  assert.equal(voices.length, 9);
  assert.equal(voices[0].id, "original");
  assert.equal(voices.filter((item) => item.id !== "original").length, 8);
  assert.equal(voices.some((item) => item.preset === "Autobot"), false);
  assert.equal(voices.some((item) => item.preset === "OutOfPower"), false);
});

test("owner config can disable and reorder effect voices but original stays enabled", () => {
  const voices = mysteriousVoiceOptionsFromConfig({
    voiceOptions: [
      { id: "android", enabled: false, order: 1 },
      { id: "ethereal", enabled: true, order: 0 },
      { id: "original", enabled: false, order: 8 },
    ],
  });
  assert.equal(voices.find((item) => item.id === "original").enabled, true);
  assert.equal(voices.find((item) => item.id === "android").enabled, false);
  assert.equal(voices[0].id, "ethereal");
});

test("disabled selected voice falls back to original without changing entitlement", () => {
  const now = Date.UTC(2026, 9, 8);
  const policy = mysteriousPolicyFromConfig({
    voiceOptions: [{ id: "android", enabled: false, order: 1 }],
  });
  const state = mysteriousStateFromUser({
    mysteriousPermanent: true,
    mysteriousEnabled: true,
    mysteriousId: "123456789",
    mysteriousVoiceId: "android",
  }, now, policy);
  assert.equal(state.active, true);
  assert.equal(state.enabled, true);
  assert.equal(state.selectedVoiceId, "original");
  assert.equal(state.voiceOptions.some((item) => item.id === "android"), false);
});
