import { createHash } from "node:crypto";
import { json, readJson } from "./http.js";
import { verifyFirebaseIdToken } from "./firebase-auth.js";
import { firestoreClient } from "./firestore.js";
import { googleAccessTokenFromServiceAccount } from "./google-auth.js";

const PLAY_SCOPE = "https://www.googleapis.com/auth/androidpublisher";

const FALLBACK_PACKAGES = [
  { id: "coins_099", productId: "shadow_coins_099", totalCoins: 11000, enabled: true },
  { id: "coins_199", productId: "shadow_coins_199", totalCoins: 23000, enabled: true },
  { id: "coins_499", productId: "shadow_coins_499", totalCoins: 60000, enabled: true },
  { id: "coins_999", productId: "shadow_coins_999", totalCoins: 125000, enabled: true },
  { id: "coins_2499", productId: "shadow_coins_2499", totalCoins: 330000, enabled: true },
  { id: "coins_4999", productId: "shadow_coins_4999", totalCoins: 700000, enabled: true },
  { id: "coins_9999", productId: "shadow_coins_9999", totalCoins: 1500000, enabled: true },
];

const clean = (value) => String(value ?? "").trim();

class ApiError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function tokenHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

function accountHash(uid) {
  return createHash("sha256").update(uid).digest("hex");
}

async function loadPackage(db, productId) {
  const snap = await db.get("system_config/recharge");
  const raw = snap.data?.packages;
  const packages = Array.isArray(raw)
    ? raw.map((item) => ({
        id: clean(item?.id),
        productId: clean(item?.productId),
        totalCoins:
          Number(item?.baseCoins || 0) + Number(item?.bonusCoins || 0),
        enabled: item?.enabled !== false,
      }))
    : FALLBACK_PACKAGES;

  const item = packages.find(
    (entry) =>
      entry.productId === productId &&
      entry.enabled === true &&
      Number.isSafeInteger(entry.totalCoins) &&
      entry.totalCoins > 0,
  );
  if (!item) throw new ApiError("unknown_product", 400);
  return item;
}

async function playAccessToken(env) {
  const raw = String(
    env.GOOGLE_PLAY_SERVICE_ACCOUNT ||
    env.FIREBASE_SERVICE_ACCOUNT ||
    "",
  ).trim();
  if (!raw) throw new ApiError("play_not_configured", 503);
  try {
    return await googleAccessTokenFromServiceAccount(raw, PLAY_SCOPE);
  } catch (error) {
    const code = clean(error?.message);
    if (code === "server_not_configured" || code === "invalid_service_account_json") {
      throw new ApiError("play_not_configured", 503);
    }
    throw error;
  }
}

async function playRequest(env, url, options = {}) {
  const token = await playAccessToken(env);
  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${token}`);
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(url, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      clean(body?.error?.status || body?.error?.message || `http_${response.status}`),
    );
    error.status = response.status;
    error.details = body;
    throw error;
  }
  return body;
}

async function verifyWithGoogle(env, packageName, purchaseToken) {
  const url =
    "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/" +
    encodeURIComponent(packageName) +
    "/purchases/productsv2/tokens/" +
    encodeURIComponent(purchaseToken);

  const data = await playRequest(env, url, { method: "GET" });
  const state = clean(data?.purchaseStateContext?.purchaseState);
  if (state !== "PURCHASED") {
    if (state === "PENDING") throw new ApiError("purchase_pending", 409);
    throw new ApiError("purchase_not_valid", 400);
  }
  return data;
}

async function consumePurchase(env, packageName, productId, purchaseToken) {
  const url =
    "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/" +
    encodeURIComponent(packageName) +
    "/purchases/products/" +
    encodeURIComponent(productId) +
    "/tokens/" +
    encodeURIComponent(purchaseToken) +
    ":consume";
  await playRequest(env, url, { method: "POST" });
}

async function markConsumeState(db, hash, fields) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const transaction = await db.beginTransaction();
    try {
      const snap = await db.get(`google_play_purchases/${hash}`, transaction);
      if (!snap.exists) {
        await db.rollback(transaction);
        return;
      }
      await db.commit(transaction, [
        db.writeUpdate(
          `google_play_purchases/${hash}`,
          fields,
          Object.keys(fields),
        ),
      ]);
      return;
    } catch (error) {
      await db.rollback(transaction);
      if ((error?.message === "ABORTED" || error?.status === 409) && attempt < 2) {
        continue;
      }
      throw error;
    }
  }
}

async function creditPurchase(
  db,
  uid,
  hash,
  productId,
  packageName,
  rechargePackage,
  verified,
  quantity,
  coinsToCredit,
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const transaction = await db.beginTransaction();
    try {
      const [userSnap, purchaseSnap, lockSnap] = await Promise.all([
        db.get(`users/${uid}`, transaction),
        db.get(`google_play_purchases/${hash}`, transaction),
        db.get("system_config/emergency_lock", transaction),
      ]);

      if (!userSnap.exists) throw new ApiError("user_not_found", 404);

      const economyLock = lockSnap.data || {};
      if (
        economyLock.enabled === true ||
        economyLock.economyLocked === true ||
        economyLock.rechargeLocked === true
      ) {
        throw new ApiError("emergency_locked", 409);
      }

      if (purchaseSnap.exists && purchaseSnap.data?.status === "credited") {
        await db.rollback(transaction);
        return {
          duplicate: true,
          coins: Number(purchaseSnap.data?.coins || 0),
          closingCoins: null,
        };
      }

      const user = userSnap.data || {};
      const openingCoins = Number(user.coins ?? user.balance ?? 0);
      if (!Number.isFinite(openingCoins) || openingCoins < 0) {
        throw new ApiError("invalid_wallet_state", 400);
      }
      const closingCoins = openingCoins + coinsToCredit;
      const now = new Date();

      await db.commit(transaction, [
        db.writeUpdate(
          `users/${uid}`,
          {
            coins: closingCoins,
            walletUpdatedAt: now,
          },
          ["coins", "walletUpdatedAt"],
        ),
        db.writeUpdate(
          `google_play_purchases/${hash}`,
          {
            uid,
            tokenHash: hash,
            productId,
            packageId: rechargePackage.id,
            packageName,
            quantity,
            coins: coinsToCredit,
            orderId: clean(verified.orderId),
            regionCode: clean(verified.regionCode),
            testPurchase: verified.testPurchaseContext != null,
            purchaseCompletionTime: clean(verified.purchaseCompletionTime),
            status: "credited",
            refundState: "none",
            disputeState: "none",
            creditedAt: now,
          },
        ),
        db.writeCreate(`financial_ledger/play_${hash}`, {
          userId: uid,
          asset: "coins",
          delta: coinsToCredit,
          openingBalance: openingCoins,
          closingBalance: closingCoins,
          reason: "google_play_recharge",
          sourceType: "googlePlayPurchase",
          sourceId: hash,
          actorUid: uid,
          productId,
          packageId: rechargePackage.id,
          quantity,
          idempotencyKey: hash,
          createdAt: now,
        }),
      ]);

      return {
        duplicate: false,
        coins: coinsToCredit,
        closingCoins,
      };
    } catch (error) {
      await db.rollback(transaction);
      if (error instanceof ApiError) throw error;
      if ((error?.message === "ABORTED" || error?.status === 409) && attempt < 2) {
        continue;
      }
      throw error;
    }
  }
  throw new ApiError("transaction_failed", 500);
}

export async function googlePlayPurchase(request, env) {
  if (request.method !== "POST") {
    return json(request, env, { ok: false, code: "method_not_allowed" }, 405);
  }

  try {
    const decoded = await verifyFirebaseIdToken(request, env);
    if (decoded.firebase?.sign_in_provider === "anonymous") {
      throw new ApiError("account_required", 403);
    }

    const body = await readJson(request);
    const purchaseToken = clean(body.purchaseToken);
    const productId = clean(body.productId);
    const packageName = clean(
      env.GOOGLE_PLAY_PACKAGE_NAME || "com.shadowlive.app",
    );

    if (
      purchaseToken.length < 20 ||
      purchaseToken.length > 4096 ||
      !/^[a-z0-9_.]{3,120}$/.test(productId) ||
      !/^[A-Za-z0-9_.]+$/.test(packageName)
    ) {
      throw new ApiError("invalid_request", 400);
    }

    const db = firestoreClient(env);
    const rechargePackage = await loadPackage(db, productId);
    const hash = tokenHash(purchaseToken);
    const existing = await db.get(`google_play_purchases/${hash}`);

    if (existing.exists && existing.data?.status === "credited") {
      try {
        await consumePurchase(env, packageName, productId, purchaseToken);
      } catch {}
      return json(request, env, {
        ok: true,
        code: "duplicate",
        purchaseId: hash,
        coins: Number(existing.data?.coins || 0),
      });
    }

    const verified = await verifyWithGoogle(env, packageName, purchaseToken);
    const lineItems = Array.isArray(verified.productLineItem)
      ? verified.productLineItem
      : [];
    const lineItem = lineItems.find(
      (item) => clean(item?.productId) === productId,
    );
    if (!lineItem) throw new ApiError("product_mismatch", 400);

    const externalAccountId = clean(verified.obfuscatedExternalAccountId);
    const expectedAccountId = accountHash(decoded.sub);
    if (!externalAccountId || externalAccountId !== expectedAccountId) {
      throw new ApiError("account_mismatch", 400);
    }

    const consumptionState = clean(
      lineItem?.productOfferDetails?.consumptionState,
    );
    if (consumptionState === "CONSUMPTION_STATE_CONSUMED") {
      throw new ApiError("purchase_already_consumed", 400);
    }

    const quantityRaw = Number(lineItem?.productOfferDetails?.quantity || 1);
    const quantity =
      Number.isSafeInteger(quantityRaw) && quantityRaw > 0 && quantityRaw <= 20
        ? quantityRaw
        : 1;
    const coinsToCredit = rechargePackage.totalCoins * quantity;

    const result = await creditPurchase(
      db,
      decoded.sub,
      hash,
      productId,
      packageName,
      rechargePackage,
      verified,
      quantity,
      coinsToCredit,
    );

    let consumed = true;
    try {
      await consumePurchase(env, packageName, productId, purchaseToken);
      await markConsumeState(db, hash, {
        consumed: true,
        consumedAt: new Date(),
        consumeRetryRequired: false,
      });
    } catch {
      consumed = false;
      await markConsumeState(db, hash, {
        consumed: false,
        consumeRetryRequired: true,
        consumeLastAttemptAt: new Date(),
      });
    }

    return json(request, env, {
      ok: true,
      code: result.duplicate ? "duplicate" : "ok",
      purchaseId: hash,
      coins: result.coins,
      balance: result.closingCoins,
      consumed,
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return json(request, env, { ok: false, code: error.code }, error.status);
    }

    const raw = clean(error?.message);
    if (raw === "unauthorized") {
      return json(request, env, { ok: false, code: "unauthorized" }, 401);
    }

    return json(
      request,
      env,
      { ok: false, code: "play_verification_failed" },
      500,
    );
  }
}
