import { verify } from "node:crypto";
import { googleAccessToken, parseServiceAccount } from "./google-auth.js";

let certCache = { certs: null, expiresAt: 0 };
const userStateCache = new Map();

function decodeBase64Url(value) {
  const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
  const pad = normalized.length % 4;
  const padded = pad ? normalized + "=".repeat(4 - pad) : normalized;
  return Buffer.from(padded, "base64");
}

function decodeJsonPart(value) {
  return JSON.parse(decodeBase64Url(value).toString("utf8"));
}

async function firebaseCerts() {
  const now = Date.now();
  if (certCache.certs && certCache.expiresAt > now + 60_000) {
    return certCache.certs;
  }

  const response = await fetch(
    "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com",
  );
  if (!response.ok) throw new Error("firebase_certs_failed");
  const certs = await response.json();

  const cacheControl = response.headers.get("cache-control") || "";
  const match = cacheControl.match(/max-age=(\d+)/i);
  const maxAge = match ? Number(match[1]) : 3600;
  certCache = { certs, expiresAt: now + maxAge * 1000 };
  return certs;
}

async function assertUserSessionState(payload, env) {
  const uid = String(payload?.sub || "").trim();
  if (!uid) throw new Error("unauthorized");

  const cached = userStateCache.get(uid);
  const nowMs = Date.now();
  if (cached && cached.expiresAt > nowMs) {
    if (!cached.active) throw new Error("unauthorized");
    if (cached.revokedAtMs && Number(payload.iat || 0) * 1000 <= cached.revokedAtMs) {
      throw new Error("unauthorized");
    }
    return;
  }

  const { projectId } = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT);
  const token = await googleAccessToken(env);
  const url =
    `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/users/${encodeURIComponent(uid)}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (response.status === 404) {
    userStateCache.set(uid, { active: true, revokedAtMs: 0, expiresAt: nowMs + 5000 });
    return;
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error("auth_state_lookup_failed");

  const fields = body?.fields || {};
  const status = String(fields.accountStatus?.stringValue || "active");
  const revokedRaw = fields.sessionsRevokedAt?.timestampValue || "";
  const revokedAtMs = Date.parse(revokedRaw);
  const state = {
    active: status === "active",
    revokedAtMs: Number.isFinite(revokedAtMs) ? revokedAtMs : 0,
    expiresAt: nowMs + 5000,
  };
  userStateCache.set(uid, state);

  if (!state.active) throw new Error("unauthorized");
  if (state.revokedAtMs && Number(payload.iat || 0) * 1000 <= state.revokedAtMs) {
    throw new Error("unauthorized");
  }
}

export async function verifyFirebaseIdTokenValue(token, env) {
  token = String(token || "").trim();
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("unauthorized");

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = decodeJsonPart(encodedHeader);
  const payload = decodeJsonPart(encodedPayload);

  if (header.alg !== "RS256" || !header.kid) throw new Error("unauthorized");

  const { projectId } = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT);
  const now = Math.floor(Date.now() / 1000);
  if (
    payload.aud !== projectId ||
    payload.iss !== `https://securetoken.google.com/${projectId}` ||
    typeof payload.sub !== "string" ||
    !payload.sub ||
    payload.exp <= now ||
    payload.iat > now + 60
  ) {
    throw new Error("unauthorized");
  }

  const certs = await firebaseCerts();
  const cert = certs[header.kid];
  if (!cert) throw new Error("unauthorized");

  const ok = verify(
    "RSA-SHA256",
    Buffer.from(`${encodedHeader}.${encodedPayload}`),
    cert,
    decodeBase64Url(encodedSignature),
  );
  if (!ok) throw new Error("unauthorized");

  await assertUserSessionState(payload, env);
  return payload;
}

export async function verifyFirebaseIdToken(request, env) {
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) throw new Error("unauthorized");
  return verifyFirebaseIdTokenValue(auth.slice(7), env);
}
