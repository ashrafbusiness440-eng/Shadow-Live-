import fs from "node:fs";
import { sign } from "node:crypto";

const workerBase = "https://shadow-live.ashraf-business-440.workers.dev";
let sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
if (typeof sa === "string") sa = JSON.parse(sa);
const { project_id: projectId, client_email: clientEmail, private_key: rawPrivateKey } = sa;
const privateKey = String(rawPrivateKey || "").replace(/\\n/g, "\n");
if (!projectId || !clientEmail || !privateKey) throw new Error("invalid service account");

const firebaseOptions = fs.readFileSync("lib/firebase_options.dart", "utf8");
const apiKey = firebaseOptions.match(/apiKey:\s*'([^']+)'/)?.[1];
if (!apiKey) throw new Error("Firebase API key missing");

const runId = String(process.env.GITHUB_RUN_ID || Date.now());
const senderUid = `__cf_wallet_sender_${runId}`;
const recipientUid = `__cf_wallet_recipient_${runId}`;
const exchangeKey = `cfwallet_exchange_${runId}_${Date.now()}`;
const giftKey = `cfwallet_gift_${runId}_${Date.now()}`;
const password = "ShadowTest_2468";

const b64url = (value) => Buffer.from(value).toString("base64")
  .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "-").replace(/-$/,"");

function b64urlSafe(value) {
  return Buffer.from(value).toString("base64")
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
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
  const header = b64urlSafe(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64urlSafe(JSON.stringify({
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${payload}`;
  const signature = sign("RSA-SHA256", Buffer.from(unsigned), privateKey);
  const assertion = `${unsigned}.${b64urlSafe(signature)}`;
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
  const header = b64urlSafe(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64urlSafe(JSON.stringify({
    iss: clientEmail,
    sub: clientEmail,
    aud: "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit",
    iat: now,
    exp: now + 3600,
    uid,
  }));
  const unsigned = `${header}.${payload}`;
  const signature = sign("RSA-SHA256", Buffer.from(unsigned), privateKey);
  return `${unsigned}.${b64urlSafe(signature)}`;
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
  const res = await fetch(`${workerBase}/api/wallet-actions`, {
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

let senderToken = null;
let recipientToken = null;
const cleanup = new Set([
  `users/${senderUid}`,
  `users/${recipientUid}`,
  `wallet_private/${senderUid}`,
  `wallet_operations/${senderUid}__${exchangeKey}`,
  `wallet_operations/${senderUid}__${giftKey}`,
  `wallet_transfers/${senderUid}__${giftKey}`,
  `financial_ledger/${senderUid}__${exchangeKey}__diamond`,
  `financial_ledger/${senderUid}__${exchangeKey}__coin`,
  `financial_ledger/${senderUid}__${giftKey}__sender`,
  `financial_ledger/${senderUid}__${giftKey}__receiver`,
]);

try {
  await fsSet(`users/${senderUid}`, {
    displayName: "Cloudflare Wallet Sender",
    role: "user",
    adminEnabled: false,
    coins: 100,
    diamonds: 10,
    createdAt: new Date(),
  });
  await fsSet(`users/${recipientUid}`, {
    displayName: "Cloudflare Wallet Recipient",
    role: "user",
    adminEnabled: false,
    coins: 50,
    diamonds: 0,
    createdAt: new Date(),
  });

  senderToken = await firebaseIdToken(senderUid);
  recipientToken = await firebaseIdToken(recipientUid);

  const state1 = await api(senderToken, "state");
  if (!state1.res.ok || state1.body.coins !== 100 || state1.body.diamonds !== 10 ||
      state1.body.passwordSet !== false || state1.body.coinsPerDiamond !== 10000) {
    throw new Error(`wallet state failed: ${state1.res.status} ${JSON.stringify(state1.body)}`);
  }
  console.log("PASS wallet state");

  const setPass = await api(senderToken, "setPassword", { password });
  if (!setPass.res.ok || setPass.body.passwordSet !== true) {
    throw new Error(`set password failed: ${setPass.res.status} ${JSON.stringify(setPass.body)}`);
  }
  console.log("PASS wallet password");

  const exchange = await api(senderToken, "exchangeDiamonds", {
    diamonds: 2,
    password,
    idempotencyKey: exchangeKey,
  });
  if (!exchange.res.ok || exchange.body.diamonds !== 8 || exchange.body.coins !== 20100 ||
      exchange.body.coinsReceived !== 20000) {
    throw new Error(`exchange failed: ${exchange.res.status} ${JSON.stringify(exchange.body)}`);
  }
  console.log("PASS diamond exchange");

  const exchangeDup = await api(senderToken, "exchangeDiamonds", {
    diamonds: 2,
    password,
    idempotencyKey: exchangeKey,
  });
  if (!exchangeDup.res.ok || exchangeDup.body.code !== "duplicate") {
    throw new Error(`exchange idempotency failed: ${exchangeDup.res.status} ${JSON.stringify(exchangeDup.body)}`);
  }
  const senderAfterDup = await fsGet(`users/${senderUid}`);
  if (senderAfterDup?.data?.diamonds !== 8 || senderAfterDup?.data?.coins !== 20100) {
    throw new Error("exchange duplicate mutated balance");
  }
  console.log("PASS exchange idempotency");

  const gift = await api(senderToken, "giftDiamonds", {
    recipientUid,
    diamonds: 1,
    password,
    idempotencyKey: giftKey,
  });
  if (!gift.res.ok || gift.body.diamonds !== 7 || gift.body.coinsReceived !== 10000) {
    throw new Error(`gift failed: ${gift.res.status} ${JSON.stringify(gift.body)}`);
  }
  const recipientAfter = await fsGet(`users/${recipientUid}`);
  if (recipientAfter?.data?.coins !== 10050) {
    throw new Error(`recipient coins mismatch: ${recipientAfter?.data?.coins}`);
  }
  console.log("PASS diamond gift");

  const giftDup = await api(senderToken, "giftDiamonds", {
    recipientUid,
    diamonds: 1,
    password,
    idempotencyKey: giftKey,
  });
  if (!giftDup.res.ok || giftDup.body.code !== "duplicate") {
    throw new Error(`gift idempotency failed: ${giftDup.res.status} ${JSON.stringify(giftDup.body)}`);
  }
  const recipientAfterDup = await fsGet(`users/${recipientUid}`);
  if (recipientAfterDup?.data?.coins !== 10050) {
    throw new Error("gift duplicate mutated recipient balance");
  }
  console.log("PASS gift idempotency");

  console.log("ALL CLOUDFLARE WALLET E2E CHECKS PASSED");
} finally {
  for (const path of [...cleanup].reverse()) {
    try { await fsDelete(path); } catch (error) {
      console.warn(`cleanup warning ${path}: ${error.message}`);
    }
  }
  if (senderToken) await deleteAuthUser(senderToken);
  if (recipientToken) await deleteAuthUser(recipientToken);
}
