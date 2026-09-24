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
const uid = `__cf_voice_user_${runId}`;

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

function customToken(uidValue) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({
    iss: clientEmail,
    sub: clientEmail,
    aud: "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit",
    iat: now,
    exp: now + 3600,
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
  if (!res.ok || !body.idToken) {
    throw new Error(`token exchange failed: ${res.status} ${JSON.stringify(body)}`);
  }
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
  if (!res.ok && res.status !== 404) {
    throw new Error(`fsDelete failed ${path}: ${res.status}`);
  }
}

async function api(idToken, payload) {
  const res = await fetch(`${workerBase}/api/voice-session`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${idToken}`,
      "content-type": "application/json",
      origin: "https://ashrafbusiness440-eng.github.io",
    },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  return { res, body };
}

async function waitForVoiceRoute() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const res = await fetch(`${workerBase}/api/voice-session`);
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.service === "shadow-voice-session") return body;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error("voice-session route did not become active");
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
let roomId = null;
let publicId = null;
let messageId = null;
const cleanup = new Set([
  `users/${uid}`,
  `public_profiles/${uid}`,
]);

try {
  const health = await waitForVoiceRoute();
  if (health.provider !== "zego") throw new Error("voice provider mismatch");
  console.log("PASS voice route health");

  const unauth = await fetch(`${workerBase}/api/voice-session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "personalRoom" }),
  });
  const unauthBody = await unauth.json().catch(() => ({}));
  if (unauth.status !== 401 || unauthBody.code !== "unauthorized") {
    throw new Error(`voice unauthorized guard failed: ${unauth.status} ${JSON.stringify(unauthBody)}`);
  }
  console.log("PASS voice unauthorized guard");

  await fsSet(`users/${uid}`, {
    displayName: "Cloudflare Voice User",
    username: "cf_voice_user",
    role: "user",
    adminEnabled: false,
    capabilities: [],
    coins: 0,
    diamonds: 0,
    location: "E2E",
    createdAt: new Date(),
  });
  await fsSet(`public_profiles/${uid}`, {
    displayName: "Cloudflare Voice User",
    username: "cf_voice_user",
    profileImageUrl: "",
    createdAt: new Date(),
  });

  idToken = await firebaseIdToken(uid);

  const personal = await api(idToken, { action: "personalRoom" });
  if (!personal.res.ok || personal.body.ok !== true || !personal.body.room?.roomId) {
    throw new Error(`personalRoom failed: ${personal.res.status} ${JSON.stringify(personal.body)}`);
  }
  roomId = String(personal.body.room.roomId);
  publicId = String(personal.body.room.publicId || "");
  cleanup.add(`rooms/${roomId}`);
  if (publicId) cleanup.add(`room_ids/${publicId}`);
  console.log("PASS personal room");

  const presence = await api(idToken, { action: "roomPresenceJoin", roomId });
  if (!presence.res.ok || presence.body.ok !== true || presence.body.onlineCount < 1) {
    throw new Error(`presence join failed: ${presence.res.status} ${JSON.stringify(presence.body)}`);
  }
  cleanup.add(`room_presence/${roomId}/users/${uid}`);
  console.log("PASS room presence join");

  const sent = await api(idToken, {
    action: "sendRoomChat",
    roomId,
    text: "Cloudflare Voice Session E2E",
  });
  if (!sent.res.ok || sent.body.ok !== true || !sent.body.messageId) {
    throw new Error(`room chat failed: ${sent.res.status} ${JSON.stringify(sent.body)}`);
  }
  messageId = String(sent.body.messageId);
  cleanup.add(`rooms/${roomId}/messages/${messageId}`);
  cleanup.add(`room_chat_rate_limits/${roomId}__${uid}`);
  const message = await fsGet(`rooms/${roomId}/messages/${messageId}`);
  if (message?.data?.text !== "Cloudflare Voice Session E2E") {
    throw new Error("room chat document mismatch");
  }
  console.log("PASS room chat");

  const seatState = await api(idToken, { action: "roomSeatState", roomId });
  if (!seatState.res.ok || seatState.body.ok !== true || !Array.isArray(seatState.body.seats)) {
    throw new Error(`room seat state failed: ${seatState.res.status} ${JSON.stringify(seatState.body)}`);
  }
  if (seatState.body.seats.length < 1) throw new Error("room has no seats");
  console.log("PASS room seat state");

  const takeSeat = await api(idToken, {
    action: "roomSeatAction",
    roomId,
    seatAction: "takeSeat",
    seatIndex: 0,
  });
  if (!takeSeat.res.ok || takeSeat.body.ok !== true ||
      takeSeat.body.seats?.[0]?.uid !== uid) {
    throw new Error(`take seat failed: ${takeSeat.res.status} ${JSON.stringify(takeSeat.body)}`);
  }
  console.log("PASS take seat");

  const tokenGate = await api(idToken, { roomId });
  if (tokenGate.res.ok) {
    if (!tokenGate.body.token || !tokenGate.body.appId || tokenGate.body.provider !== "zego") {
      throw new Error("configured ZEGO token response malformed");
    }
    console.log("PASS ZEGO token response shape");
  } else if (tokenGate.res.status === 503 && tokenGate.body.code === "zego_not_configured") {
    console.log("PASS ZEGO configuration gate");
  } else {
    throw new Error(`unexpected token gate: ${tokenGate.res.status} ${JSON.stringify(tokenGate.body)}`);
  }

  const leave = await api(idToken, { action: "roomPresenceLeave", roomId });
  if (!leave.res.ok || leave.body.ok !== true) {
    throw new Error(`presence leave failed: ${leave.res.status} ${JSON.stringify(leave.body)}`);
  }
  console.log("PASS room presence leave");

  console.log("ALL CLOUDFLARE VOICE SESSION PHASE-1 E2E CHECKS PASSED");
} finally {
  if (roomId) {
    try {
      const room = await fsGet(`rooms/${roomId}`);
      const recent = room?.data?.recentEntrance;
      if (recent?.eventId) {
        // recentEntrance is embedded; deleting the room below removes it.
      }
    } catch {}
  }

  for (const path of [...cleanup].reverse()) {
    try { await fsDelete(path); }
    catch (error) { console.warn(`cleanup warning ${path}: ${error.message}`); }
  }
  if (idToken) await deleteAuthUser(idToken);
}
