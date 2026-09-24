import fs from "node:fs";
import { sign } from "node:crypto";

const workerBase = "https://shadow-live.ashraf-business-440.workers.dev";
let sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
if (typeof sa === "string") sa = JSON.parse(sa);
const projectId = sa.project_id;
const clientEmail = sa.client_email;
const privateKey = String(sa.private_key || "").replace(/\\n/g, "\n");
if (!projectId || !clientEmail || !privateKey) throw new Error("invalid service account");

const firebaseOptions = fs.readFileSync("lib/firebase_options.dart", "utf8");
const apiKey = firebaseOptions.match(/apiKey:\s*'([^']+)'/)?.[1];
if (!apiKey) throw new Error("Firebase API key missing");

const runId = String(process.env.GITHUB_RUN_ID || Date.now());
const reporterUid = `__cf_chat_reporter_${runId}`;
const targetUid = `__cf_chat_target_${runId}`;
const conversationId = `cf_chat_conv_${runId}`;
const reportKey = `cfreport_${runId}_${Date.now()}`;

function b64url(value) {
  return Buffer.from(value).toString("base64")
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function encodeValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "number") return Number.isInteger(value)
    ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } };
  if (typeof value === "object") {
    return { mapValue: { fields: Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, encodeValue(v)]),
    ) } };
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
  if (!res.ok || !body.access_token) throw new Error("google oauth failed");
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
  if (!res.ok || !body.idToken) throw new Error(`token exchange failed ${res.status}`);
  return body.idToken;
}

const accessToken = await googleAccessToken();
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
  if (!res.ok) throw new Error(`fsSet failed ${path}: ${res.status}`);
}
async function fsGet(path) {
  const res = await fetch(`${docRoot}/${path}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 404) return null;
  const body = await res.json();
  if (!res.ok) throw new Error(`fsGet failed ${path}: ${res.status}`);
  return { data: decodeFields(body.fields || {}) };
}
async function fsDelete(path) {
  const res = await fetch(`${docRoot}/${path}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok && res.status !== 404) throw new Error(`fsDelete failed ${path}: ${res.status}`);
}
async function api(idToken, action, extra = {}) {
  const res = await fetch(`${workerBase}/api/chat-actions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${idToken}`,
      "content-type": "application/json",
      origin: "https://ashrafbusiness440-eng.github.io",
    },
    body: JSON.stringify({ action, ...extra }),
  });
  const body = await res.json().catch(() => ({}));
  return { res, body };
}
async function deleteAuthUser(idToken) {
  await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken }),
    },
  ).catch(() => {});
}

let idToken = null;
const paths = [
  `users/${reporterUid}`,
  `users/${targetUid}`,
  `conversations/${conversationId}`,
  `follows/${reporterUid}__${targetUid}`,
  `follows/${targetUid}__${reporterUid}`,
  `user_blocks/${reporterUid}/items/${targetUid}`,
  `report_rate_limits/${reporterUid}`,
  `report_operations/${reportKey}`,
  `reports/report_${reportKey}`,
];

try {
  await fsSet(`users/${reporterUid}`, {
    displayName: "Cloudflare Chat Reporter",
    role: "user",
    createdAt: new Date(),
  });
  await fsSet(`users/${targetUid}`, {
    displayName: "Cloudflare Chat Target",
    role: "user",
    createdAt: new Date(),
  });
  await fsSet(`conversations/${conversationId}`, {
    participants: [reporterUid, targetUid],
    unreadCounts: { [reporterUid]: 0, [targetUid]: 0 },
    createdAt: new Date(),
  });
  await fsSet(`follows/${reporterUid}__${targetUid}`, {
    followerUid: reporterUid,
    followingUid: targetUid,
    createdAt: new Date(),
  });
  await fsSet(`follows/${targetUid}__${reporterUid}`, {
    followerUid: targetUid,
    followingUid: reporterUid,
    createdAt: new Date(),
  });

  idToken = await firebaseIdToken(reporterUid);

  const initial = await api(idToken, "safetyStatus", { targetUserId: targetUid });
  if (!initial.res.ok || initial.body.blocked !== false) {
    throw new Error(`initial safety failed: ${initial.res.status} ${JSON.stringify(initial.body)}`);
  }
  console.log("PASS initial safety status");

  const block = await api(idToken, "setBlock", { targetUserId: targetUid, blocked: true });
  if (!block.res.ok || block.body.blocked !== true) {
    throw new Error(`block failed: ${block.res.status} ${JSON.stringify(block.body)}`);
  }
  const [outFollow, inFollow, blockDoc] = await Promise.all([
    fsGet(`follows/${reporterUid}__${targetUid}`),
    fsGet(`follows/${targetUid}__${reporterUid}`),
    fsGet(`user_blocks/${reporterUid}/items/${targetUid}`),
  ]);
  if (outFollow || inFollow || !blockDoc) {
    throw new Error("blocking did not remove mutual follows or create block");
  }
  console.log("PASS block + follow cleanup");

  const blockedStatus = await api(idToken, "safetyStatus", { targetUserId: targetUid });
  if (!blockedStatus.res.ok || blockedStatus.body.blocked !== true ||
      blockedStatus.body.blockedByMe !== true) {
    throw new Error(`blocked safety failed: ${blockedStatus.res.status} ${JSON.stringify(blockedStatus.body)}`);
  }
  console.log("PASS blocked safety status");

  const unblock = await api(idToken, "setBlock", { targetUserId: targetUid, blocked: false });
  if (!unblock.res.ok || unblock.body.blocked !== false) {
    throw new Error(`unblock failed: ${unblock.res.status} ${JSON.stringify(unblock.body)}`);
  }
  if (await fsGet(`user_blocks/${reporterUid}/items/${targetUid}`)) {
    throw new Error("block document still exists after unblock");
  }
  console.log("PASS unblock");

  const report = await api(idToken, "reportUser", {
    targetUserId: targetUid,
    conversationId,
    reason: "spam",
    details: "Cloudflare migration E2E report",
    idempotencyKey: reportKey,
  });
  if (!report.res.ok || report.body.ok !== true ||
      report.body.reportId !== `report_${reportKey}`) {
    throw new Error(`report failed: ${report.res.status} ${JSON.stringify(report.body)}`);
  }
  console.log("PASS report user");

  const reportDup = await api(idToken, "reportUser", {
    targetUserId: targetUid,
    conversationId,
    reason: "spam",
    details: "Cloudflare migration E2E report",
    idempotencyKey: reportKey,
  });
  if (!reportDup.res.ok || reportDup.body.code !== "duplicate") {
    throw new Error(`report idempotency failed: ${reportDup.res.status} ${JSON.stringify(reportDup.body)}`);
  }
  const rate = await fsGet(`report_rate_limits/${reporterUid}`);
  if (rate?.data?.count !== 1) throw new Error("duplicate report changed rate count");
  console.log("PASS report idempotency");

  const invalidAction = await api(idToken, "__phase8_unknown_action__", {});
  if (invalidAction.res.status !== 400 || invalidAction.body.code !== "invalid_action") {
    throw new Error(`unknown chat action guard failed: ${invalidAction.res.status} ${JSON.stringify(invalidAction.body)}`);
  }
  console.log("PASS unknown-action guard");

  console.log("ALL CLOUDFLARE CHAT SAFETY E2E CHECKS PASSED");
} finally {
  for (const path of paths.reverse()) {
    try { await fsDelete(path); } catch (error) {
      console.warn(`cleanup warning ${path}: ${error.message}`);
    }
  }
  if (idToken) await deleteAuthUser(idToken);
}
