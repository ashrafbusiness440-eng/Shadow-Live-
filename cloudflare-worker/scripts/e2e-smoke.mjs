import fs from "node:fs";
import { sign } from "node:crypto";

const workerBase = "https://shadow-live.ashraf-business-440.workers.dev";
const serviceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!serviceAccountRaw) throw new Error("FIREBASE_SERVICE_ACCOUNT missing");

let sa = JSON.parse(serviceAccountRaw);
if (typeof sa === "string") sa = JSON.parse(sa);
const projectId = sa.project_id;
const clientEmail = sa.client_email;
const privateKey = String(sa.private_key || "").replace(/\\n/g, "\n");
if (!projectId || !clientEmail || !privateKey) throw new Error("invalid service account");

const firebaseOptions = fs.readFileSync("lib/firebase_options.dart", "utf8");
const apiKeyMatch = firebaseOptions.match(/apiKey:\s*'([^']+)'/);
if (!apiKeyMatch) throw new Error("Firebase web API key not found");
const apiKey = apiKeyMatch[1];

const runId = String(process.env.GITHUB_RUN_ID || Date.now());
const actorUid = `__cf_migration_actor_${runId}`;
const targetUid = `__cf_migration_target_${runId}`;
const balKey = `cfbal_${runId}_${Date.now()}`;
const idKey = `cfid_${runId}_${Date.now()}`;

function b64url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function encodeValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } };
  if (typeof value === "object") {
    return {
      mapValue: {
        fields: Object.fromEntries(
          Object.entries(value).map(([k, v]) => [k, encodeValue(v)]),
        ),
      },
    };
  }
  return { stringValue: String(value) };
}

function decodeValue(value) {
  if (!value) return null;
  if ("nullValue" in value) return null;
  if ("booleanValue" in value) return value.booleanValue;
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("timestampValue" in value) return value.timestampValue;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(decodeValue);
  if ("mapValue" in value) return decodeFields(value.mapValue.fields || {});
  return null;
}
function decodeFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, decodeValue(v)]));
}
function encodeFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, encodeValue(v)]));
}

async function googleToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${payload}`;
  const signature = sign("RSA-SHA256", Buffer.from(unsigned), privateKey);
  const assertion = `${unsigned}.${b64url(signature)}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const body = await res.json();
  if (!res.ok || !body.access_token) throw new Error(`google oauth failed ${res.status}`);
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
  const unsigned = `${header}.${payload}`;
  const signature = sign("RSA-SHA256", Buffer.from(unsigned), privateKey);
  return `${unsigned}.${b64url(signature)}`;
}

async function firebaseIdToken(uid) {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: customToken(uid), returnSecureToken: true }),
    },
  );
  const body = await res.json();
  if (!res.ok || !body.idToken) {
    throw new Error(`custom-token exchange failed: ${res.status} ${JSON.stringify(body)}`);
  }
  return body.idToken;
}

const accessToken = await googleToken();
const firestoreRoot = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)`;
const docRoot = `${firestoreRoot}/documents`;

async function fsSet(path, fields) {
  const res = await fetch(`${docRoot}/${path}`, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ fields: encodeFields(fields) }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`fsSet ${path} failed: ${res.status} ${JSON.stringify(body)}`);
  return body;
}

async function fsGet(path) {
  const res = await fetch(`${docRoot}/${path}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 404) return null;
  const body = await res.json();
  if (!res.ok) throw new Error(`fsGet ${path} failed: ${res.status} ${JSON.stringify(body)}`);
  return { ...body, data: decodeFields(body.fields || {}) };
}

async function fsDelete(path) {
  const res = await fetch(`${docRoot}/${path}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok && res.status !== 404) {
    const body = await res.text();
    throw new Error(`fsDelete ${path} failed: ${res.status} ${body}`);
  }
}

async function auditDocs(operationId) {
  const res = await fetch(`${firestoreRoot}/documents:runQuery`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "admin_audit_logs" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "operationId" },
            op: "EQUAL",
            value: { stringValue: operationId },
          },
        },
        limit: 10,
      },
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`audit query failed: ${res.status}`);
  return body
    .map((row) => row.document?.name)
    .filter(Boolean)
    .map((name) => name.split("/documents/")[1]);
}

async function pickIds() {
  for (let i = 0; i < 10; i++) {
    const seed = String(Math.floor(Math.random() * 90_000_000) + 10_000_000);
    const oldId = `97${seed}`;
    const newId = `98${seed}`;
    const [oldDoc, newDoc, roomDoc] = await Promise.all([
      fsGet(`public_ids/${oldId}`),
      fsGet(`public_ids/${newId}`),
      fsGet(`room_ids/${newId}`),
    ]);
    if (!oldDoc && !newDoc && !roomDoc) return { oldId, newId };
  }
  throw new Error("could not allocate test public IDs");
}

async function workerJson(path, options = {}) {
  const res = await fetch(`${workerBase}${path}`, options);
  const body = await res.json().catch(() => ({}));
  return { res, body };
}

let idToken = null;
let oldId = null;
let newId = null;
const cleanup = new Set();

try {
  const health = await workerJson("/health");
  if (!health.res.ok || health.body.ok !== true || health.body.firebaseConfigured !== true) {
    throw new Error(`health failed: ${health.res.status} ${JSON.stringify(health.body)}`);
  }
  console.log("PASS health");

  const preflight = await fetch(`${workerBase}/api/adjust-balance`, {
    method: "OPTIONS",
    headers: {
      Origin: "https://ashrafbusiness440-eng.github.io",
      "Access-Control-Request-Method": "POST",
    },
  });
  if (preflight.status !== 204 ||
      preflight.headers.get("access-control-allow-origin") !== "https://ashrafbusiness440-eng.github.io") {
    throw new Error("CORS preflight failed");
  }
  console.log("PASS CORS");

  const assets = await workerJson("/api/app-assets");
  if (!assets.res.ok || assets.body.ok !== true || !Array.isArray(assets.body.assets)) {
    throw new Error(`app-assets failed: ${assets.res.status} ${JSON.stringify(assets.body)}`);
  }
  console.log(`PASS app-assets (${assets.body.assets.length} published assets)`);

  const unauth = await workerJson("/api/adjust-balance", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      targetId: "nobody",
      asset: "coins",
      delta: 1,
      reason: "migration test",
      idempotencyKey: `cfunauth_${runId}_123456`,
    }),
  });
  if (unauth.res.status !== 401 || unauth.body.code !== "unauthorized") {
    throw new Error(`unauthorized guard failed: ${unauth.res.status} ${JSON.stringify(unauth.body)}`);
  }
  console.log("PASS unauthorized guard");

  ({ oldId, newId } = await pickIds());

  await fsSet(`users/${actorUid}`, {
    displayName: "Cloudflare Migration Test Actor",
    role: "admin",
    adminEnabled: true,
    capabilities: ["adjustBalances", "manageIds"],
    publicId: "9900000001",
    createdAt: new Date(),
  });
  cleanup.add(`users/${actorUid}`);

  await fsSet(`users/${targetUid}`, {
    displayName: "Cloudflare Migration Test Target",
    username: "cf_migration_target",
    role: "user",
    adminEnabled: false,
    capabilities: [],
    coins: 1000,
    diamonds: 5,
    publicId: oldId,
    createdAt: new Date(),
  });
  cleanup.add(`users/${targetUid}`);

  await fsSet(`public_profiles/${targetUid}`, {
    displayName: "Cloudflare Migration Test Target",
    username: "cf_migration_target",
    publicId: oldId,
    searchTokens: [oldId],
  });
  cleanup.add(`public_profiles/${targetUid}`);

  await fsSet(`public_ids/${oldId}`, {
    uid: targetUid,
    source: "migrationTest",
    createdAt: new Date(),
  });
  cleanup.add(`public_ids/${oldId}`);
  cleanup.add(`public_ids/${newId}`);

  idToken = await firebaseIdToken(actorUid);

  const adjusted = await workerJson("/api/adjust-balance", {
    method: "POST",
    headers: {
      authorization: `Bearer ${idToken}`,
      "content-type": "application/json",
      origin: "https://ashrafbusiness440-eng.github.io",
    },
    body: JSON.stringify({
      targetId: targetUid,
      asset: "coins",
      delta: 123,
      reason: "Cloudflare migration E2E",
      idempotencyKey: balKey,
    }),
  });
  if (!adjusted.res.ok || adjusted.body.ok !== true ||
      adjusted.body.before !== 1000 || adjusted.body.after !== 1123) {
    throw new Error(`adjust-balance failed: ${adjusted.res.status} ${JSON.stringify(adjusted.body)}`);
  }
  cleanup.add(`control_operations/${balKey}`);
  cleanup.add(`financial_ledger/${balKey}`);
  console.log("PASS adjust-balance");

  const duplicate = await workerJson("/api/adjust-balance", {
    method: "POST",
    headers: {
      authorization: `Bearer ${idToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      targetId: targetUid,
      asset: "coins",
      delta: 123,
      reason: "Cloudflare migration E2E",
      idempotencyKey: balKey,
    }),
  });
  if (!duplicate.res.ok || duplicate.body.code !== "duplicate") {
    throw new Error(`idempotency failed: ${duplicate.res.status} ${JSON.stringify(duplicate.body)}`);
  }
  const afterDuplicate = await fsGet(`users/${targetUid}`);
  if (afterDuplicate?.data?.coins !== 1123) {
    throw new Error("duplicate request changed balance");
  }
  console.log("PASS idempotency");

  const changed = await workerJson("/api/change-public-id", {
    method: "POST",
    headers: {
      authorization: `Bearer ${idToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      currentId: oldId,
      newId,
      reason: "Cloudflare migration E2E",
      idempotencyKey: idKey,
    }),
  });
  if (!changed.res.ok || changed.body.ok !== true || changed.body.after !== newId) {
    throw new Error(`change-public-id failed: ${changed.res.status} ${JSON.stringify(changed.body)}`);
  }
  cleanup.add(`control_operations/${idKey}`);
  console.log("PASS change-public-id");

  const permissionDenied = await workerJson("/api/set-id-management-permission", {
    method: "POST",
    headers: {
      authorization: `Bearer ${idToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      targetUid,
      enabled: true,
      reason: "Cloudflare migration E2E",
      idempotencyKey: `cfperm_${runId}_${Date.now()}`,
    }),
  });
  if (permissionDenied.res.status !== 403 || permissionDenied.body.code !== "forbidden") {
    throw new Error(`owner guard failed: ${permissionDenied.res.status} ${JSON.stringify(permissionDenied.body)}`);
  }
  console.log("PASS owner-only permission guard");

  console.log("ALL CLOUDFLARE BATCH-1 E2E CHECKS PASSED");
} finally {
  for (const opId of [balKey, idKey]) {
    try {
      for (const path of await auditDocs(opId)) cleanup.add(path);
    } catch (error) {
      console.warn(`audit cleanup lookup warning: ${error.message}`);
    }
  }

  for (const path of [...cleanup].reverse()) {
    try { await fsDelete(path); }
    catch (error) { console.warn(`cleanup warning ${path}: ${error.message}`); }
  }

  if (idToken) {
    try {
      await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${encodeURIComponent(apiKey)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ idToken }),
        },
      );
    } catch (error) {
      console.warn(`auth cleanup warning: ${error.message}`);
    }
  }
}
