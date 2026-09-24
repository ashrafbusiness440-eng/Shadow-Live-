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
const uid = `__cf_voice_phase2_${runId}`;
const now = new Date();
const day = now.toISOString().slice(0, 10);
const month = day.slice(0, 7);

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
let roomId = "";
let publicId = "";
const cleanup = new Set([
  `users/${uid}`,
  `public_profiles/${uid}`,
  `host_mic_activity/${uid}/days/${day}`,
]);

try {
  await fsSet(`users/${uid}`, {
    displayName: "Cloudflare Voice Phase2",
    username: "cf_voice_phase2",
    role: "user",
    adminEnabled: false,
    capabilities: [],
    giftHostActivityMonth: month,
    giftHostMicSecondsMonth: 0,
    giftHostQualifiedDays: 0,
    coins: 0,
    diamonds: 0,
    createdAt: new Date(),
  });
  await fsSet(`public_profiles/${uid}`, {
    displayName: "Cloudflare Voice Phase2",
    username: "cf_voice_phase2",
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

  const join = await api(idToken, { action: "roomPresenceJoin", roomId });
  if (!join.res.ok || join.body.ok !== true) {
    throw new Error(`presence join failed: ${join.res.status} ${JSON.stringify(join.body)}`);
  }
  cleanup.add(`room_presence/${roomId}/users/${uid}`);

  const take = await api(idToken, {
    action: "roomSeatAction",
    roomId,
    seatAction: "takeSeat",
    seatIndex: 0,
  });
  if (!take.res.ok || take.body.seats?.[0]?.uid !== uid) {
    throw new Error(`take seat failed: ${take.res.status} ${JSON.stringify(take.body)}`);
  }

  const unmute = await api(idToken, {
    action: "roomSeatAction",
    roomId,
    seatAction: "unmuteSeat",
  });
  if (!unmute.res.ok || unmute.body.seats?.[0]?.muted !== false ||
      Number(unmute.body.seats?.[0]?.micStartedAtMs || 0) <= 0) {
    throw new Error(`unmute seat failed: ${unmute.res.status} ${JSON.stringify(unmute.body)}`);
  }
  console.log("PASS mic start state");

  await new Promise((resolve) => setTimeout(resolve, 2200));

  const mute = await api(idToken, {
    action: "roomSeatAction",
    roomId,
    seatAction: "muteSeat",
  });
  if (!mute.res.ok || mute.body.seats?.[0]?.muted !== true ||
      Number(mute.body.seats?.[0]?.micStartedAtMs || 0) !== 0) {
    throw new Error(`mute seat failed: ${mute.res.status} ${JSON.stringify(mute.body)}`);
  }

  const [activity, userAfter] = await Promise.all([
    fsGet(`host_mic_activity/${uid}/days/${day}`),
    fsGet(`users/${uid}`),
  ]);
  const daySeconds = Number(activity?.data?.micSeconds || 0);
  const monthSeconds = Number(userAfter?.data?.giftHostMicSecondsMonth || 0);
  if (daySeconds < 1 || monthSeconds < 1) {
    throw new Error(`mic activity not recorded: day=${daySeconds}, month=${monthSeconds}`);
  }
  if (userAfter?.data?.giftHostActivityMonth !== month) {
    throw new Error("mic activity month mismatch");
  }
  console.log(`PASS mic activity accounting day=${daySeconds}s month=${monthSeconds}s`);

  const token = await api(idToken, { roomId });
  if (!token.res.ok || token.body.ok !== true) {
    throw new Error(`ZEGO token generation failed: ${token.res.status} ${JSON.stringify(token.body)}`);
  }
  if (
    token.body.provider !== "zego" ||
    !Number.isInteger(Number(token.body.appId)) ||
    Number(token.body.appId) <= 0 ||
    typeof token.body.token !== "string" ||
    !token.body.token.startsWith("04") ||
    typeof token.body.userId !== "string" ||
    !token.body.userId.startsWith("u_") ||
    token.body.roomId !== roomId
  ) {
    throw new Error(`ZEGO token response invalid: ${JSON.stringify(token.body)}`);
  }
  const expiresAt = Number(token.body.expiresAt || 0);
  const remaining = expiresAt - Math.floor(Date.now() / 1000);
  if (remaining < 1700 || remaining > 1850) {
    throw new Error(`ZEGO token TTL invalid: ${remaining}`);
  }
  console.log("PASS ZEGO Token04 generation");

  const leave = await api(idToken, { action: "roomPresenceLeave", roomId });
  if (!leave.res.ok || leave.body.ok !== true) {
    throw new Error(`presence leave failed: ${leave.res.status} ${JSON.stringify(leave.body)}`);
  }
  console.log("PASS room presence leave");

  console.log("ALL CLOUDFLARE VOICE PHASE-2 E2E CHECKS PASSED");
} finally {
  for (const path of [...cleanup].reverse()) {
    try { await fsDelete(path); }
    catch (error) { console.warn(`cleanup warning ${path}: ${error.message}`); }
  }
  if (idToken) await deleteAuthUser(idToken);
}
