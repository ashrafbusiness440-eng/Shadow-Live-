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
const senderUid = `__cf_chat_sender_${runId}`;
const receiverUid = `__cf_chat_receiver_${runId}`;
const conversationId = `cf_chat_core_${runId}`;
const roomId = `cf_chat_room_${runId}`;
const messageKey = `cfmsg_${runId}_${Date.now()}`;
const inviteKey = `cfinvite_${runId}_${Date.now()}`;

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

let senderToken = null;
let receiverToken = null;
let sentMessageId = null;
let inviteMessageId = null;
const cleanup = new Set([
  `users/${senderUid}`,
  `users/${receiverUid}`,
  `conversations/${conversationId}`,
  `rooms/${roomId}`,
  `follows/${senderUid}__${receiverUid}`,
  `follows/${receiverUid}__${senderUid}`,
  `message_operations/${messageKey}`,
  `message_operations/${inviteKey}`,
  `message_rate_limits/${senderUid}`,
  `dm_limits/${conversationId}__${senderUid}`,
  `dm_limits/${conversationId}__${receiverUid}`,
  `room_invites/${roomId}/users/${receiverUid}`,
  `room_invite_rate_limits/${roomId}__${senderUid}__${receiverUid}`,
]);

try {
  await fsSet(`users/${senderUid}`, {
    displayName: "Cloudflare Chat Sender",
    role: "user",
    createdAt: new Date(),
  });
  await fsSet(`users/${receiverUid}`, {
    displayName: "Cloudflare Chat Receiver",
    role: "user",
    createdAt: new Date(),
  });
  await fsSet(`conversations/${conversationId}`, {
    participants: [senderUid, receiverUid].sort(),
    unreadCounts: { [senderUid]: 0, [receiverUid]: 0 },
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await fsSet(`rooms/${roomId}`, {
    name: "Cloudflare E2E Room",
    publicId: "99887766",
    ownerUid: senderUid,
    isActive: true,
    createdAt: new Date(),
  });

  senderToken = await firebaseIdToken(senderUid);
  receiverToken = await firebaseIdToken(receiverUid);

  const follow1 = await api(senderToken, "setFollow", {
    targetUserId: receiverUid,
    following: true,
  });
  if (!follow1.res.ok || follow1.body.following !== true) {
    throw new Error(`sender follow failed: ${follow1.res.status} ${JSON.stringify(follow1.body)}`);
  }

  const follow2 = await api(receiverToken, "setFollow", {
    targetUserId: senderUid,
    following: true,
  });
  if (!follow2.res.ok || follow2.body.following !== true) {
    throw new Error(`receiver follow failed: ${follow2.res.status} ${JSON.stringify(follow2.body)}`);
  }

  if (!(await fsGet(`follows/${senderUid}__${receiverUid}`)) ||
      !(await fsGet(`follows/${receiverUid}__${senderUid}`))) {
    throw new Error("mutual follow documents missing");
  }
  console.log("PASS mutual follow");

  const sent = await api(senderToken, "sendMessage", {
    receiverId: receiverUid,
    conversationId,
    text: "Cloudflare E2E message",
    idempotencyKey: messageKey,
  });
  if (!sent.res.ok || sent.body.ok !== true || !sent.body.messageId || sent.body.mutual !== true) {
    throw new Error(`sendMessage failed: ${sent.res.status} ${JSON.stringify(sent.body)}`);
  }
  sentMessageId = sent.body.messageId;
  cleanup.add(`conversations/${conversationId}/messages/${sentMessageId}`);

  const sentDoc = await fsGet(`conversations/${conversationId}/messages/${sentMessageId}`);
  if (sentDoc?.data?.text !== "Cloudflare E2E message") {
    throw new Error("message document mismatch");
  }
  console.log("PASS send message");

  const duplicate = await api(senderToken, "sendMessage", {
    receiverId: receiverUid,
    conversationId,
    text: "Cloudflare E2E message",
    idempotencyKey: messageKey,
  });
  if (!duplicate.res.ok || duplicate.body.code !== "duplicate" ||
      duplicate.body.messageId !== sentMessageId) {
    throw new Error(`message idempotency failed: ${duplicate.res.status} ${JSON.stringify(duplicate.body)}`);
  }
  console.log("PASS message idempotency");

  const invite = await api(senderToken, "sendRoomInvite", {
    receiverId: receiverUid,
    conversationId,
    roomId,
    idempotencyKey: inviteKey,
  });
  if (!invite.res.ok || invite.body.ok !== true || !invite.body.messageId ||
      invite.body.roomId !== roomId) {
    throw new Error(`room invite failed: ${invite.res.status} ${JSON.stringify(invite.body)}`);
  }
  inviteMessageId = invite.body.messageId;
  cleanup.add(`conversations/${conversationId}/messages/${inviteMessageId}`);

  const inviteAccess = await fsGet(`room_invites/${roomId}/users/${receiverUid}`);
  if (inviteAccess?.data?.invitedBy !== senderUid) {
    throw new Error("room invite access missing");
  }
  console.log("PASS room invite");

  const inviteDup = await api(senderToken, "sendRoomInvite", {
    receiverId: receiverUid,
    conversationId,
    roomId,
    idempotencyKey: inviteKey,
  });
  if (!inviteDup.res.ok || inviteDup.body.code !== "duplicate" ||
      inviteDup.body.messageId !== inviteMessageId) {
    throw new Error(`invite idempotency failed: ${inviteDup.res.status} ${JSON.stringify(inviteDup.body)}`);
  }
  console.log("PASS invite idempotency");

  const unfollow = await api(senderToken, "setFollow", {
    targetUserId: receiverUid,
    following: false,
  });
  if (!unfollow.res.ok || unfollow.body.following !== false) {
    throw new Error(`unfollow failed: ${unfollow.res.status} ${JSON.stringify(unfollow.body)}`);
  }
  if (await fsGet(`follows/${senderUid}__${receiverUid}`)) {
    throw new Error("follow document still exists after unfollow");
  }
  console.log("PASS unfollow");

  console.log("ALL CLOUDFLARE CHAT CORE E2E CHECKS PASSED");
} finally {
  for (const path of [...cleanup].reverse()) {
    try { await fsDelete(path); } catch (error) {
      console.warn(`cleanup warning ${path}: ${error.message}`);
    }
  }
  if (senderToken) await deleteAuthUser(senderToken);
  if (receiverToken) await deleteAuthUser(receiverToken);
}
