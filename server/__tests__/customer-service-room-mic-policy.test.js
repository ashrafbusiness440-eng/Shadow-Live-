import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL("../../" + path, import.meta.url), "utf8");
}

test("Customer Service capacity stays fixed at five mics and two managers", () => {
  const voice = source("cloudflare-worker/src/voice-session-legacy.js");
  const control = source("lib/main_control.dart");

  assert.equal(
    voice.includes('if(type==="customer_service")return 5;'),
    true,
  );
  assert.equal(
    voice.includes('if(type==="customer_service")return 2;'),
    true,
  );
  assert.equal(
    voice.includes('capacityMode:customerService?"customer_service_fixed"'),
    true,
  );
  assert.equal(
    voice.includes('new ApiError("customer_service_capacity_fixed",409)'),
    true,
  );
  assert.equal(
    control.includes("'خدمة العملاء — سعة ثابتة'"),
    true,
  );
});

test("Customer Service public mics require a live invite and managers own mics 1-2", () => {
  const voice = source("cloudflare-worker/src/voice-session-legacy.js");

  assert.equal(
    voice.includes('if(seatIndex<2&&!canManageMic)'),
    true,
  );
  assert.equal(
    voice.includes('if(seatIndex>=2&&!canManageMic&&currentSeatIndex<0)'),
    true,
  );
  assert.equal(
    voice.includes('new ApiError("mic_invite_expired",409)'),
    true,
  );
  assert.equal(
    voice.includes("const CUSTOMER_SERVICE_INVITE_MS=60_000;"),
    true,
  );
});

test("Customer Service ordinary mic sessions expire server-side after ten minutes", () => {
  const voice = source("cloudflare-worker/src/voice-session-legacy.js");
  const realtime = source(
    "cloudflare-worker/src/room-realtime-object.js",
  );

  assert.equal(
    voice.includes("const CUSTOMER_SERVICE_MIC_MS=10*60_000;"),
    true,
  );
  assert.equal(
    voice.includes('"https://room-realtime.internal/customer-service/mic/register"'),
    true,
  );
  assert.equal(
    voice.includes('kind:"mic_expire"'),
    true,
  );
  assert.equal(
    realtime.includes('"/customer-service/mic/register"'),
    true,
  );
  assert.equal(
    realtime.includes('"customer_service_mic_expiry"'),
    true,
  );
  assert.equal(
    realtime.includes('customerServiceMicExpiresAtMs: 0'),
    true,
  );
  assert.equal(
    realtime.includes('outcome: seatsChanged ? "auto_drop"'),
    true,
  );
});
