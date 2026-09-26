import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { json, readJson } from "./http.js";
import { verifyFirebaseIdToken } from "./firebase-auth.js";
import { firestoreClient } from "./firestore.js";
import { annotatePressureRequest } from "./pressure-telemetry.js";

const COINS_PER_DIAMOND = 10000;
const clean = (value) => String(value ?? "").trim();

class ApiError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function asInt(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : 0;
}

function validateOperationKey(value) {
  const key = clean(value);
  if (!/^[A-Za-z0-9_-]{12,160}$/.test(key)) {
    throw new ApiError("invalid_idempotency_key", 400);
  }
  return key;
}

function passwordRecord(password) {
  const salt = randomBytes(24).toString("base64url");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

function verifyPassword(password, record) {
  const salt = clean(record?.passwordSalt);
  const expected = clean(record?.passwordHash);
  if (!salt || !expected) return false;
  const actual = scryptSync(password, salt, 64);
  const expectedBuffer = Buffer.from(expected, "hex");
  return expectedBuffer.length === actual.length &&
    timingSafeEqual(expectedBuffer, actual);
}

async function authenticatedActor(request, env) {
  const decoded = await verifyFirebaseIdToken(request, env);
  if (decoded.firebase?.sign_in_provider === "anonymous") {
    throw new ApiError("account_required", 403);
  }
  return decoded;
}

async function walletState(db, uid) {
  const [userSnap, privateSnap] = await Promise.all([
    db.get(`users/${uid}`),
    db.get(`wallet_private/${uid}`),
  ]);
  if (!userSnap.exists) throw new ApiError("user_not_found", 404);
  const user = userSnap.data || {};
  return {
    ok: true,
    coins: Math.max(0, asInt(user.coins ?? user.balance)),
    diamonds: Math.max(0, asInt(user.diamonds)),
    passwordSet: privateSnap.exists && Boolean(privateSnap.data?.passwordHash),
    coinsPerDiamond: COINS_PER_DIAMOND,
  };
}

export async function setWalletPassword(db, uid, body) {
  const password = String(body.password ?? "");
  if (password.length < 6 || password.length > 64) {
    throw new ApiError("invalid_password", 400);
  }
  const secured = passwordRecord(password);

  for (let attempt = 0; attempt < 3; attempt++) {
    const transaction = await db.beginTransaction();
    try {
      const [userSnap, privateSnap] = await Promise.all([
        db.get(`users/${uid}`, transaction),
        db.get(`wallet_private/${uid}`, transaction),
      ]);
      if (!userSnap.exists) throw new ApiError("user_not_found", 404);
      if (privateSnap.exists && clean(privateSnap.data?.passwordHash)) {
        throw new ApiError("password_already_set", 409);
      }

      const now = new Date();
      await db.commit(transaction, [
        db.writeUpdate(`wallet_private/${uid}`, {
          uid,
          passwordSalt: secured.salt,
          passwordHash: secured.hash,
          createdAt: now,
          updatedAt: now,
        }),
        db.writeUpdate(`users/${uid}`, {
          diamondPasswordSet: true,
          diamondPasswordUpdatedAt: now,
        }, ["diamondPasswordSet", "diamondPasswordUpdatedAt"]),
      ]);
      return { ok: true, passwordSet: true };
    } catch (error) {
      await db.rollback(transaction);
      if (error instanceof ApiError) throw error;
      if ((error?.message === "ABORTED" || error?.status === 409) && attempt < 2) continue;
      throw error;
    }
  }
  throw new ApiError("transaction_failed", 500);
}

async function requireWalletPassword(db, uid, password) {
  const privateSnap = await db.get(`wallet_private/${uid}`);
  if (!privateSnap.exists ||
      !verifyPassword(String(password ?? ""), privateSnap.data || {})) {
    throw new ApiError("wallet_password_invalid", 403);
  }
}

export async function exchangeDiamonds(db, uid, body) {
  const diamonds = asInt(body.diamonds);
  if (diamonds < 1 || diamonds > 1000000) {
    throw new ApiError("invalid_amount", 400);
  }
  const key = validateOperationKey(body.idempotencyKey);
  await requireWalletPassword(db, uid, body.password);
  const coins = diamonds * COINS_PER_DIAMOND;

  for (let attempt = 0; attempt < 3; attempt++) {
    const transaction = await db.beginTransaction();
    try {
      const [userSnap, operationSnap, lockSnap] = await Promise.all([
        db.get(`users/${uid}`, transaction),
        db.get(`wallet_operations/${uid}__${key}`, transaction),
        db.get("system_config/emergency_lock", transaction),
      ]);
      if (!userSnap.exists) throw new ApiError("user_not_found", 404);
      if (operationSnap.exists) {
        await db.rollback(transaction);
        return {
          ok: true,
          code: "duplicate",
          operationId: key,
          ...(operationSnap.data?.result || {}),
        };
      }

      const lock = lockSnap.data || {};
      if (lock.enabled === true || lock.economyLocked === true ||
          lock.transfersLocked === true) {
        throw new ApiError("emergency_locked", 409);
      }

      const user = userSnap.data || {};
      const openingDiamonds = Math.max(0, asInt(user.diamonds));
      const openingCoins = Math.max(0, asInt(user.coins ?? user.balance));
      if (openingDiamonds < diamonds) {
        throw new ApiError("insufficient_diamonds", 409);
      }

      const closingDiamonds = openingDiamonds - diamonds;
      const closingCoins = openingCoins + coins;
      const now = new Date();
      const result = {
        diamondsSpent: diamonds,
        coinsReceived: coins,
        diamonds: closingDiamonds,
        coins: closingCoins,
      };

      await db.commit(transaction, [
        db.writeUpdate(`users/${uid}`, {
          diamonds: closingDiamonds,
          coins: closingCoins,
          walletUpdatedAt: now,
        }, ["diamonds", "coins", "walletUpdatedAt"]),
        db.writeCreate(`financial_ledger/${uid}__${key}__diamond`, {
          userId: uid,
          asset: "diamonds",
          delta: -diamonds,
          openingBalance: openingDiamonds,
          closingBalance: closingDiamonds,
          reason: "diamond_to_coin_exchange",
          sourceType: "walletExchange",
          sourceId: key,
          actorUid: uid,
          idempotencyKey: key,
          createdAt: now,
        }),
        db.writeCreate(`financial_ledger/${uid}__${key}__coin`, {
          userId: uid,
          asset: "coins",
          delta: coins,
          openingBalance: openingCoins,
          closingBalance: closingCoins,
          reason: "diamond_to_coin_exchange",
          sourceType: "walletExchange",
          sourceId: key,
          actorUid: uid,
          idempotencyKey: key,
          createdAt: now,
        }),
        db.writeCreate(`wallet_operations/${uid}__${key}`, {
          uid,
          action: "exchangeDiamonds",
          status: "completed",
          result,
          createdAt: now,
        }),
      ]);

      return { ok: true, code: "ok", operationId: key, ...result };
    } catch (error) {
      await db.rollback(transaction);
      if (error instanceof ApiError) throw error;
      if ((error?.message === "ABORTED" || error?.status === 409) && attempt < 2) continue;
      throw error;
    }
  }
  throw new ApiError("transaction_failed", 500);
}

export async function giftDiamonds(db, uid, body) {
  const recipientUid = clean(body.recipientUid);
  const diamonds = asInt(body.diamonds);
  if (!recipientUid || recipientUid === uid) {
    throw new ApiError("invalid_recipient", 400);
  }
  if (diamonds < 1 || diamonds > 1000000) {
    throw new ApiError("invalid_amount", 400);
  }
  const key = validateOperationKey(body.idempotencyKey);
  await requireWalletPassword(db, uid, body.password);
  const coins = diamonds * COINS_PER_DIAMOND;

  for (let attempt = 0; attempt < 3; attempt++) {
    const transaction = await db.beginTransaction();
    try {
      const [senderSnap, recipientSnap, operationSnap, lockSnap] = await Promise.all([
        db.get(`users/${uid}`, transaction),
        db.get(`users/${recipientUid}`, transaction),
        db.get(`wallet_operations/${uid}__${key}`, transaction),
        db.get("system_config/emergency_lock", transaction),
      ]);
      if (!senderSnap.exists || !recipientSnap.exists) {
        throw new ApiError("user_not_found", 404);
      }
      if (operationSnap.exists) {
        await db.rollback(transaction);
        return {
          ok: true,
          code: "duplicate",
          operationId: key,
          ...(operationSnap.data?.result || {}),
        };
      }

      const lock = lockSnap.data || {};
      if (lock.enabled === true || lock.economyLocked === true ||
          lock.transfersLocked === true) {
        throw new ApiError("emergency_locked", 409);
      }

      const sender = senderSnap.data || {};
      const recipient = recipientSnap.data || {};
      const openingDiamonds = Math.max(0, asInt(sender.diamonds));
      const recipientOpeningCoins = Math.max(0, asInt(recipient.coins ?? recipient.balance));
      if (openingDiamonds < diamonds) {
        throw new ApiError("insufficient_diamonds", 409);
      }

      const senderClosingDiamonds = openingDiamonds - diamonds;
      const recipientClosingCoins = recipientOpeningCoins + coins;
      const now = new Date();
      const result = {
        recipientUid,
        diamondsSent: diamonds,
        coinsReceived: coins,
        diamonds: senderClosingDiamonds,
      };

      await db.commit(transaction, [
        db.writeUpdate(`users/${uid}`, {
          diamonds: senderClosingDiamonds,
          walletUpdatedAt: now,
        }, ["diamonds", "walletUpdatedAt"]),
        db.writeUpdate(`users/${recipientUid}`, {
          coins: recipientClosingCoins,
          walletUpdatedAt: now,
        }, ["coins", "walletUpdatedAt"]),
        db.writeCreate(`financial_ledger/${uid}__${key}__sender`, {
          userId: uid,
          asset: "diamonds",
          delta: -diamonds,
          openingBalance: openingDiamonds,
          closingBalance: senderClosingDiamonds,
          reason: "diamond_gift",
          sourceType: "walletTransfer",
          sourceId: key,
          actorUid: uid,
          counterpartyUid: recipientUid,
          idempotencyKey: key,
          createdAt: now,
        }),
        db.writeCreate(`financial_ledger/${uid}__${key}__receiver`, {
          userId: recipientUid,
          asset: "coins",
          delta: coins,
          openingBalance: recipientOpeningCoins,
          closingBalance: recipientClosingCoins,
          reason: "diamond_gift_received_as_coins",
          sourceType: "walletTransfer",
          sourceId: key,
          actorUid: uid,
          counterpartyUid: uid,
          idempotencyKey: key,
          createdAt: now,
        }),
        db.writeCreate(`wallet_transfers/${uid}__${key}`, {
          senderUid: uid,
          recipientUid,
          diamonds,
          coinsReceived: coins,
          exchangeRate: COINS_PER_DIAMOND,
          type: "diamond_gift_to_coins",
          status: "completed",
          createdAt: now,
        }),
        db.writeCreate(`wallet_operations/${uid}__${key}`, {
          uid,
          action: "giftDiamonds",
          status: "completed",
          result,
          createdAt: now,
        }),
      ]);

      return { ok: true, code: "ok", operationId: key, ...result };
    } catch (error) {
      await db.rollback(transaction);
      if (error instanceof ApiError) throw error;
      if ((error?.message === "ABORTED" || error?.status === 409) && attempt < 2) continue;
      throw error;
    }
  }
  throw new ApiError("transaction_failed", 500);
}

export async function walletActions(request, env) {
  if (request.method !== "POST") {
    return json(request, env, { ok: false, code: "method_not_allowed" }, 405);
  }

  try {
    const decoded = await authenticatedActor(request, env);
    const body = await readJson(request);
    const action = clean(body.action);
    annotatePressureRequest(request, { action });
    const db = firestoreClient(env);

    if (action === "state") return json(request, env, await walletState(db, decoded.sub));
    if (action === "setPassword") {
      return json(request, env, await setWalletPassword(db, decoded.sub, body));
    }
    if (action === "exchangeDiamonds") {
      return json(request, env, await exchangeDiamonds(db, decoded.sub, body));
    }
    if (action === "giftDiamonds") {
      return json(request, env, await giftDiamonds(db, decoded.sub, body));
    }

    throw new ApiError("invalid_action", 400);
  } catch (error) {
    if (error instanceof ApiError) {
      return json(request, env, { ok: false, code: error.code }, error.status);
    }
    const code = clean(error?.message) || "server_error";
    if (code === "unauthorized") {
      return json(request, env, { ok: false, code }, 401);
    }
    if (code === "server_not_configured" || code === "invalid_service_account_json") {
      return json(request, env, { ok: false, code }, 503);
    }
    return json(request, env, { ok: false, code: "server_wallet_failed" }, 500);
  }
}
