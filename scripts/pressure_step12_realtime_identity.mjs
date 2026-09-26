import fs from "node:fs";
import { sign } from "node:crypto";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function b64url(value) {
  return Buffer.from(value).toString("base64")
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

export function loadFirebaseTestIdentity() {
  let sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
  if (typeof sa === "string") sa = JSON.parse(sa);
  const projectId = String(sa.project_id || "");
  const clientEmail = String(sa.client_email || "");
  const privateKey = String(sa.private_key || "").replace(/\\n/g, "\n");
  const firebaseOptions = fs.readFileSync("lib/firebase_options.dart", "utf8");
  const apiKey = firebaseOptions.match(/apiKey:\s*'([^']+)'/)?.[1] || "";
  if (!projectId || !clientEmail || !privateKey || !apiKey) {
    throw new Error("invalid_firebase_test_identity");
  }
  return { projectId, clientEmail, privateKey, apiKey };
}

export async function googleDatastoreAccessToken(identity) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({
    iss: identity.clientEmail,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${payload}`;
  const signature = sign("RSA-SHA256", Buffer.from(unsigned), identity.privateKey);
  const assertion = `${unsigned}.${b64url(signature)}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error(`google_oauth_failed_${res.status}`);
  }
  return body.access_token;
}

function customToken(identity, uid) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({
    iss: identity.clientEmail,
    sub: identity.clientEmail,
    aud: "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit",
    iat: now,
    exp: now + 3600,
    uid,
  }));
  const unsigned = `${header}.${payload}`;
  const signature = sign("RSA-SHA256", Buffer.from(unsigned), identity.privateKey);
  return `${unsigned}.${b64url(signature)}`;
}

export async function firebaseIdToken(identity, uid) {
  let lastError = "custom_token_exchange_failed";
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const res = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(identity.apiKey)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            token: customToken(identity, uid),
            returnSecureToken: true,
          }),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.idToken) return body.idToken;
      lastError = `custom_token_exchange_failed_${res.status}`;
      if (res.status !== 429 && res.status < 500) break;
    } catch (error) {
      lastError = String(error?.message || error || "custom_token_network_failed");
    }
    await sleep(250 * (2 ** attempt));
  }
  throw new Error(lastError);
}

export async function deleteAuthUser(identity, idToken) {
  if (!idToken) return;
  await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${encodeURIComponent(identity.apiKey)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken }),
    },
  ).catch(() => {});
}

function encodeValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }
  return { stringValue: String(value) };
}

export async function firestoreSet(identity, accessToken, path, fields) {
  const root = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(identity.projectId)}/databases/(default)/documents`;
  const res = await fetch(`${root}/${path}`, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      fields: Object.fromEntries(
        Object.entries(fields).map(([key, value]) => [key, encodeValue(value)]),
      ),
    }),
  });
  if (!res.ok) throw new Error(`firestore_set_failed_${res.status}`);
}

export async function firestoreDelete(identity, accessToken, path) {
  if (!accessToken) return;
  const root = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(identity.projectId)}/databases/(default)/documents`;
  const res = await fetch(`${root}/${path}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${accessToken}` },
  }).catch(() => null);
  if (res && !res.ok && res.status !== 404) {
    throw new Error(`firestore_delete_failed_${res.status}`);
  }
}

export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, limit), items.length) },
    async () => {
      while (true) {
        const index = next++;
        if (index >= items.length) return;
        results[index] = await fn(items[index], index);
      }
    },
  );
  await Promise.all(workers);
  return results;
}
