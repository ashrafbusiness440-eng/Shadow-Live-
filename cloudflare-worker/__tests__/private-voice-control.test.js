import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  voiceConfigState, validateVoiceChange, writeVoiceConfig,
} from "../src/private-voice-control.js";

function fixture(initial = {}) {
  const docs = new Map([
    ["system_config/messaging", {
      voiceNotesEnabled: false,
      privateCallsEnabled: false,
      voiceControlVersion: 0,
      existingMessagingPolicy: "preserve",
      ...initial,
    }],
  ]);
  const db = {
    beginTransaction: async () => "tx",
    rollback: async () => {},
    get: async path => ({
      exists: docs.has(path),
      data: docs.get(path) || {},
    }),
    writeUpdate: (path, data) => ({ path, data, op: "update" }),
    writeCreate: (path, data) => ({ path, data, op: "create" }),
    commit: async (_tx, writes) => {
      for (const w of writes) {
        if (w.op === "create" && docs.has(w.path)) {
          throw Error("ALREADY_EXISTS");
        }
      }
      for (const w of writes) {
        docs.set(w.path, w.op === "update"
          ? { ...(docs.get(w.path) || {}), ...w.data } : w.data);
      }
    },
  };
  return { db, docs };
}

const key = "private_voice_policy_change_1234";
const reason = "تجهيز اختبارات الصوت";
const input = (version = 0, voiceNotesEnabled = true, privateCallsEnabled = false) => ({
  action: "save",
  expectedVersion: version,
  idempotencyKey: key,
  reason,
  config: { voiceNotesEnabled, privateCallsEnabled },
});

test("both voice features stay OFF by default and production readiness is server-owned", () => {
  assert.deepEqual(voiceConfigState(), {
    voiceNotesEnabled: false,
    privateCallsEnabled: false,
    privateCallPricingMode: "free",
    privateCallPriceCoins: 0,
    paidCallsLaunchReady: false,
    version: 0,
    callsLaunchReady: false,
  });
  assert.equal(voiceConfigState({
    voiceNotesEnabled: true, privateCallsEnabled: true,
    voiceControlVersion: 12,
  }).callsLaunchReady, false);
  assert.equal(voiceConfigState({}, { PRIVATE_CALL_MEDIA_READY: "true" }).callsLaunchReady, false);
  assert.equal(voiceConfigState({}, { PRIVATE_CALL_PUSH_READY: "true" }).callsLaunchReady, false);
  assert.equal(voiceConfigState({}, {
    PRIVATE_CALL_MEDIA_READY: "true", PRIVATE_CALL_PUSH_READY: "true",
  }).callsLaunchReady, true);
  assert.throws(
    () => validateVoiceChange({
      voiceNotesEnabled: false, privateCallsEnabled: true,
    }, {}, {}),
    e => e.code === "private_calls_not_ready",
  );
  assert.throws(() => validateVoiceChange({
    voiceNotesEnabled: true, privateCallsEnabled: true,
  }, {}, { PRIVATE_CALL_MEDIA_READY: "true" }),
  e => e.code === "private_calls_not_ready");
  assert.deepEqual(validateVoiceChange({
    voiceNotesEnabled: true, privateCallsEnabled: true,
  }, {}, { PRIVATE_CALL_MEDIA_READY: "true", PRIVATE_CALL_PUSH_READY: "true" }), {
    voiceNotesEnabled: true, privateCallsEnabled: true,
    privateCallPricingMode: "free", privateCallPriceCoins: 0,
  });
  // Disabling a previously activated feature must ALWAYS work, even when
  // the production readiness flag is later turned OFF in an emergency.
  assert.deepEqual(validateVoiceChange({
    voiceNotesEnabled: false, privateCallsEnabled: false,
  }, { privateCallsEnabled: true }, {}), {
    voiceNotesEnabled: false, privateCallsEnabled: false,
    privateCallPricingMode: "free", privateCallPriceCoins: 0,
  });
  // Re-saving another setting must not strand an old enabled value, while
  // turning calls from OFF to ON still requires server readiness.
  assert.deepEqual(validateVoiceChange({
    voiceNotesEnabled: true, privateCallsEnabled: true,
  }, { privateCallsEnabled: true }, {}), {
    voiceNotesEnabled: true, privateCallsEnabled: true,
    privateCallPricingMode: "free", privateCallPriceCoins: 0,
  });
  assert.throws(
    () => validateVoiceChange({
      voiceNotesEnabled: 1, privateCallsEnabled: false,
    }, {}, {}),
    e => e.code === "invalid_voice_config",
  );
});

test("save updates only messaging voice flags and records immutable audit and operation", async () => {
  const { db, docs } = fixture();
  const saved = await writeVoiceConfig(db, "owner", input(), {});
  assert.equal(saved.code, "ok");
  assert.equal(saved.config.voiceNotesEnabled, true);
  assert.equal(saved.config.privateCallsEnabled, false);
  assert.equal(saved.config.version, 1);
  assert.equal(docs.get("system_config/messaging").existingMessagingPolicy, "preserve");
  assert.equal(docs.get("system_config/messaging").privateCallPricingMode, "free");
  assert.equal(docs.get("system_config/messaging").privateCallPriceCoins, 0);
  assert.equal(docs.get("admin_audit_logs/private_voice_" + key).reason, reason);
  assert.equal(docs.get("control_operations/" + key).actorUid, "owner");
  const repeated = await writeVoiceConfig(db, "owner", input(), {});
  assert.equal(repeated.code, "duplicate");
  assert.equal(docs.get("system_config/messaging").voiceControlVersion, 1);
  await assert.rejects(
    writeVoiceConfig(db, "different-admin", input(), {}),
    e => e.code === "idempotency_conflict",
  );
});

test("reordered edits, invalid operations and premature call enable fail closed", async () => {
  const { db, docs } = fixture({ voiceControlVersion: 4 });
  await assert.rejects(
    writeVoiceConfig(db, "owner", input(3), {}),
    e => e.code === "voice_config_conflict",
  );
  await assert.rejects(
    writeVoiceConfig(db, "owner", input(4, true, true), {}),
    e => e.code === "private_calls_not_ready",
  );
  assert.equal(docs.get("system_config/messaging").voiceControlVersion, 4);
  assert.equal(docs.has("admin_audit_logs/private_voice_" + key), false);
  await assert.rejects(
    writeVoiceConfig(db, "owner", { ...input(4), idempotencyKey: "x" }, {}),
    e => e.code === "invalid_request",
  );
});

test("HTTP route uses validated admin session, explicit capabilities and no direct UI Firestore mutation", () => {
  const server = readFileSync(
    "cloudflare-worker/src/private-voice-control.js", "utf8",
  );
  const control = readFileSync("lib/admin/private_voice_control_page.dart", "utf8");
  const nav = readFileSync("lib/main_control.dart", "utf8");
  const index = readFileSync("cloudflare-worker/src/index.js", "utf8");
  assert.ok(server.includes("verifyFirebaseIdToken(request, env)"));
  assert.ok(server.includes("assertUserDocumentSessionState(decoded, actor)"));
  assert.ok(server.includes('actor.role === "owner"'));
  assert.ok(server.includes('actor.capabilities.includes("manageSystem")'));
  assert.ok(server.includes("auth_time"));
  assert.ok(server.includes("admin_audit_logs/private_voice_"));
  assert.ok(server.includes("db.beginTransaction()"));
  assert.ok(index.includes('"/api/private-voice-control"'));
  assert.ok(control.includes("shadowApiEndpoint('private-voice-control')"));
  assert.ok(control.includes("!_callsReady"));
  assert.ok(control.includes("(!_callsReady && !_calls)"));
  assert.ok(control.includes("if (!_callsReady && value) return;"));
  assert.ok(control.includes("_operationKey = op;"));
  assert.ok(control.includes("حفظ الإعدادات"));
  assert.ok(nav.includes("const PrivateVoiceControlPage()"));
});

test("paid tariff can be saved as an audited draft but cannot enable calls or charge Coins", async () => {
  const { db, docs } = fixture();
  const draft = { ...input(), config: {
    voiceNotesEnabled: true, privateCallsEnabled: false,
    privateCallPricingMode: "paid", privateCallPriceCoins: 149,
  }};
  const result = await writeVoiceConfig(db, "owner", draft, {});
  assert.equal(result.config.privateCallPricingMode, "paid");
  assert.equal(result.config.privateCallPriceCoins, 149);
  assert.equal(result.config.callsLaunchReady, false);
  assert.equal(result.config.paidCallsLaunchReady, false);
  assert.equal(docs.get("admin_audit_logs/private_voice_" + key).after.privateCallPriceCoins, 149);
  assert.equal([...docs.keys()].filter(k => k.startsWith("financial_ledger/")).length, 0);
  assert.equal([...docs.keys()].filter(k => k.startsWith("wallet_operations/")).length, 0);
  // A stale admin UI cannot turn a stored paid draft into a free call.
  assert.throws(() => validateVoiceChange({
    voiceNotesEnabled: true, privateCallsEnabled: true,
  }, result.config, {
    PRIVATE_CALL_MEDIA_READY: "true", PRIVATE_CALL_PUSH_READY: "true",
  }), e => e.code === "private_call_billing_not_ready");
  assert.equal(voiceConfigState({
    privateCallPricingMode: "paid", privateCallPriceCoins: 149,
  }, {
    PRIVATE_CALL_MEDIA_READY: "true", PRIVATE_CALL_PUSH_READY: "true",
  }).callsLaunchReady, false);
});

test("tariff validation rejects coercion, fractional, negative and zero paid prices", () => {
  const base = { voiceNotesEnabled: false, privateCallsEnabled: false };
  for (const [privateCallPricingMode, privateCallPriceCoins] of [
    ["paid", 0], ["paid", -3], ["paid", 1.25], ["paid", "500"],
    ["paid", 1_000_001], ["unknown", 100],
  ]) {
    assert.throws(() => validateVoiceChange({
      ...base, privateCallPricingMode, privateCallPriceCoins,
    }, voiceConfigState(), {}), e => e.code === "invalid_private_call_price");
  }
  assert.throws(() => validateVoiceChange({
    ...base, privateCallsEnabled: true,
    privateCallPricingMode: "paid", privateCallPriceCoins: 100,
  }, voiceConfigState(), {
    PRIVATE_CALL_MEDIA_READY: "true", PRIVATE_CALL_PUSH_READY: "true",
  }), e => e.code === "private_call_billing_not_ready");
});
