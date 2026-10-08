import {
  assertUserDocumentSessionState,
  verifyFirebaseIdToken,
} from "./firebase-auth.js";
import { firestoreClient } from "./firestore.js";
import { firestoreQuotaResponse, json, readJson } from "./http.js";
import { timestampToEpochMs } from "./vip-runtime.js";
import {
  mysteriousCandidateFromUint32,
  mysteriousPolicyFromConfig,
  mysteriousStateFromUser,
  mysteriousVoiceOptionsFromConfig,
} from "./mysterious-person.js";

const clean = (value) => String(value ?? "").trim();
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_ID_ATTEMPTS = 12;
const CONTROL_CAPABILITY = "manageMysteriousPerson";
const REVEAL_CAPABILITY = "revealMysteriousIdentity";

class ApiError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function validKey(value) {
  return /^[A-Za-z0-9_-]{12,160}$/.test(clean(value));
}

function actorCapabilities(actor = {}) {
  return new Set(
    Array.isArray(actor.capabilities)
      ? actor.capabilities.map(clean).filter(Boolean)
      : [],
  );
}

export function mysteriousControlAccess(actor = {}) {
  const role = clean(actor.role);
  const isOwner = role === "owner";
  const eligibleRole = role === "admin" || role === "super_admin";
  const caps = actorCapabilities(actor);
  const enabled = actor.adminEnabled === true;
  return {
    isOwner,
    canManage: isOwner || (enabled && eligibleRole && caps.has(CONTROL_CAPABILITY)),
    canReveal: isOwner || (enabled && eligibleRole && caps.has(REVEAL_CAPABILITY)),
    canOpen: isOwner || (enabled && eligibleRole && (
      caps.has(CONTROL_CAPABILITY) || caps.has(REVEAL_CAPABILITY)
    )),
    canUpdatePrices: isOwner,
    canConfigureVoices: isOwner,
    canGrantPermanent: isOwner,
  };
}

function normalizeDigits(value) {
  let text = clean(value);
  const arabic = "٠١٢٣٤٥٦٧٨٩";
  const persian = "۰۱۲۳۴۵۶۷۸۹";
  for (let i = 0; i < 10; i += 1) {
    text = text
      .split(arabic[i]).join(String(i))
      .split(persian[i]).join(String(i));
  }
  return text;
}

function normalizeSearchText(value) {
  let text = String(value ?? "").toLowerCase();
  const arabic = "٠١٢٣٤٥٦٧٨٩";
  const persian = "۰۱۲۳۴۵۶۷۸۹";
  for (let i = 0; i < 10; i += 1) {
    text = text
      .split(arabic[i]).join(String(i))
      .split(persian[i]).join(String(i));
  }
  return text
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "")
    .replace(/ـ/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ")
    .trim();
}

function randomMysteriousId() {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return mysteriousCandidateFromUint32(values[0]);
}

async function loadActor(db, decoded) {
  const uid = clean(decoded?.sub);
  if (!uid) throw new ApiError("unauthorized", 401);
  const snap = await db.get("users/" + uid);
  if (!snap.exists) throw new ApiError("forbidden", 403);
  const actor = snap.data || {};
  assertUserDocumentSessionState(decoded, actor);
  return { uid, actor, access: mysteriousControlAccess(actor) };
}

async function requireRecentControlActor(request, env, db, need) {
  const decoded = await verifyFirebaseIdToken(request, env, {
    checkUserState: false,
  });
  const age = Math.floor(Date.now() / 1000) - Number(decoded.auth_time || 0);
  if (!Number.isFinite(age) || age > 1800) {
    throw new ApiError("recent_auth_required", 401);
  }
  const actor = await loadActor(db, decoded);
  if (!actor.access[need]) throw new ApiError("forbidden", 403);
  return actor;
}

function stateForControl(user, policy, nowMs, includeId) {
  const state = mysteriousStateFromUser(user, nowMs, policy);
  return {
    active: state.active,
    enabled: state.enabled,
    permanent: state.permanent,
    expiresAtMs: state.expiresAtMs,
    remainingMs: state.remainingMs,
    idChangesRemaining: state.idChangesRemaining,
    mysteriousId: includeId ? state.mysteriousId : "",
  };
}

async function controlState(db, actor) {
  const configSnap = await db.get("system_config/mysterious_person");
  const policy = mysteriousPolicyFromConfig(configSnap.data || {});
  return {
    ok: true,
    access: actor.access,
    prices: {
      7: policy.packages[7].coinPrice,
      15: policy.packages[15].coinPrice,
      30: policy.packages[30].coinPrice,
    },
    voiceOptions: mysteriousVoiceOptionsFromConfig(configSnap.data || {}),
  };
}

async function controlSearch(db, actor, body) {
  const raw = clean(body?.query);
  const query = normalizeSearchText(raw);
  if (!query || query.length > 120) throw new ApiError("invalid_request", 400);

  const ids = [];
  const directUid = clean(raw);
  if (directUid && !directUid.includes("/") && directUid.length <= 220) {
    const direct = await db.get("users/" + directUid).catch(() => ({ exists: false }));
    if (direct.exists) ids.push(directUid);
  }

  const numeric = normalizeDigits(raw);
  if (/^\d{3,8}$/.test(numeric)) {
    const registry = await db.get("public_ids/" + numeric).catch(() => ({ exists: false }));
    const uid = clean(registry.data?.uid);
    if (registry.exists && uid) ids.push(uid);
  }

  if (/^[1-9][0-9]{8}$/.test(numeric) && actor.access.canReveal) {
    const reservation = await db.get("mysterious_ids/" + numeric).catch(() => ({ exists: false }));
    const uid = clean(reservation.data?.uid);
    if (reservation.exists && uid) ids.push(uid);
  }

  if (!ids.length) {
    const rows = await db.runQuery("public_profiles", {
      filters: [{ field: "searchTokens", op: "array-contains", value: query }],
      limit: 20,
    }).catch(() => []);
    for (const row of rows) {
      const uid = clean(row.id);
      if (uid) ids.push(uid);
    }
  }

  const unique = [...new Set(ids)].slice(0, 20);
  if (!unique.length) return { ok: true, results: [], access: actor.access };

  const [configSnap, userSnaps, profileSnaps] = await Promise.all([
    db.get("system_config/mysterious_person"),
    Promise.all(unique.map((uid) => db.get("users/" + uid))),
    Promise.all(unique.map((uid) => db.get("public_profiles/" + uid).catch(() => ({ exists: false, data: null })))),
  ]);
  const policy = mysteriousPolicyFromConfig(configSnap.data || {});
  const nowMs = Date.now();
  const results = [];
  for (let i = 0; i < unique.length; i += 1) {
    if (!userSnaps[i]?.exists) continue;
    const user = userSnaps[i].data || {};
    const profile = profileSnaps[i]?.data || {};
    results.push({
      uid: unique[i],
      displayName: clean(profile.displayName || user.displayName || user.name || "مستخدم Shadow Live"),
      publicId: clean(profile.publicId || user.publicId),
      profileImageUrl: clean(profile.profileImageUrl || user.profileImageUrl),
      role: clean(user.role || "user"),
      mysterious: stateForControl(user, policy, nowMs, actor.access.canReveal),
    });
  }
  return { ok: true, results, access: actor.access };
}

async function controlUpdatePrices(db, actor, body) {
  if (!actor.access.canUpdatePrices) throw new ApiError("forbidden", 403);
  const p7 = Number(body?.price7Days);
  const p15 = Number(body?.price15Days);
  const p30 = Number(body?.price30Days);
  for (const value of [p7, p15, p30]) {
    if (!Number.isSafeInteger(value) || value <= 0 || value > 1000000000000) {
      throw new ApiError("invalid_price", 400);
    }
  }
  const key = clean(body?.idempotencyKey);
  const reason = clean(body?.reason);
  if (!validKey(key) || reason.length > 160) throw new ApiError("invalid_request", 400);

  const tx = await db.beginTransaction();
  try {
    const [opSnap, configSnap] = await Promise.all([
      db.get("control_operations/" + key, tx),
      db.get("system_config/mysterious_person", tx),
    ]);
    if (opSnap.exists) {
      await db.rollback(tx);
      return { ok: true, code: "duplicate", ...(opSnap.data?.result || {}) };
    }
    const before = mysteriousPolicyFromConfig(configSnap.data || {});
    const after = { price7Days: p7, price15Days: p15, price30Days: p30 };
    const now = new Date();
    await db.commit(tx, [
      db.writeUpdate(
        "system_config/mysterious_person",
        { ...after, updatedAt: now, updatedBy: actor.uid },
        ["price7Days", "price15Days", "price30Days", "updatedAt", "updatedBy"],
      ),
      db.writeCreate("mysterious_audit_logs/control_price_" + key, {
        actorUid: actor.uid,
        action: "update_prices",
        beforePrices: {
          7: before.packages[7].coinPrice,
          15: before.packages[15].coinPrice,
          30: before.packages[30].coinPrice,
        },
        afterPrices: { 7: p7, 15: p15, 30: p30 },
        reason: reason || null,
        createdAt: now,
      }),
      db.writeCreate("control_operations/" + key, {
        action: "manageMysteriousPrices",
        actorUid: actor.uid,
        status: "completed",
        result: { prices: { 7: p7, 15: p15, 30: p30 } },
        createdAt: now,
      }),
    ]);
    return { ok: true, prices: { 7: p7, 15: p15, 30: p30 } };
  } catch (error) {
    await db.rollback(tx).catch(() => {});
    throw error;
  }
}

async function controlUpdateVoices(db, actor, body) {
  if (!actor.access.canConfigureVoices) throw new ApiError("forbidden", 403);
  const key = clean(body?.idempotencyKey);
  const reason = clean(body?.reason);
  const raw = Array.isArray(body?.voiceOptions) ? body.voiceOptions : [];
  if (!validKey(key) || reason.length > 160 || raw.length !== 9) {
    throw new ApiError("invalid_request", 400);
  }

  const allowedIds = new Set([
    "original",
    "men_to_child",
    "men_to_women",
    "women_to_child",
    "women_to_men",
    "foreigner",
    "android",
    "ethereal",
    "minions",
  ]);
  const seen = new Set();
  const voiceOptions = [];
  for (let index = 0; index < raw.length; index += 1) {
    const item = raw[index] && typeof raw[index] === "object" ? raw[index] : {};
    const id = clean(item.id);
    if (!allowedIds.has(id) || seen.has(id)) {
      throw new ApiError("invalid_mysterious_voice_config", 400);
    }
    seen.add(id);
    voiceOptions.push({
      id,
      enabled: id === "original" ? true : item.enabled !== false,
      order: index,
    });
  }
  if (!seen.has("original")) {
    throw new ApiError("invalid_mysterious_voice_config", 400);
  }

  const tx = await db.beginTransaction();
  try {
    const [opSnap, configSnap] = await Promise.all([
      db.get("control_operations/" + key, tx),
      db.get("system_config/mysterious_person", tx),
    ]);
    if (opSnap.exists) {
      await db.rollback(tx);
      return { ok: true, code: "duplicate", ...(opSnap.data?.result || {}) };
    }

    const before = mysteriousVoiceOptionsFromConfig(configSnap.data || {});
    const now = new Date();
    const result = { voiceOptions };
    await db.commit(tx, [
      db.writeUpdate(
        "system_config/mysterious_person",
        {
          voiceOptions,
          voiceOptionsUpdatedAt: now,
          voiceOptionsUpdatedBy: actor.uid,
        },
        ["voiceOptions", "voiceOptionsUpdatedAt", "voiceOptionsUpdatedBy"],
      ),
      db.writeCreate("mysterious_audit_logs/control_voices_" + key, {
        actorUid: actor.uid,
        action: "update_voice_options",
        beforeVoiceOptions: before.map((item) => ({
          id: item.id,
          enabled: item.enabled !== false,
          order: item.order,
        })),
        afterVoiceOptions: voiceOptions,
        reason: reason || null,
        createdAt: now,
      }),
      db.writeCreate("control_operations/" + key, {
        action: "manageMysteriousVoices",
        actorUid: actor.uid,
        status: "completed",
        result,
        createdAt: now,
      }),
    ]);
    return { ok: true, ...result };
  } catch (error) {
    await db.rollback(tx).catch(() => {});
    throw error;
  }
}

async function controlGrant(db, actor, body, nowMs = Date.now()) {
  const targetUid = clean(body?.targetUid);
  const permanent = body?.permanent === true;
  const days = permanent ? 0 : Number(body?.days);
  const key = clean(body?.idempotencyKey);
  const reason = clean(body?.reason);
  if (
    !targetUid ||
    targetUid.includes("/") ||
    !validKey(key) ||
    reason.length > 160 ||
    (!permanent && ![7, 15, 30].includes(days))
  ) {
    throw new ApiError("invalid_request", 400);
  }
  if (permanent && !actor.access.canGrantPermanent) {
    throw new ApiError("permanent_owner_only", 403);
  }

  for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt++) {
    const tx = await db.beginTransaction();
    try {
      const [targetSnap, opSnap, configSnap] = await Promise.all([
        db.get("users/" + targetUid, tx),
        db.get("control_operations/" + key, tx),
        db.get("system_config/mysterious_person", tx),
      ]);
      if (opSnap.exists) {
        await db.rollback(tx);
        return { ok: true, code: "duplicate", ...(opSnap.data?.result || {}) };
      }
      if (!targetSnap.exists) throw new ApiError("not_found", 404);
      const target = targetSnap.data || {};
      if (clean(target.role) === "owner" && !actor.access.isOwner) {
        throw new ApiError("owner_protected", 409);
      }

      const policy = mysteriousPolicyFromConfig(configSnap.data || {});
      let mysteriousId = clean(target.mysteriousId);
      let reservationWrite = null;
      if (!mysteriousId) {
        const candidate = randomMysteriousId();
        const reservation = await db.get("mysterious_ids/" + candidate, tx);
        if (reservation.exists) {
          await db.rollback(tx);
          continue;
        }
        mysteriousId = candidate;
        reservationWrite = db.writeCreate("mysterious_ids/" + candidate, {
          uid: targetUid,
          mysteriousId: candidate,
          reservedAt: new Date(nowMs),
        });
      }

      const beforeState = mysteriousStateFromUser(target, nowMs, policy);
      const baseExpiry = Math.max(nowMs, timestampToEpochMs(target.mysteriousExpiresAt));
      const nextExpiryMs = permanent
        ? beforeState.expiresAtMs
        : baseExpiry + days * DAY_MS;
      const grantedChanges = permanent ? 0 : policy.packages[days].idChanges;
      const nextChanges =
        Math.max(0, Number(target.mysteriousIdChangesRemaining || 0) || 0) +
        grantedChanges;
      const patch = {
        mysteriousId,
        mysteriousPermanent: permanent || target.mysteriousPermanent === true,
        mysteriousIdChangesRemaining: nextChanges,
        mysteriousUpdatedAt: new Date(nowMs),
      };
      const mask = [
        "mysteriousId",
        "mysteriousPermanent",
        "mysteriousIdChangesRemaining",
        "mysteriousUpdatedAt",
      ];
      if (!permanent) {
        patch.mysteriousExpiresAt = new Date(nextExpiryMs);
        mask.push("mysteriousExpiresAt");
      }
      const afterState = mysteriousStateFromUser({ ...target, ...patch }, nowMs, policy);
      const result = {
        targetUid,
        days,
        permanent: patch.mysteriousPermanent === true,
        expiresAtMs: afterState.expiresAtMs,
        idChangesRemaining: nextChanges,
        mysteriousId: actor.access.canReveal ? mysteriousId : "",
      };
      const writes = [
        db.writeUpdate("users/" + targetUid, patch, mask),
        db.writeCreate("mysterious_audit_logs/control_grant_" + key, {
          actorUid: actor.uid,
          targetUid,
          action: permanent ? "grant_permanent" : "grant_duration",
          days: permanent ? null : days,
          idChangesGranted: grantedChanges,
          beforePermanent: beforeState.permanent,
          afterPermanent: result.permanent,
          beforeExpiresAtMs: beforeState.expiresAtMs,
          afterExpiresAtMs: result.expiresAtMs,
          beforeIdChanges: beforeState.idChangesRemaining,
          afterIdChanges: nextChanges,
          reason: reason || null,
          createdAt: new Date(nowMs),
        }),
        db.writeCreate("control_operations/" + key, {
          action: "manageMysteriousPerson",
          actorUid: actor.uid,
          targetId: targetUid,
          mode: permanent ? "grantPermanent" : "grant",
          status: "completed",
          result,
          createdAt: new Date(nowMs),
        }),
      ];
      if (reservationWrite) writes.unshift(reservationWrite);
      await db.commit(tx, writes);
      return { ok: true, ...result };
    } catch (error) {
      await db.rollback(tx).catch(() => {});
      if (error instanceof ApiError) throw error;
      const code = clean(error?.message);
      if (attempt < MAX_ID_ATTEMPTS - 1 && /ABORTED|ALREADY_EXISTS|409/i.test(code)) {
        continue;
      }
      throw error;
    }
  }
  throw new ApiError("mysterious_id_capacity_retry", 503);
}

async function controlRevoke(db, actor, body, nowMs = Date.now()) {
  const targetUid = clean(body?.targetUid);
  const key = clean(body?.idempotencyKey);
  const reason = clean(body?.reason);
  if (!targetUid || targetUid.includes("/") || !validKey(key) || reason.length > 160) {
    throw new ApiError("invalid_request", 400);
  }
  const tx = await db.beginTransaction();
  try {
    const [targetSnap, opSnap, configSnap] = await Promise.all([
      db.get("users/" + targetUid, tx),
      db.get("control_operations/" + key, tx),
      db.get("system_config/mysterious_person", tx),
    ]);
    if (opSnap.exists) {
      await db.rollback(tx);
      return { ok: true, code: "duplicate", ...(opSnap.data?.result || {}) };
    }
    if (!targetSnap.exists) throw new ApiError("not_found", 404);
    const target = targetSnap.data || {};
    if (clean(target.role) === "owner" && !actor.access.isOwner) {
      throw new ApiError("owner_protected", 409);
    }
    const policy = mysteriousPolicyFromConfig(configSnap.data || {});
    const before = mysteriousStateFromUser(target, nowMs, policy);
    const patch = {
      mysteriousEnabled: false,
      mysteriousPermanent: false,
      mysteriousExpiresAt: new Date(0),
      mysteriousUpdatedAt: new Date(nowMs),
    };
    const result = {
      targetUid,
      active: false,
      enabled: false,
      permanent: false,
      expiresAtMs: 0,
      idChangesRemaining: before.idChangesRemaining,
    };
    await db.commit(tx, [
      db.writeUpdate(
        "users/" + targetUid,
        patch,
        ["mysteriousEnabled", "mysteriousPermanent", "mysteriousExpiresAt", "mysteriousUpdatedAt"],
      ),
      db.writeCreate("mysterious_audit_logs/control_revoke_" + key, {
        actorUid: actor.uid,
        targetUid,
        action: "revoke",
        beforePermanent: before.permanent,
        beforeExpiresAtMs: before.expiresAtMs,
        beforeEnabled: before.enabled,
        reason: reason || null,
        createdAt: new Date(nowMs),
      }),
      db.writeCreate("control_operations/" + key, {
        action: "manageMysteriousPerson",
        actorUid: actor.uid,
        targetId: targetUid,
        mode: "revoke",
        status: "completed",
        result,
        createdAt: new Date(nowMs),
      }),
    ]);
    return { ok: true, ...result };
  } catch (error) {
    await db.rollback(tx).catch(() => {});
    throw error;
  }
}

async function controlReveal(db, actor, body) {
  if (!actor.access.canReveal) throw new ApiError("forbidden", 403);
  const mysteriousId = normalizeDigits(body?.mysteriousId);
  const reason = clean(body?.reason);
  if (!/^[1-9][0-9]{8}$/.test(mysteriousId) || reason.length < 3 || reason.length > 160) {
    throw new ApiError("invalid_request", 400);
  }
  const reservation = await db.get("mysterious_ids/" + mysteriousId);
  const uid = clean(reservation.data?.uid);
  if (!reservation.exists || !uid) throw new ApiError("not_found", 404);
  const [userSnap, profileSnap] = await Promise.all([
    db.get("users/" + uid),
    db.get("public_profiles/" + uid).catch(() => ({ exists: false, data: null })),
  ]);
  if (!userSnap.exists) throw new ApiError("not_found", 404);
  const user = userSnap.data || {};
  const profile = profileSnap.data || {};
  const now = new Date();
  await db.commit(null, [
    db.writeCreate(
      "mysterious_audit_logs/reveal_" + actor.uid + "__" + Date.now() + "__" + mysteriousId,
      {
        actorUid: actor.uid,
        targetUid: uid,
        mysteriousId,
        action: "reveal_identity",
        reason,
        createdAt: now,
      },
    ),
  ]);
  return {
    ok: true,
    mysteriousId,
    identity: {
      uid,
      publicId: clean(profile.publicId || user.publicId),
      displayName: clean(profile.displayName || user.displayName || user.name || "مستخدم Shadow Live"),
      profileImageUrl: clean(profile.profileImageUrl || user.profileImageUrl),
    },
  };
}

export async function manageMysteriousPerson(request, env) {
  if (request.method !== "POST") {
    return json(request, env, { ok: false, code: "method_not_allowed" }, 405);
  }
  try {
    const body = await readJson(request);
    const action = clean(body?.action);
    const db = firestoreClient(env);
    const need = action === "controlReveal" ? "canReveal"
      : action === "controlUpdatePrices" ? "canUpdatePrices"
      : action === "controlUpdateVoices" ? "canConfigureVoices"
      : action === "controlState" ? "canOpen"
      : "canManage";
    const actor = await requireRecentControlActor(request, env, db, need);

    if (action === "controlState") return json(request, env, await controlState(db, actor));
    if (action === "controlSearch") return json(request, env, await controlSearch(db, actor, body));
    if (action === "controlUpdatePrices") {
      return json(request, env, await controlUpdatePrices(db, actor, body));
    }
    if (action === "controlUpdateVoices") {
      return json(request, env, await controlUpdateVoices(db, actor, body));
    }
    if (action === "controlGrant") return json(request, env, await controlGrant(db, actor, body));
    if (action === "controlRevoke") return json(request, env, await controlRevoke(db, actor, body));
    if (action === "controlReveal") return json(request, env, await controlReveal(db, actor, body));
    throw new ApiError("invalid_action", 400);
  } catch (error) {
    const quota = firestoreQuotaResponse(request, env, error);
    if (quota) return quota;
    if (error instanceof ApiError) {
      return json(request, env, { ok: false, code: error.code }, error.status);
    }
    const code = clean(error?.message);
    if (code === "unauthorized") return json(request, env, { ok: false, code }, 401);
    return json(request, env, { ok: false, code: "server_mysterious_control_failed" }, 500);
  }
}
