import { verify } from "node:crypto";
import { googleAccessToken, parseServiceAccount } from "./google-auth.js";
import {
  AUTH_STATE_MAX_ATTEMPTS,
  authStateRetryDelayMs,
  isTransientAuthStateStatus,
} from "./auth-state-reliability.js";

let certCache = { certs: null, expiresAt: 0 };
const userStateCache = new Map();
const userStateInflight = new Map();
const authStateBatchQueues = new Map();

const AUTH_STATE_BATCH_MAX = 100;
const AUTH_STATE_BATCH_WINDOW_MS = 10;
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

function sessionTimestampMs(value) {
  if (value && typeof value.toMillis === "function") {
    const ms = Number(value.toMillis());
    return Number.isFinite(ms) ? ms : 0;
  }
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : 0;
  }
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : 0;
}

export function assertUserDocumentSessionState(payload, userData = {}) {
  const status = String(userData?.accountStatus || "active");
  if (status !== "active") throw new Error("unauthorized");

  const revokedAtMs = sessionTimestampMs(userData?.sessionsRevokedAt);
  if (
    revokedAtMs > 0 &&
    Number(payload?.iat || 0) * 1000 <= revokedAtMs
  ) {
    throw new Error("unauthorized");
  }
  return true;
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
  const revokedAtMs = sessionTimestampMs(revokedRaw);
  return {
    active: status === "active",
    revokedAtMs,
    expiresAtMs: nowMs + AUTH_STATE_FRESH_TTL_MS,
    staleUntilMs: nowMs + AUTH_STATE_STALE_TTL_MS,
  };
}

function activeMissingSessionState(nowMs) {
  return {
    active: true,
    revokedAtMs: 0,
    expiresAtMs: nowMs + AUTH_STATE_FRESH_TTL_MS,
    staleUntilMs: nowMs + AUTH_STATE_STALE_TTL_MS,
  };
}

export function parseAuthStateBatchGetResponse(text) {
  const raw = String(text || "").trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }
}

async function fetchAuthStateBatch(uids, env) {
  const uniqueUids = Array.from(
    new Set((uids || []).map((value) => String(value || "").trim()).filter(Boolean)),
  ).slice(0, AUTH_STATE_BATCH_MAX);
  if (!uniqueUids.length) return new Map();

  const { projectId } = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT);
  const token = await googleAccessToken(env);
  const database =
    `projects/${projectId}/databases/(default)`;
  const endpoint =
    `https://firestore.googleapis.com/v1/${database}/documents:batchGet`;
  const names = uniqueUids.map(
    (uid) => `${database}/documents/users/${uid}`,
  );
  const uidByName = new Map(names.map((name, index) => [name, uniqueUids[index]]));

  let response = null;
  let lastError = null;
  for (let attempt = 0; attempt < AUTH_STATE_MAX_ATTEMPTS; attempt += 1) {
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          documents: names,
          mask: { fieldPaths: ["accountStatus", "sessionsRevokedAt"] },
        }),
      });
      lastError = null;
    } catch (error) {
      response = null;
      lastError = error;
    }

    if (response?.ok) break;
    const transient =
      response === null || isTransientAuthStateStatus(response.status);
    if (!transient || attempt >= AUTH_STATE_MAX_ATTEMPTS - 1) break;
    await new Promise((resolve) =>
      setTimeout(resolve, authStateRetryDelayMs(response, attempt)),
    );
  }

  if (!response?.ok) {
    const error = new Error("auth_state_lookup_failed");
    error.cause = lastError;
    error.status = Number(response?.status || 0);
    throw error;
  }

  const rows = parseAuthStateBatchGetResponse(await response.text());
  const nowMs = Date.now();
  const states = new Map();
  const seen = new Set();

  for (const row of rows) {
    const name = String(row?.found?.name || row?.missing || "");
    const uid = uidByName.get(name);
    if (!uid) continue;
    seen.add(uid);
    states.set(
      uid,
      row?.found
        ? buildSessionState(row.found, nowMs)
        : activeMissingSessionState(nowMs),
    );
  }

  if (seen.size !== uniqueUids.length) {
    throw new Error("auth_state_batch_incomplete");
  }
  return states;
}

async function flushAuthStateBatch(projectId, env) {
  const queue = authStateBatchQueues.get(projectId);
  if (!queue || queue.flushing) return;
  queue.flushing = true;
  if (queue.timer) {
    clearTimeout(queue.timer);
    queue.timer = null;
  }

  try {
    while (queue.items.length) {
      const batch = queue.items.splice(0, AUTH_STATE_BATCH_MAX);
      const nowMs = Date.now();
      try {
        const states = await fetchAuthStateBatch(
          batch.map((item) => item.uid),
          env,
        );
        recordAuthStateSuccess();
        for (const item of batch) {
          const state = states.get(item.uid);
          if (!state) {
            item.reject(new Error("auth_state_batch_incomplete"));
            continue;
          }
          userStateCache.set(item.uid, state);
          item.resolve(state);
        }
      } catch (error) {
        recordAuthStateFailure(nowMs);
        for (const item of batch) {
          const stale = cachedStateFor(item.uid, nowMs, { allowStale: true });
          if (stale) item.resolve(stale);
          else item.reject(error);
        }
      }
    }
  } finally {
    queue.flushing = false;
    if (!queue.items.length && !queue.timer) {
      authStateBatchQueues.delete(projectId);
    }
  }
}

async function loadUserSessionState(uid, env) {
  const { projectId } = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT);
  let queue = authStateBatchQueues.get(projectId);
  if (!queue) {
    queue = { items: [], timer: null, flushing: false };
    authStateBatchQueues.set(projectId, queue);
  }

  return new Promise((resolve, reject) => {
    queue.items.push({ uid, resolve, reject });
    if (queue.items.length >= AUTH_STATE_BATCH_MAX) {
      queueMicrotask(() => {
        void flushAuthStateBatch(projectId, env);
      });
      return;
    }
    if (!queue.timer) {
      queue.timer = setTimeout(() => {
        queue.timer = null;
        void flushAuthStateBatch(projectId, env);
      }, AUTH_STATE_BATCH_WINDOW_MS);
    }
  });
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
