import fs from "node:fs";
import { createHash, sign } from "node:crypto";

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
const uid = `__cf_play_user_${runId}`;
const fakeToken = `cf_fake_purchase_token_${runId}_abcdefghijklmnopqrstuvwxyz1234567890`;
const hash = createHash("sha256").update(fakeToken).digest("hex");
const knownProduct = "shadow_coins_099";

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
  const issued = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    iat: issued,
    exp: issued + 3600,
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

function customToken(uidValue) {
  const issued = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({
    iss: clientEmail,
    sub: clientEmail,
    aud: "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit",
    iat: issued,
    exp: issued + 3600,
    uid: uidValue,
  }));
  const unsigned = `${header}.${payload}`;
  const signature = sign("RSA-SHA256", Buffer.from(unsigned), privateKey);
  return `${unsigned}.${b64url(signature)}`;
}

async function firebaseIdToken(uidValue) {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: customToken(uidValue), returnSecureToken: true }),
    },
  );
  const body = await res.json();
  if (!res.ok || !body.idToken) throw new Error(`token exchange failed ${res.status}`);
  return body.idToken;
}

const accessToken = await googleAccessToken();
const docRoot =
  `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

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
  if (!res.ok && res.status !== 404) {
    throw new Error(`fsDelete failed ${path}: ${res.status}`);
  }
}

async function api(idToken, payload) {
  const res = await fetch(`${workerBase}/api/google-play-purchase`, {
    method: "POST",
    headers: {
      ...(idToken ? { authorization: `Bearer ${idToken}` } : {}),
      "content-type": "application/json",
      origin: "https://ashrafbusiness440-eng.github.io",
    },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  return { res, body };
}

async function waitForRoute() {
  for (let i = 0; i < 20; i++) {
    const res = await fetch(`${workerBase}/api/google-play-purchase`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    if (res.status !== 404) return;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error("google-play-purchase route did not become active");
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
const cleanup = [
  `financial_ledger/play_${hash}`,
  `google_play_purchases/${hash}`,
  `users/${uid}`,
];

try {
  await waitForRoute();

  const noAuth = await api(null, {
    productId: knownProduct,
    purchaseToken: fakeToken,
  });
  if (noAuth.res.status !== 401 || noAuth.body.code !== "unauthorized") {
    throw new Error(`unauthorized guard failed: ${noAuth.res.status} ${JSON.stringify(noAuth.body)}`);
  }
  console.log("PASS Google Play unauthorized guard");

  await fsSet(`users/${uid}`, {
    displayName: "Cloudflare Play E2E",
    role: "user",
    coins: 1000,
    diamonds: 0,
    createdAt: new Date(),
  });
  idToken = await firebaseIdToken(uid);

  const invalid = await api(idToken, {
    productId: "x",
    purchaseToken: "short",
  });
  if (invalid.res.status !== 400 || invalid.body.code !== "invalid_request") {
    throw new Error(`invalid request guard failed: ${invalid.res.status} ${JSON.stringify(invalid.body)}`);
  }
  console.log("PASS Google Play invalid-request guard");

  const unknown = await api(idToken, {
    productId: "shadow_unknown_product",
    purchaseToken: fakeToken,
  });
  if (unknown.res.status !== 400 || unknown.body.code !== "unknown_product") {
    throw new Error(`unknown product guard failed: ${unknown.res.status} ${JSON.stringify(unknown.body)}`);
  }
  const unchanged = await fsGet(`users/${uid}`);
  if (unchanged?.data?.coins !== 1000) {
    throw new Error("unknown product changed user balance");
  }
  console.log("PASS unknown-product no-credit guard");

  const fakeVerification = await api(idToken, {
    productId: knownProduct,
    purchaseToken: fakeToken,
  });
  if (fakeVerification.res.ok) {
    throw new Error("fake Google purchase was unexpectedly accepted");
  }
  const afterFake = await fsGet(`users/${uid}`);
  const fakePurchaseDoc = await fsGet(`google_play_purchases/${hash}`);
  const fakeLedger = await fsGet(`financial_ledger/play_${hash}`);
  if (afterFake?.data?.coins !== 1000 || fakePurchaseDoc || fakeLedger) {
    throw new Error("failed Google verification mutated financial state");
  }
  console.log(
    `PASS failed-verification no-credit guard (${fakeVerification.body.code || fakeVerification.res.status})`,
  );

  await fsSet(`google_play_purchases/${hash}`, {
    uid,
    tokenHash: hash,
    productId: knownProduct,
    packageId: "coins_099",
    packageName: "com.shadowlive.app",
    quantity: 1,
    coins: 11000,
    status: "credited",
    creditedAt: new Date(),
  });

  const duplicate = await api(idToken, {
    productId: knownProduct,
    purchaseToken: fakeToken,
  });
  if (
    !duplicate.res.ok ||
    duplicate.body.ok !== true ||
    duplicate.body.code !== "duplicate" ||
    duplicate.body.purchaseId !== hash ||
    duplicate.body.coins !== 11000
  ) {
    throw new Error(`duplicate guard failed: ${duplicate.res.status} ${JSON.stringify(duplicate.body)}`);
  }
  const afterDuplicate = await fsGet(`users/${uid}`);
  if (afterDuplicate?.data?.coins !== 1000) {
    throw new Error("duplicate purchase changed user balance");
  }
  console.log("PASS Google Play idempotency guard");

  console.log("ALL CLOUDFLARE GOOGLE PLAY MIGRATION E2E CHECKS PASSED");
} finally {
  for (const path of cleanup) {
    try { await fsDelete(path); }
    catch (error) { console.warn(`cleanup warning ${path}: ${error.message}`); }
  }
  if (idToken) await deleteAuthUser(idToken);
}
