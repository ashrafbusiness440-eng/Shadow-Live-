import { verifyFirebaseIdToken } from "./firebase-auth.js";
import { firestoreClient } from "./firestore.js";
import { firestoreQuotaResponse, json, readJson } from "./http.js";
import { annotatePressureRequest } from "./pressure-telemetry.js";
import { timestampToEpochMs } from "./vip-runtime.js";

const clean = (value) => String(value ?? "").trim();
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_ID_ATTEMPTS = 12;
const DEFAULT_PACKAGES = Object.freeze({
  7: Object.freeze({ days: 7, coinPrice: 990000, idChanges: 0 }),
  15: Object.freeze({ days: 15, coinPrice: 1990000, idChanges: 1 }),
  30: Object.freeze({ days: 30, coinPrice: 2990000, idChanges: 4 }),
});

class ApiError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function mysteriousPolicyFromConfig(config = {}) {
  return {
    enabled: config.enabled !== false,
    packages: {
      7: {
        ...DEFAULT_PACKAGES[7],
        coinPrice: positiveInt(config.price7Days, DEFAULT_PACKAGES[7].coinPrice),
      },
      15: {
        ...DEFAULT_PACKAGES[15],
        coinPrice: positiveInt(config.price15Days, DEFAULT_PACKAGES[15].coinPrice),
      },
      30: {
        ...DEFAULT_PACKAGES[30],
        coinPrice: positiveInt(config.price30Days, DEFAULT_PACKAGES[30].coinPrice),
      },
    },
  };
}

export function mysteriousCandidateFromUint32(value) {
  const raw = Number(value) >>> 0;
  return String(100000000 + (raw % 900000000));
}

function randomMysteriousId() {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return mysteriousCandidateFromUint32(values[0]);
}

export function mysteriousStateFromUser(
  user = {},
  nowMs = Date.now(),
  policy = mysteriousPolicyFromConfig(),
) {
  const permanent = user.mysteriousPermanent === true;
  const expiresAtMs = timestampToEpochMs(user.mysteriousExpiresAt);
  const active = permanent || expiresAtMs > nowMs;
  const remainingMs = permanent ? 0 : Math.max(0, expiresAtMs - nowMs);
  const idChangesRemaining = Math.max(
    0,
    Number(user.mysteriousIdChangesRemaining || 0) || 0,
  );
  return {
    active,
    enabled: active && user.mysteriousEnabled === true,
    permanent,
    expiresAtMs,
    remainingMs,
    mysteriousId: clean(user.mysteriousId),
    idChangesRemaining,
    serverNowMs: nowMs,
    offers: Object.values(policy.packages),
  };
}

function operationKey(value) {
  const key = clean(value);
  if (!/^[A-Za-z0-9_-]{12,160}$/.test(key)) {
    throw new ApiError("invalid_idempotency_key", 400);
  }
  return key;
}

async function actor(request, env) {
  const decoded = await verifyFirebaseIdToken(request, env);
  if (decoded.firebase?.sign_in_provider === "anonymous") {
    throw new ApiError("account_required", 403);
  }
  return decoded;
}

function economyLocked(lock = {}) {
  return lock.enabled === true ||
    lock.economyLocked === true ||
    lock.transfersLocked === true;
}

async function loadState(db, uid, nowMs = Date.now()) {
  const [userSnap, configSnap] = await Promise.all([
    db.get("users/" + uid),
    db.get("system_config/mysterious_person"),
  ]);
  if (!userSnap.exists) throw new ApiError("user_not_found", 404);
  const policy = mysteriousPolicyFromConfig(configSnap.data || {});
  return {
    ok: true,
    ...mysteriousStateFromUser(userSnap.data || {}, nowMs, policy),
  };
}

async function purchase(db, uid, body, nowMs = Date.now()) {
  const days = Number(body?.days);
  if (![7, 15, 30].includes(days)) {
    throw new ApiError("invalid_mysterious_package", 400);
  }
  const key = operationKey(body?.idempotencyKey);

  for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt++) {
    const transaction = await db.beginTransaction();
    try {
      const [userSnap, operationSnap, lockSnap, configSnap] = await Promise.all([
        db.get("users/" + uid, transaction),
        db.get("wallet_operations/" + uid + "__" + key, transaction),
        db.get("system_config/emergency_lock", transaction),
        db.get("system_config/mysterious_person", transaction),
      ]);
      if (!userSnap.exists) throw new ApiError("user_not_found", 404);
      if (operationSnap.exists) {
        await db.rollback(transaction);
        return {
          ok: true,
          code: "duplicate",
          ...(operationSnap.data?.result || {}),
        };
      }
      if (economyLocked(lockSnap.data || {})) {
        throw new ApiError("emergency_locked", 409);
      }

      const policy = mysteriousPolicyFromConfig(configSnap.data || {});
      if (!policy.enabled) throw new ApiError("mysterious_disabled", 409);
      const offer = policy.packages[days];
      const user = userSnap.data || {};
      const openingCoins = Math.max(
        0,
        Number(user.coins ?? user.balance ?? 0) || 0,
      );
      if (openingCoins < offer.coinPrice) {
        throw new ApiError("insufficient_coins", 409);
      }

      let mysteriousId = clean(user.mysteriousId);
      let reservationWrite = null;
      if (!mysteriousId) {
        const candidate = randomMysteriousId();
        const reservation = await db.get(
          "mysterious_ids/" + candidate,
          transaction,
        );
        if (reservation.exists) {
          await db.rollback(transaction);
          continue;
        }
        mysteriousId = candidate;
        reservationWrite = db.writeCreate(
          "mysterious_ids/" + candidate,
          {
            uid,
            mysteriousId: candidate,
            reservedAt: new Date(nowMs),
          },
        );
      }

      const currentExpiryMs = timestampToEpochMs(user.mysteriousExpiresAt);
      const baseExpiryMs = Math.max(nowMs, currentExpiryMs);
      const nextExpiryMs = baseExpiryMs + days * DAY_MS;
      const nextChanges =
        Math.max(0, Number(user.mysteriousIdChangesRemaining || 0) || 0) +
        offer.idChanges;
      const closingCoins = openingCoins - offer.coinPrice;
      const state = {
        ...mysteriousStateFromUser(
          {
            ...user,
            mysteriousId,
            mysteriousExpiresAt: new Date(nextExpiryMs),
            mysteriousIdChangesRemaining: nextChanges,
          },
          nowMs,
          policy,
        ),
        coins: closingCoins,
      };

      const writes = [
        db.writeUpdate(
          "users/" + uid,
          {
            coins: closingCoins,
            mysteriousId,
            mysteriousExpiresAt: new Date(nextExpiryMs),
            mysteriousIdChangesRemaining: nextChanges,
            mysteriousUpdatedAt: new Date(nowMs),
          },
          [
            "coins",
            "mysteriousId",
            "mysteriousExpiresAt",
            "mysteriousIdChangesRemaining",
            "mysteriousUpdatedAt",
          ],
        ),
        db.writeCreate(
          "financial_ledger/" + uid + "__" + key + "__mysterious",
          {
            userId: uid,
            asset: "coins",
            delta: -offer.coinPrice,
            openingBalance: openingCoins,
            closingBalance: closingCoins,
            reason: "mysterious_person_purchase",
            sourceType: "mysteriousPerson",
            sourceId: key,
            packageDays: days,
            idChangesGranted: offer.idChanges,
            actorUid: uid,
            idempotencyKey: key,
            createdAt: new Date(nowMs),
          },
        ),
        db.writeCreate(
          "wallet_operations/" + uid + "__" + key,
          {
            uid,
            action: "purchaseMysteriousPerson",
            status: "completed",
            result: state,
            createdAt: new Date(nowMs),
          },
        ),
        db.writeCreate(
          "mysterious_audit_logs/" + uid + "__" + key,
          {
            actorUid: uid,
            targetUid: uid,
            action: "purchase",
            packageDays: days,
            coinPrice: offer.coinPrice,
            expiresAtMs: nextExpiryMs,
            idChangesAfter: nextChanges,
            createdAt: new Date(nowMs),
          },
        ),
      ];
      if (reservationWrite) writes.unshift(reservationWrite);
      await db.commit(transaction, writes);
      return { ok: true, code: "ok", ...state };
    } catch (error) {
      await db.rollback(transaction);
      if (error instanceof ApiError) throw error;
      const code = clean(error?.message);
      if (
        attempt < MAX_ID_ATTEMPTS - 1 &&
        /ABORTED|ALREADY_EXISTS|409/i.test(code)
      ) {
        continue;
      }
      throw error;
    }
  }
  throw new ApiError("mysterious_id_capacity_retry", 503);
}

async function setEnabled(db, uid, body, nowMs = Date.now()) {
  if (typeof body?.enabled !== "boolean") {
    throw new ApiError("invalid_mysterious_enabled_state", 400);
  }
  const transaction = await db.beginTransaction();
  try {
    const userSnap = await db.get("users/" + uid, transaction);
    if (!userSnap.exists) throw new ApiError("user_not_found", 404);
    const user = userSnap.data || {};
    const current = mysteriousStateFromUser(user, nowMs);
    if (body.enabled === true && !current.active) {
      throw new ApiError("mysterious_subscription_required", 403);
    }
    if (body.enabled === true && !clean(user.mysteriousId)) {
      throw new ApiError("mysterious_identity_missing", 409);
    }

    const enabled = body.enabled === true && current.active;
    await db.commit(transaction, [
      db.writeUpdate(
        "users/" + uid,
        {
          mysteriousEnabled: enabled,
          mysteriousEnabledUpdatedAt: new Date(nowMs),
        },
        ["mysteriousEnabled", "mysteriousEnabledUpdatedAt"],
      ),
      db.writeCreate(
        "mysterious_audit_logs/" + uid + "__toggle__" + nowMs + "__" +
          (enabled ? "1" : "0"),
        {
          actorUid: uid,
          targetUid: uid,
          action: enabled ? "enable" : "disable",
          createdAt: new Date(nowMs),
        },
      ),
    ]);
    return {
      ok: true,
      ...mysteriousStateFromUser(
        { ...user, mysteriousEnabled: enabled },
        nowMs,
      ),
    };
  } catch (error) {
    await db.rollback(transaction);
    throw error;
  }
}

async function changeId(db, uid, body, nowMs = Date.now()) {
  const key = operationKey(body?.idempotencyKey);

  for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt++) {
    const transaction = await db.beginTransaction();
    try {
      const [userSnap, operationSnap] = await Promise.all([
        db.get("users/" + uid, transaction),
        db.get("mysterious_operations/" + uid + "__" + key, transaction),
      ]);
      if (!userSnap.exists) throw new ApiError("user_not_found", 404);
      if (operationSnap.exists) {
        await db.rollback(transaction);
        return {
          ok: true,
          code: "duplicate",
          ...(operationSnap.data?.result || {}),
        };
      }

      const user = userSnap.data || {};
      const current = mysteriousStateFromUser(user, nowMs);
      if (!current.active) {
        throw new ApiError("mysterious_subscription_required", 403);
      }
      if (current.idChangesRemaining < 1) {
        throw new ApiError("mysterious_id_changes_exhausted", 409);
      }

      const candidate = randomMysteriousId();
      const reservation = await db.get(
        "mysterious_ids/" + candidate,
        transaction,
      );
      if (reservation.exists) {
        await db.rollback(transaction);
        continue;
      }

      const oldId = clean(user.mysteriousId);
      const nextChanges = current.idChangesRemaining - 1;
      const result = {
        ...mysteriousStateFromUser(
          {
            ...user,
            mysteriousId: candidate,
            mysteriousIdChangesRemaining: nextChanges,
          },
          nowMs,
        ),
        mysteriousId: candidate,
        idChangesRemaining: nextChanges,
      };
      const writes = [
        db.writeCreate(
          "mysterious_ids/" + candidate,
          {
            uid,
            mysteriousId: candidate,
            reservedAt: new Date(nowMs),
          },
        ),
        db.writeUpdate(
          "users/" + uid,
          {
            mysteriousId: candidate,
            mysteriousIdChangesRemaining: nextChanges,
            mysteriousIdUpdatedAt: new Date(nowMs),
          },
          [
            "mysteriousId",
            "mysteriousIdChangesRemaining",
            "mysteriousIdUpdatedAt",
          ],
        ),
        db.writeCreate(
          "mysterious_operations/" + uid + "__" + key,
          {
            uid,
            action: "changeMysteriousId",
            result,
            createdAt: new Date(nowMs),
          },
        ),
        db.writeCreate(
          "mysterious_audit_logs/" + uid + "__" + key,
          {
            actorUid: uid,
            targetUid: uid,
            action: "change_id",
            oldMysteriousId: oldId,
            newMysteriousId: candidate,
            idChangesAfter: nextChanges,
            createdAt: new Date(nowMs),
          },
        ),
      ];
      if (oldId) writes.push(db.writeDelete("mysterious_ids/" + oldId));
      await db.commit(transaction, writes);
      return { ok: true, code: "ok", ...result };
    } catch (error) {
      await db.rollback(transaction);
      if (error instanceof ApiError) throw error;
      const code = clean(error?.message);
      if (
        attempt < MAX_ID_ATTEMPTS - 1 &&
        /ABORTED|ALREADY_EXISTS|409/i.test(code)
      ) {
        continue;
      }
      throw error;
    }
  }
  throw new ApiError("mysterious_id_capacity_retry", 503);
}

export async function mysteriousPerson(request, env) {
  if (request.method !== "POST") {
    return json(request, env, { ok: false, code: "method_not_allowed" }, 405);
  }
  try {
    const decoded = await actor(request, env);
    const body = await readJson(request);
    const action = clean(body?.action);
    annotatePressureRequest(request, { action: "mysteriousPerson:" + action });
    const db = firestoreClient(env);

    if (action === "state") {
      return json(request, env, await loadState(db, decoded.sub));
    }
    if (action === "purchase") {
      return json(request, env, await purchase(db, decoded.sub, body));
    }
    if (action === "setEnabled") {
      return json(request, env, await setEnabled(db, decoded.sub, body));
    }
    if (action === "changeId") {
      return json(request, env, await changeId(db, decoded.sub, body));
    }
    throw new ApiError("invalid_action", 400);
  } catch (error) {
    const quota = firestoreQuotaResponse(request, env, error);
    if (quota) return quota;
    if (error instanceof ApiError) {
      return json(request, env, { ok: false, code: error.code }, error.status);
    }
    const code = clean(error?.message);
    if (code === "unauthorized") {
      return json(request, env, { ok: false, code }, 401);
    }
    return json(
      request,
      env,
      { ok: false, code: "server_mysterious_person_failed" },
      500,
    );
  }
}
