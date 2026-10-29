import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";

const read=path=>readFileSync(new URL(path,import.meta.url),"utf8");

test("a verified cosmetic has only a single non-polling expiry timer",()=>{
  const gate=read("../../lib/features/store/widgets/store_visual_expiry_gate.dart");
  assert.match(gate,/_deadline = Timer\(Duration\(milliseconds: remaining\)/);
  assert.match(gate,/_deadline\?\.cancel\(\)/);
  assert.match(gate,/didUpdateWidget/);
  assert.match(gate,/void dispose\(\)/);
  assert.match(gate,/_deadlineReached = true/);
  assert.doesNotMatch(gate,/Timer\.periodic|setInterval|Firestore|http\./);
});

test("profile and room frames/wallpapers use verified Store deadline gate",()=>{
  const avatar=read("../../lib/features/profile/widgets/profile_avatar_with_frame.dart");
  const card=read("../../lib/features/profile/widgets/store_verified_profile_card_backdrop.dart");
  const room=read("../../lib/main.dart");
  assert.match(avatar,/StoreVisualExpiryGate\(/);
  assert.match(avatar,/expiresAtMs: frame\.expiresAtMs/);
  assert.match(card,/StoreVisualExpiryGate\(/);
  assert.match(card,/expiresAtMs: visual\.expiresAtMs/);
  assert.match(room,/expiresAtMs: seat\.voiceWaveExpiresAtMs/);
  assert.match(room,/expiresAtMs: visual\.expiresAtMs/);
  assert.match(room,/expiresAtMs: frame\.expiresAtMs/);
  assert.match(room,/storeRoomFrame: active \? frame : null/);
  assert.match(room,/errorBuilder: \(_, __, ___\) => fallback/);
});
