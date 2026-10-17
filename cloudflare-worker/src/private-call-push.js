import { createHash } from "node:crypto";
import { verifyFirebaseIdToken } from "./firebase-auth.js";
import { firestoreClient } from "./firestore.js";
import { googleAccessToken, parseServiceAccount } from "./google-auth.js";
import { json, readJson } from "./http.js";

const clean = v => String(v ?? "").trim();
const tokenPattern = /^[A-Za-z0-9_:\-.]{32,512}$/;
const uidPattern = /^[A-Za-z0-9_-]{1,128}$/;
const callPattern = /^[a-f0-9]{32}$/;
const maxDevices = 4;
const maxDeviceAgeMs = 30 * 86400_000;
const isReady = env => env?.PRIVATE_CALL_MEDIA_READY === "true" &&
  env?.PRIVATE_CALL_PUSH_READY === "true";

export class PrivateCallPushError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export function tokenDigest(token) {
  if (!tokenPattern.test(clean(token))) {
    throw new PrivateCallPushError("invalid_push_token");
  }
  return createHash("sha256").update(token).digest("hex");
}
const ownerPath = hash => "private_call_push_token_owners/" + hash;
const devicePath = (uid, hash) =>
  "private_call_push_devices/" + uid + "/tokens/" + hash;

function validateUid(uid) {
  if (!uidPattern.test(uid)) throw new PrivateCallPushError("invalid_user");
}
function validatePlatform(value) {
  if (!["android", "ios", "web"].includes(value)) {
    throw new PrivateCallPushError("invalid_push_platform");
  }
}

export async function updatePrivateCallPushDevice(
  db, uid, input, nowMs = Date.now(),
) {
  validateUid(uid);
  const action = clean(input?.action);
  if (action !== "register" && action !== "unregister") {
    throw new PrivateCallPushError("invalid_push_action");
  }
  const token = clean(input?.token);
  const hash = tokenDigest(token);
  const platform = clean(input?.platform);
  if (action === "register") validatePlatform(platform);
  const tx = await db.beginTransaction();
  try {
    const old = await db.get(ownerPath(hash), tx);
    const previousUid = clean(old.data?.uid);
    if (previousUid && !uidPattern.test(previousUid)) {
      throw new PrivateCallPushError("invalid_owner_document", 409);
    }
    const writes = [];
    if (action === "register") {
      // A shared installation token cannot belong to two signed-in
      // accounts. Reassigning it revokes the prior account atomically.
      if (previousUid && previousUid !== uid) {
        writes.push(db.writeDelete(devicePath(previousUid, hash)));
      }
      writes.push((old.exists ? db.writeUpdate : db.writeCreate).call(
        db, ownerPath(hash), {
          uid, updatedAtMs: nowMs,
        },
      ));
      writes.push(db.writeUpdate(devicePath(uid, hash), {
        token, platform, updatedAtMs: nowMs,
      }));
    } else {
      // Old account cleanup cannot erase a token that now belongs to another.
      if (previousUid === uid) {
        writes.push(db.writeDelete(ownerPath(hash)));
        writes.push(db.writeDelete(devicePath(uid, hash)));
      }
    }
    if (writes.length) await db.commit(tx, writes);
    else await db.rollback(tx);
    return { ok: true, code: action === "register"
      ? "device_registered" : "device_unregistered" };
  } catch (error) {
    await db.rollback(tx).catch(() => {});
    throw error;
  }
}

export async function privateCallPushDevices(request, env) {
  if (request.method !== "POST") {
    return json(request, env, { ok: false, code: "method_not_allowed" }, 405);
  }
  try {
    const auth = await verifyFirebaseIdToken(request, env);
    const uid = clean(auth?.sub);
    validateUid(uid);
    if (auth?.firebase?.sign_in_provider === "anonymous") {
      throw new PrivateCallPushError("registered_account_required", 403);
    }
    const body = await readJson(request);
    const result = await updatePrivateCallPushDevice(
      firestoreClient(env), uid, body,
    );
    return json(request, env, result);
  } catch (error) {
    const expected = error instanceof PrivateCallPushError;
    const code = expected ? error.code :
      error?.message === "unauthorized" ? "unauthorized" :
      "push_registration_failed";
    const status = expected ? error.status :
      code === "unauthorized" ? 401 : 503;
    return json(request, env, { ok: false, code }, status);
  }
}

export function buildPrivateCallFcmMessage(
  token, call, nowMs = Date.now(),
) {
  if (!tokenPattern.test(clean(token)) ||
      !callPattern.test(clean(call?.callId)) ||
      !uidPattern.test(clean(call?.calleeUid)) ||
      !uidPattern.test(clean(call?.callerUid)) ||
      call.status !== "ringing") {
    throw new PrivateCallPushError("invalid_call_push");
  }
  const remainingMs = Number(call.ringDeadlineMs) - nowMs;
  if (!(remainingMs > 0)) return null;
  const seconds = Math.max(1, Math.min(30, Math.ceil(remainingMs / 1000)));
  const tag = "private_call_" + call.callId;
  return {
    message: {
      token,
      notification: {
        title: "مكالمة صوتية واردة",
        body: "افتح شادول لايف للرد على المكالمة.",
      },
      data: {
        type: "private_call_incoming",
        callId: call.callId,
      },
      android: {
        priority: "HIGH",
        ttl: seconds + "s",
        notification: {
          channel_id: "shadow_private_calls",
          tag,
        },
      },
      webpush: {
        headers: { TTL: String(seconds), Urgency: "high" },
        notification: { tag, requireInteraction: false },
      },
    },
  };
}

/// Send only on new successful call creations, never idempotent retries.
/// At most 4 selected devices, 5s per fetch, no Firestore scans or push logs.
/// No sending before BOTH independent production rollout gates are enabled.
export async function dispatchPrivateCallPush(env, calleeUid, callId, {
  db = firestoreClient(env),
  send = null,
  nowMs = Date.now(),
} = {}) {
  if (!isReady(env)) return { code: "push_disabled", sent: 0 };
  validateUid(calleeUid);
  if (!callPattern.test(clean(callId))) {
    throw new PrivateCallPushError("invalid_call_id");
  }
  const call = await db.get("private_calls/" + callId);
  if (!call.exists || call.data?.calleeUid !== calleeUid ||
      call.data?.status !== "ringing" ||
      Number(call.data?.ringDeadlineMs || 0) <= nowMs) {
    return { code: "not_ringing", sent: 0 };
  }
  // A token can outlive logout, permission revocation or a failed unregister.
  // Never send unless the current account explicitly opted in at the server.
  const account = await db.get("users/" + calleeUid);
  if (!account.exists || account.data?.privateCallPushOptIn !== true ||
      account.data?.accountStatus === "banned" ||
      account.data?.accountStatus === "suspended" ||
      account.data?.accountStatus === "disabled") {
    return { code: "push_opt_in_required", sent: 0 };
  }
  const devices = await db.runQuery(
    "private_call_push_devices/" + calleeUid + "/tokens",
    { limit: maxDevices },
  );
  if (!devices.length) return { code: "no_devices", sent: 0 };
  const valid = [];
  // Each selected token must still belong to the intended account.
  for (const device of devices.slice(0, maxDevices)) {
    const token = clean(device.data?.token);
    let hash;
    try { hash = tokenDigest(token); } catch (_) { continue; }
    if (hash !== device.id ||
        nowMs - Number(device.data?.updatedAtMs || 0) > maxDeviceAgeMs) {
      continue;
    }
    const owner = await db.get(ownerPath(hash));
    if (owner.data?.uid === calleeUid) valid.push(token);
  }
  if (!valid.length) return { code: "no_valid_devices", sent: 0 };
  const { projectId } = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT);
  const deliver = send || (async message => {
    const access = await googleAccessToken(
      env, "https://www.googleapis.com/auth/firebase.messaging",
    );
    const response = await fetch(
      "https://fcm.googleapis.com/v1/projects/" +
        encodeURIComponent(projectId) + "/messages:send",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + access,
          "content-type": "application/json",
        },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(5000),
      },
    );
    return response.ok;
  });
  let sent = 0;
  for (const token of valid) {
    const message = buildPrivateCallFcmMessage(token, call.data, nowMs);
    if (!message) break;
    try {
      if (await deliver(message)) sent++;
    } catch (_) {
      // Push is best effort; never roll back or duplicate an active call.
    }
  }
  return { code: "attempted", sent, selected: valid.length };
}
