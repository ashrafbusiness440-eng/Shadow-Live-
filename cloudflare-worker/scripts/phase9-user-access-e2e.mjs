import fs from "node:fs";
import { sign } from "node:crypto";
import { firestoreE2eFetch, sleep } from "./firestore-e2e-retry.mjs";

const base = "https://shadow-live.ashraf-business-440.workers.dev";
let sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
if (typeof sa === "string") sa = JSON.parse(sa);
const projectId = sa.project_id;
const clientEmail = sa.client_email;
const privateKey = String(sa.private_key || "").replace(/\\n/g, "\n");
if (!projectId || !clientEmail || !privateKey) throw Error("invalid service account");

const firebaseOptions = fs.readFileSync("lib/firebase_options.dart", "utf8");
const apiKey = firebaseOptions.match(/apiKey:\s*'([^']+)'/)?.[1];
if (!apiKey) throw Error("Firebase API key missing");

const runId = String(process.env.GITHUB_RUN_ID || Date.now());
const actorUid = "__cf_access_owner_" + runId;
const targetUid = "__cf_access_target_" + runId;
const protectedUid = "__cf_access_protected_" + runId;
const key = "accessgrant_" + runId;
const protectedKey = "accessprotect_" + runId;

function b64url(value) {
  return Buffer.from(value).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function encodeValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } };
  if (typeof value === "object") return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encodeValue(v)])) } };
  return { stringValue: String(value) };
}
function encodeFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, encodeValue(v)]));
}
function decodeValue(value) {
  if (!value || typeof value !== "object") return null;
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("booleanValue" in value) return value.booleanValue;
  if ("timestampValue" in value) return value.timestampValue;
  if ("nullValue" in value) return null;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(decodeValue);
  if ("mapValue" in value) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([k, v]) => [k, decodeValue(v)]));
  return null;
}
function decodeFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, decodeValue(v)]));
}

async function googleAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = header + "." + payload;
  const assertion = unsigned + "." + b64url(sign("RSA-SHA256", Buffer.from(unsigned), privateKey));
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const body = await response.json();
  if (!response.ok || !body.access_token) throw Error("google oauth failed");
  return body.access_token;
}

function customToken(uid) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({
    iss: clientEmail,
    sub: clientEmail,
    aud: "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit",
    iat: now,
    exp: now + 3600,
    uid,
  }));
  const unsigned = header + "." + payload;
  return unsigned + "." + b64url(sign("RSA-SHA256", Buffer.from(unsigned), privateKey));
}

async function firebaseIdToken(uid) {
  const response = await fetch(
    "https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=" + encodeURIComponent(apiKey),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: customToken(uid), returnSecureToken: true }),
    },
  );
  const body = await response.json();
  if (!response.ok || !body.idToken) throw Error("token exchange failed " + response.status);
  return body.idToken;
}

async function deleteAuthUser(idToken) {
  if (!idToken) return;
  const response = await fetch(
    "https://identitytoolkit.googleapis.com/v1/accounts:delete?key=" + encodeURIComponent(apiKey),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken }),
    },
  );
  if (!response.ok) throw Error("delete auth failed " + response.status);
}

const accessToken = await googleAccessToken();
const root = "https://firestore.googleapis.com/v1/projects/" + projectId + "/databases/(default)/documents";

async function fsSet(path, fields) {
  const response = await firestoreE2eFetch(root + "/" + path, {
    method: "PATCH",
    headers: { authorization: "Bearer " + accessToken, "content-type": "application/json" },
    body: JSON.stringify({ fields: encodeFields(fields) }),
  });
  if (!response.ok) throw Error("fsSet " + path + " " + response.status + " " + await response.text());
}
async function fsGet(path) {
  const response = await firestoreE2eFetch(root + "/" + path, { headers: { authorization: "Bearer " + accessToken } });
  if (response.status === 404) return null;
  const body = await response.json();
  if (!response.ok) throw Error("fsGet " + path + " " + response.status);
  return decodeFields(body.fields || {});
}
async function fsDelete(path) {
  const response = await firestoreE2eFetch(root + "/" + path, { method: "DELETE", headers: { authorization: "Bearer " + accessToken } });
  if (!response.ok && response.status !== 404) throw Error("fsDelete " + path + " " + response.status);
}
async function api(idToken, body) {
  const response = await fetch(base + "/api/manage-user-access", {
    method: "POST",
    headers: {
      authorization: "Bearer " + idToken,
      "content-type": "application/json",
      origin: "https://ashrafbusiness440-eng.github.io",
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

let actorToken = null;
try {
  await fsSet("users/" + actorUid, {
    displayName: "Access E2E Owner",
    role: "owner",
    adminEnabled: true,
    capabilities: [],
    coins: 0,
    diamonds: 0,
  });
  await fsSet("users/" + targetUid, {
    displayName: "Access E2E Target",
    role: "user",
    adminEnabled: false,
    capabilities: [],
    coins: 0,
    diamonds: 0,
  });
  await fsSet("users/" + protectedUid, {
    displayName: "Access E2E Protected Owner",
    role: "owner",
    adminEnabled: true,
    capabilities: [],
    coins: 0,
    diamonds: 0,
  });

  actorToken = await firebaseIdToken(actorUid);
  await sleep(750);

  const unauthorized = await fetch(base + "/api/manage-user-access", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  if (unauthorized.status !== 401) throw Error("unauthorized guard failed");
  console.log("PASS unauthorized guard");

  const grant = await api(actorToken, {
    targetUid,
    role: "admin",
    adminEnabled: true,
    capabilities: ["viewUsers", "manageRooms", "manageIds", "adjustBalances"],
    reason: "Phase 9 user access E2E",
    idempotencyKey: key,
  });
  if (!grant.response.ok || grant.data?.ok !== true || grant.data?.role !== "admin") {
    throw Error("grant failed " + grant.response.status + " " + JSON.stringify(grant.data));
  }
  const target = await fsGet("users/" + targetUid);
  if (
    target?.role !== "admin" ||
    target?.adminEnabled !== true ||
    !Array.isArray(target?.capabilities) ||
    !target.capabilities.includes("manageRooms") ||
    !target.capabilities.includes("adjustBalances")
  ) {
    throw Error("target access state mismatch " + JSON.stringify(target));
  }
  console.log("PASS role + capabilities update");

  const duplicate = await api(actorToken, {
    targetUid,
    role: "admin",
    adminEnabled: true,
    capabilities: ["viewUsers", "manageRooms", "manageIds", "adjustBalances"],
    reason: "Phase 9 user access E2E",
    idempotencyKey: key,
  });
  if (!duplicate.response.ok || duplicate.data?.code !== "duplicate") {
    throw Error("idempotency failed " + duplicate.response.status + " " + JSON.stringify(duplicate.data));
  }
  console.log("PASS idempotency");

  const protectedResult = await api(actorToken, {
    targetUid: protectedUid,
    role: "user",
    adminEnabled: false,
    capabilities: [],
    reason: "Owner protection E2E",
    idempotencyKey: protectedKey,
  });
  if (protectedResult.response.status !== 409 || protectedResult.data?.code !== "owner_protected") {
    throw Error("owner protection failed " + protectedResult.response.status + " " + JSON.stringify(protectedResult.data));
  }
  console.log("PASS owner protection");

  const invalid = await api(actorToken, {
    targetUid,
    role: "admin",
    adminEnabled: true,
    capabilities: ["__not_real__"],
    reason: "Invalid capability E2E",
    idempotencyKey: "accessinvalid_" + runId,
  });
  if (invalid.response.status !== 400 || invalid.data?.code !== "invalid_capability") {
    throw Error("invalid capability guard failed " + invalid.response.status + " " + JSON.stringify(invalid.data));
  }
  console.log("PASS capability allowlist");

  console.log("ALL PHASE 9 USER ACCESS E2E CHECKS PASSED");
} finally {
  const cleanup = [
    "admin_audit_logs/admin_" + key,
    "control_operations/" + key,
    "users/" + targetUid,
    "users/" + protectedUid,
    "users/" + actorUid,
  ];
  const errors = [];
  for (const path of cleanup) {
    try { await fsDelete(path); } catch (error) { errors.push(String(error?.message || error)); }
  }
  try { await deleteAuthUser(actorToken); } catch (error) { errors.push(String(error?.message || error)); }
  if (errors.length) throw Error("cleanup failed: " + errors.join(" | "));
}
