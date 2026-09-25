import { verify } from "node:crypto";
import { googleAccessToken, parseServiceAccount } from "./google-auth.js";
import {
  AUTH_STATE_MAX_ATTEMPTS,
  fetchAuthStateResponse,
} from "./auth-state-reliability.js";

let certCache = { certs: null, expiresAt: 0 };
const userStateCache = new Map();
const userStateInflight = new Map();

const AUTH_STATE_FRESH_TTL_MS = 10_000;
const AUTH_STATE_STALE_TTL_MS = 30_000;
const AUTH_STATE_BREAKER_THRESHOLD = 2;
const AUTH_STATE_BREAKER_MS = 5_000;

let authStateCircuit = {
  failures: 0,
  openUntilMs: 0,
};

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

function assertCachedSessionState(state, payload) {
  if (!state?.active) throw new Error("unauthorized");
  if (
    state.revokedAtMs &&
    Number(payload.iat || 0) * 1000 <= state.revokedAtMs
  ) {
    throw new Error("unauthorized");
  }
}

function cachedStateFor(uid, nowMs, { allowStale = false } = {}) {
  const cached = userStateCache.get(uid);
  if (!cached) return null;
  const deadline = allowStale ? cached.staleUntilMs : cached.expiresAtMs;
  return deadline > nowMs ? cached : null;
}

function recordAuthStateSuccess() {
  authStateCircuit = { failures: 0, openUntilMs: 0 };
}

function recordAuthStateFailure(nowMs) {
  const failures = authStateCircuit.failures + 1;
  authStateCircuit = {
    failures,
    openUntilMs:
      failures >= AUTH_STATE_BREAKER_THRESHOLD
        ? nowMs + AUTH_STATE_BREAKER_MS
        : 0,
  };
}

function buildSessionState(body, nowMs) {
  const fields = body?.fields || {};
  const status = String(fields.accountStatus?.stringValue || "active");
  const revokedRaw = fields.sessionsRevokedAt?.timestampValue || "";
  const revokedAtMs = Date.parse(revokedRaw);
  return {
    active: status === "active",
    revokedAtMs: Number.isFinite(revokedAtMs) ? revokedAtMs : 0,
    expiresAtMs: nowMs + AUTH_STATE_FRESH_TTL_MS,
    staleUntilMs: nowMs + AUTH_STATE_STALE_TTL_MS,
  };
}

async function loadUserSessionState(uid, env) {
  const nowMs = Date.now();
  const { projectId } = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT);
  const token = await googleAccessToken(env);
  const url =
    `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/users/${encodeURIComponent(uid)}`;

  const { response } = await fetchAuthStateResponse(url, token, {
    maxAttempts: AUTH_STATE_MAX_ATTEMPTS,
  });

  if (response?.status === 404) {
    const state = {
      active: true,
      revokedAtMs: 0,
      expiresAtMs: nowMs + AUTH_STATE_FRESH_TTL_MS,
      staleUntilMs: nowMs + AUTH_STATE_STALE_TTL_MS,
    };
    userStateCache.set(uid, state);
    recordAuthStateSuccess();
    return state;
  }

  const body = await response?.json().catch(() => ({})) || {};
  if (!response?.ok) {
    recordAuthStateFailure(nowMs);
    const stale = cachedStateFor(uid, nowMs, { allowStale: true });
    if (stale) return stale;
    throw new Error("auth_state_lookup_failed");
  }

  const state = buildSessionState(body, nowMs);
  userStateCache.set(uid, state);
  recordAuthStateSuccess();
  return state;
}

async function assertUserSessionState(payload, env) {
  const uid = String(payload?.sub || "").trim();
  if (!uid) throw new Error("unauthorized");

  const nowMs = Date.now();
  const fresh = cachedStateFor(uid, nowMs);
  if (fresh) {
    assertCachedSessionState(fresh, payload);
    return;
  }

  if (authStateCircuit.openUntilMs > nowMs) {
    const stale = cachedStateFor(uid, nowMs, { allowStale: true });
    if (!stale) throw new Error("auth_state_lookup_failed");
    assertCachedSessionState(stale, payload);
    return;
  }

  let inflight = userStateInflight.get(uid);
  if (!inflight) {
    inflight = loadUserSessionState(uid, env).finally(() => {
      userStateInflight.delete(uid);
    });
    userStateInflight.set(uid, inflight);
  }

  const state = await inflight;
  assertCachedSessionState(state, payload);
}

export async function verifyFirebaseIdTokenValue(
  token,
  env,
  { checkUserState = true } = {},
) {
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

  const signInProvider = String(payload?.firebase?.sign_in_provider || "");
  if (signInProvider === "password" && payload.email_verified !== true) {
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

  if (checkUserState) {
    await assertUserSessionState(payload, env);
  }
  return payload;
}

export async function verifyFirebaseIdToken(
  request,
  env,
  options = {},
) {
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) throw new Error("unauthorized");
  return verifyFirebaseIdTokenValue(auth.slice(7), env, options);
}
