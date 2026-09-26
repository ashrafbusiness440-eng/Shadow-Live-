import { createHmac, timingSafeEqual } from "node:crypto";

export const REALTIME_ADMISSION_VERSION = 1;
export const REALTIME_ADMISSION_TTL_MS = 30_000;
export const REALTIME_ADMISSION_MAX_TTL_MS = 45_000;

function clean(value, max = 240) {
  return String(value ?? "").trim().slice(0, max);
}

function b64urlEncode(value) {
  return Buffer.from(value).toString("base64url");
}

function b64urlDecode(value) {
  return Buffer.from(String(value || ""), "base64url");
}

function signingKey(secret) {
  const raw = clean(secret, 512);
  if (!raw) throw new Error("realtime_admission_not_configured");
  return createHmac("sha256", raw)
    .update("shadow-live-realtime-admission-v1")
    .digest();
}

function signature(secret, encodedPayload) {
  return createHmac("sha256", signingKey(secret))
    .update(encodedPayload)
    .digest();
}

export function issueRealtimeAdmission(
  secret,
  {
    uid,
    roomId,
    displayName = "",
    profileImageUrl = "",
  } = {},
  {
    nowMs = Date.now(),
    ttlMs = REALTIME_ADMISSION_TTL_MS,
  } = {},
) {
  const sub = clean(uid, 180);
  const room = clean(roomId, 180);
  if (!sub || !room) throw new Error("invalid_realtime_admission_subject");
  const boundedTtl = Math.max(
    1_000,
    Math.min(REALTIME_ADMISSION_MAX_TTL_MS, Number(ttlMs || 0)),
  );
  const payload = {
    v: REALTIME_ADMISSION_VERSION,
    sub,
    roomId: room,
    iatMs: Math.trunc(Number(nowMs)),
    expMs: Math.trunc(Number(nowMs) + boundedTtl),
    displayName: clean(displayName, 120),
    profileImageUrl: clean(profileImageUrl, 1024),
  };
  const encoded = b64urlEncode(JSON.stringify(payload));
  const sig = signature(secret, encoded);
  return `${encoded}.${sig.toString("base64url")}`;
}

export function verifyRealtimeAdmission(
  secret,
  token,
  {
    uid,
    roomId,
    nowMs = Date.now(),
  } = {},
) {
  const raw = clean(token, 4096);
  const expectedUid = clean(uid, 180);
  const expectedRoomId = clean(roomId, 180);
  if (!raw || !expectedUid || !expectedRoomId) return null;

  const parts = raw.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;

  let actualSignature;
  try {
    actualSignature = b64urlDecode(parts[1]);
  } catch {
    return null;
  }
  const expectedSignature = signature(secret, parts[0]);
  if (
    actualSignature.length !== expectedSignature.length ||
    !timingSafeEqual(actualSignature, expectedSignature)
  ) {
    return null;
  }

  let payload;
  try {
    payload = JSON.parse(b64urlDecode(parts[0]).toString("utf8"));
  } catch {
    return null;
  }

  const issuedAtMs = Number(payload?.iatMs || 0);
  const expiresAtMs = Number(payload?.expMs || 0);
  const now = Number(nowMs);
  if (
    Number(payload?.v) !== REALTIME_ADMISSION_VERSION ||
    clean(payload?.sub, 180) !== expectedUid ||
    clean(payload?.roomId, 180) !== expectedRoomId ||
    !Number.isFinite(issuedAtMs) ||
    !Number.isFinite(expiresAtMs) ||
    issuedAtMs > now + 5_000 ||
    expiresAtMs <= now ||
    expiresAtMs - issuedAtMs > REALTIME_ADMISSION_MAX_TTL_MS
  ) {
    return null;
  }

  return {
    uid: expectedUid,
    roomId: expectedRoomId,
    issuedAtMs,
    expiresAtMs,
    displayName: clean(payload?.displayName, 120),
    profileImageUrl: clean(payload?.profileImageUrl, 1024),
  };
}
