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
const actorUid = "__cf_moderation_owner_" + runId;
const targetUid = "__cf_moderation_target_" + runId;
const keys = {
  suspend: "modsuspend_" + runId,
  enable: "modenable_" + runId,
  revoke: "modrevoke_" + runId,
  delete: "moddelete_" + runId,
};

function b64url(value) {
  return Buffer.from(value).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function encodeValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "number") return Number.isInteger(value)
    ? { integerValue: String(value) }
    : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } };
  if (typeof value === "object") {
    return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encodeValue(v)])) } };
  }
  return { stringValue: String(value) };
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
  if ("mapValue" in value) return Object.fromEntries(
    Object.entries(value.mapValue.fields || {}).map(([k, v]) => [k, decodeValue(v)]),
  );
  return null;
}
const encodeFields = (fields = {}) =>
  Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, encodeValue(v)]));
const decodeFields = (fields = {}) =>
  Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, decodeValue(v)]));

async function googleAccessToken(scope) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({
    iss: clientEmail,
    scope,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = header + "." + payload;
  const assertion = unsigned + "." + b64url(sign("RSA-SHA256", Buffer.from(unsigned), privateKey));
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const body = await response.json();
  if (!response.ok || !body.access_token) throw Error("google oauth failed " + response.status);
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

async function firebaseIdToken(uid, { expectDisabled = false } = {}) {
  const response = await fetch(
    "https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=" + encodeURIComponent(apiKey),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: customToken(uid), returnSecureToken: true }),
    },
  );
  const body = await response.json().catch(() => ({}));
  if (expectDisabled) {
    const message = JSON.stringify(body);
    if (response.ok || !/USER_DISABLED/i.test(message)) {
      throw Error("expected USER_DISABLED but got " + response.status + " " + message);
    }
    return null;
  }
  if (!response.ok || !body.idToken) {
    throw Error("token exchange failed " + response.status + " " + JSON.stringify(body));
  }
  return body.idToken;
}

const datastoreToken = await googleAccessToken("https://www.googleapis.com/auth/datastore");
const identityToken = await googleAccessToken("https://www.googleapis.com/auth/identitytoolkit");
const root = "https://firestore.googleapis.com/v1/projects/" + projectId + "/databases/(default)/documents";

async function fsSet(path, fields) {
  const response = await firestoreE2eFetch(root + "/" + path, {
    method: "PATCH",
    headers: { authorization: "Bearer " + datastoreToken, "content-type": "application/json" },
    body: JSON.stringify({ fields: encodeFields(fields) }),
  });
  if (!response.ok) throw Error("fsSet " + path + " " + response.status + " " + await response.text());
}

async function fsGet(path) {
  const response = await firestoreE2eFetch(root + "/" + path, {
    headers: { authorization: "Bearer " + datastoreToken },
  });
  if (response.status === 404) return null;
  const body = await response.json();
  if (!response.ok) throw Error("fsGet " + path + " " + response.status);
  return decodeFields(body.fields || {});
}

async function fsDelete(path) {
  const response = await firestoreE2eFetch(root + "/" + path, {
    method: "DELETE",
    headers: { authorization: "Bearer " + datastoreToken },
  });
  if (!response.ok && response.status !== 404) {
    throw Error("fsDelete " + path + " " + response.status);
  }
}

async function authLookup(uid) {
  const response = await fetch(
    "https://identitytoolkit.googleapis.com/v1/projects/" +
      encodeURIComponent(projectId) +
      "/accounts:lookup",
    {
      method: "POST",
      headers: {
        authorization: "Bearer " + identityToken,
        "content-type": "application/json",
      },
      body: JSON.stringify({ localId: [uid] }),
    },
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Error("authLookup " + response.status + " " + JSON.stringify(body));
  return Array.isArray(body.users) ? body.users[0] || null : null;
}

async function deleteAuthWithIdToken(idToken) {
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

async function moderationApi(actorToken, accountAction, reason, key, extra = {}) {
  const response = await fetch(base + "/api/manage-user-account", {
    method: "POST",
    headers: {
      authorization: "Bearer " + actorToken,
      "content-type": "application/json",
      origin: "https://ashrafbusiness440-eng.github.io",
    },
    body: JSON.stringify({
      targetUid,
      accountAction,
      reason,
      idempotencyKey: key,
      ...extra,
    }),
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function workerAuthProbe(idToken) {
  const response = await fetch(base + "/api/manage-user-access", {
    method: "POST",
    headers: {
      authorization: "Bearer " + idToken,
      "content-type": "application/json",
      origin: "https://ashrafbusiness440-eng.github.io",
    },
    body: JSON.stringify({
      targetUid: actorUid,
      role: "user",
      adminEnabled: false,
      capabilities: [],
      reason: "moderation auth probe",
      idempotencyKey: "modprobe_" + runId,
    }),
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

let actorToken = null;
let targetToken = null;
let latestTargetToken = null;

try {
  await fsSet("users/" + actorUid, {
    displayName: "Moderation E2E Owner",
    role: "owner",
    adminEnabled: true,
    capabilities: [],
    coins: 0,
    diamonds: 0,
  });
  await fsSet("users/" + targetUid, {
    displayName: "Moderation E2E Target",
    role: "user",
    adminEnabled: false,
    capabilities: [],
    coins: 0,
    diamonds: 0,
  });

  actorToken = await firebaseIdToken(actorUid);
  await sleep(750);
  targetToken = await firebaseIdToken(targetUid);

  const suspend = await moderationApi(
    actorToken,
    "suspend",
    "temporary suspension E2E",
    keys.suspend,
    { durationMinutes: 10 },
  );
  if (!suspend.response.ok || suspend.data?.accountStatus !== "suspended") {
    throw Error("suspend failed " + suspend.response.status + " " + JSON.stringify(suspend.data));
  }
  const suspendedDoc = await fsGet("users/" + targetUid);
  if (suspendedDoc?.accountStatus !== "suspended" || !suspendedDoc?.suspendedUntil) {
    throw Error("suspend firestore mismatch " + JSON.stringify(suspendedDoc));
  }
  const suspendedLoginToken = await firebaseIdToken(targetUid);
  await new Promise((resolve) => setTimeout(resolve, 5500));
  const deniedWhileSuspended = await workerAuthProbe(suspendedLoginToken);
  if (deniedWhileSuspended.response.status !== 401) {
    throw Error("suspended worker token was not denied " + deniedWhileSuspended.response.status);
  }
  console.log("PASS suspend + readable auth session + worker/account-status denial");

  const enable = await moderationApi(
    actorToken,
    "enable",
    "restore account E2E",
    keys.enable,
  );
  if (!enable.response.ok || enable.data?.accountStatus !== "active") {
    throw Error("enable failed " + enable.response.status + " " + JSON.stringify(enable.data));
  }
  await new Promise((resolve) => setTimeout(resolve, 1500));
  latestTargetToken = await firebaseIdToken(targetUid);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const enabledProbe = await workerAuthProbe(latestTargetToken);
  if (enabledProbe.response.status !== 403) {
    throw Error("enabled token should reach authorization layer and get 403, got " + enabledProbe.response.status);
  }
  console.log("PASS enable + fresh sign-in");

  const revoke = await moderationApi(
    actorToken,
    "revokeSessions",
    "session revoke E2E",
    keys.revoke,
  );
  if (!revoke.response.ok) {
    throw Error("revoke failed " + revoke.response.status + " " + JSON.stringify(revoke.data));
  }
  await new Promise((resolve) => setTimeout(resolve, 5500));
  const revokedProbe = await workerAuthProbe(latestTargetToken);
  if (revokedProbe.response.status !== 401) {
    throw Error("revoked token was not denied " + revokedProbe.response.status);
  }
  console.log("PASS session revocation");

  const remove = await moderationApi(
    actorToken,
    "deleteAccount",
    "delete account E2E",
    keys.delete,
  );
  if (!remove.response.ok || remove.data?.accountStatus !== "deleted" || remove.data?.authDeleted !== true) {
    throw Error("delete failed " + remove.response.status + " " + JSON.stringify(remove.data));
  }
  const deletedDoc = await fsGet("users/" + targetUid);
  if (deletedDoc?.accountStatus !== "deleted" || deletedDoc?.authDeleted !== true) {
    throw Error("deleted firestore mismatch " + JSON.stringify(deletedDoc));
  }
  const deletedAuth = await authLookup(targetUid);
  if (deletedAuth) throw Error("Firebase Auth target still exists after delete");
  console.log("PASS permanent account deletion + audit-preserving Firestore tombstone");

  console.log("ALL PHASE 9 USER MODERATION E2E CHECKS PASSED");
} finally {
  const cleanup = [
    "admin_audit_logs/account_" + keys.suspend,
    "admin_audit_logs/account_" + keys.enable,
    "admin_audit_logs/account_" + keys.revoke,
    "admin_audit_logs/account_" + keys.delete,
    "control_operations/" + keys.suspend,
    "control_operations/" + keys.enable,
    "control_operations/" + keys.revoke,
    "control_operations/" + keys.delete,
    "users/" + targetUid,
    "users/" + actorUid,
  ];
  const errors = [];
  for (const path of cleanup) {
    try { await fsDelete(path); } catch (error) { errors.push(String(error?.message || error)); }
  }
  try { await deleteAuthWithIdToken(actorToken); } catch (error) { errors.push(String(error?.message || error)); }
  if (errors.length) throw Error("cleanup failed: " + errors.join(" | "));
}
