import { createHash } from "node:crypto";
import { json, readJson } from "./http.js";
import { verifyFirebaseIdToken } from "./firebase-auth.js";
import { firestoreClient } from "./firestore.js";
import { googleAccessTokenFromServiceAccount } from "./google-auth.js";
import {
  growthFromPaidRecharge,
  loadVipPolicy,
} from "./vip-policy.js";
import { applyVipGrowth, materializeVipState } from "./vip-state.js";
import {
  vipPublicProfilePatch,
  vipStateFromUser,
  vipUserPatch,
} from "./vip-runtime.js";
import { vip10TrialCardGrantWrites } from "./vip-trial-cards.js";

const PLAY_SCOPE = "https://www.googleapis.com/auth/androidpublisher";

const FALLBACK_PACKAGES = [
  { id: "coins_099", productId: "shadow_coins_099", baseCoins: 9900, bonusCoins: 1100, totalCoins: 11000, enabled: true },
  { id: "coins_199", productId: "shadow_coins_199", baseCoins: 19900, bonusCoins: 3100, totalCoins: 23000, enabled: true },
  { id: "coins_499", productId: "shadow_coins_499", baseCoins: 49900, bonusCoins: 10100, totalCoins: 60000, enabled: true },
  { id: "coins_999", productId: "shadow_coins_999", baseCoins: 99900, bonusCoins: 25100, totalCoins: 125000, enabled: true },
  { id: "coins_2499", productId: "shadow_coins_2499", baseCoins: 249900, bonusCoins: 80100, totalCoins: 330000, enabled: true },
  { id: "coins_4999", productId: "shadow_coins_4999", baseCoins: 499900, bonusCoins: 200100, totalCoins: 700000, enabled: true },
  { id: "coins_9999", productId: "shadow_coins_9999", baseCoins: 999900, bonusCoins: 500100, totalCoins: 1500000, enabled: true },
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
    ? raw.map((item) => {
        const baseCoins = Number(item?.baseCoins || 0);
        const bonusCoins = Number(item?.bonusCoins || 0);
        return {
          id: clean(item?.id),
          productId: clean(item?.productId),
          baseCoins,
          bonusCoins,
          totalCoins: baseCoins + bonusCoins,
          enabled: item?.enabled !== false,
        };
      })
    : FALLBACK_PACKAGES;

  const item = packages.find(
    (entry) =>
      entry.productId === productId &&
      entry.enabled === true &&
      Number.isSafeInteger(entry.baseCoins) &&
      entry.baseCoins > 0 &&
      Number.isSafeInteger(entry.bonusCoins) &&
      entry.bonusCoins >= 0 &&
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

export async function creditPurchase(
  db,
  uid,
  hash,
  productId,
  packageName,
  rechargePackage,
  verified,
  quantity,
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const transaction = await db.beginTransaction();
    try {
      const [userSnap, publicProfileSnap, purchaseSnap, lockSnap, vipPolicy] =
        await Promise.all([
          db.get(`users/${uid}`, transaction),
          db.get(`public_profiles/${uid}`, transaction),
          db.get(`google_play_purchases/${hash}`, transaction),
          db.get("system_config/emergency_lock", transaction),
          loadVipPolicy(db, { transaction, useCache: false }),
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
          baseCoins: Number(purchaseSnap.data?.baseCoins || 0),
          bonusCoins: Number(purchaseSnap.data?.bonusCoins || 0),
          vipGrowthPoints: Number(purchaseSnap.data?.vipGrowthPoints || 0),
          vipLevel: Number(purchaseSnap.data?.vipLevel || 0),
          closingCoins: null,
        };
      }

      const user = userSnap.data || {};
      const openingCoins = Number(user.coins ?? user.balance ?? 0);
      if (!Number.isSafeInteger(openingCoins) || openingCoins < 0) {
        throw new ApiError("invalid_wallet_state", 400);
      }

      const baseCoinsToCredit = rechargePackage.baseCoins * quantity;
      const bonusCoinsToCredit = rechargePackage.bonusCoins * quantity;
      const coinsToCredit = baseCoinsToCredit + bonusCoinsToCredit;
      if (
        !Number.isSafeInteger(baseCoinsToCredit) ||
        baseCoinsToCredit <= 0 ||
        !Number.isSafeInteger(bonusCoinsToCredit) ||
        bonusCoinsToCredit < 0 ||
        !Number.isSafeInteger(coinsToCredit)
      ) {
        throw new ApiError("invalid_recharge_package", 400);
      }

      const now = new Date();
      const nowMs = now.getTime();
      const vipGrowthPoints = growthFromPaidRecharge(
        vipPolicy,
        baseCoinsToCredit,
      );
      if (vipGrowthPoints === null) {
        throw new ApiError("invalid_vip_growth_award", 409);
      }
      const vipBefore = materializeVipState(
        vipPolicy,
        vipStateFromUser(user),
        nowMs,
      );
      const vipAfter = applyVipGrowth(
        vipPolicy,
        vipBefore,
        vipGrowthPoints,
        nowMs,
      );
      if (!vipAfter) {
        throw new ApiError("invalid_vip_state", 409);
      }

      const closingCoins = openingCoins + coinsToCredit;
      const trialGrant = vip10TrialCardGrantWrites(
        db,
        uid,
        user,
        vipPolicy,
        vipBefore,
        vipAfter,
        nowMs,
      );

      await db.commit(transaction, [
        db.writeUpdate(
          `users/${uid}`,
          {
            coins: closingCoins,
            walletUpdatedAt: now,
            ...vipUserPatch(vipAfter, now),
            ...trialGrant.userPatch,
          },
          [
            "coins",
            "walletUpdatedAt",
            "earnedVipLevel",
            "effectiveVipLevel",
            "adminGrantVipLevel",
            "trialVipLevel",
            "earnedVipExpiresAt",
            "adminGrantExpiresAt",
            "trialVipExpiresAt",
            "effectiveVipSource",
            "vipGrowthPoints",
            "vipMaintenancePoints",
            "vipLevel",
            "vipExpiresAt",
            "vipSource",
            "vipUpdatedAt",
            ...Object.keys(trialGrant.userPatch),
          ],
        ),
        ...(publicProfileSnap.exists
          ? [
              db.writeUpdate(
                `public_profiles/${uid}`,
                vipPublicProfilePatch(vipAfter, now),
                [
                  "vipLevel",
                  "effectiveVipLevel",
                  "vipExpiresAt",
                  "updatedAt",
                ],
              ),
            ]
          : []),
        db.writeUpdate(
          `google_play_purchases/${hash}`,
          {
            uid,
            tokenHash: hash,
            productId,
            packageId: rechargePackage.id,
            packageName,
            quantity,
            baseCoins: baseCoinsToCredit,
            bonusCoins: bonusCoinsToCredit,
            coins: coinsToCredit,
            vipGrowthPoints,
            vipLevel: vipAfter.effectiveVipLevel,
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
        db.writeCreate(`vip_growth_history/play_${hash}`, {
          userId: uid,
          eventType: "paid_recharge_growth",
          source: "google_play",
          deltaGrowthPoints: vipGrowthPoints,
          growthPointsBefore: vipBefore.growthPoints,
          growthPointsAfter: vipAfter.growthPoints,
          earnedVipBefore: vipBefore.earnedVipLevel,
          earnedVipAfter: vipAfter.earnedVipLevel,
          effectiveVipAfter: vipAfter.effectiveVipLevel,
          baseCoins: baseCoinsToCredit,
          bonusCoinsExcluded: bonusCoinsToCredit,
          purchaseId: hash,
          productId,
          packageId: rechargePackage.id,
          createdAt: now,
        }),
        ...trialGrant.writes,
      ]);

      return {
        duplicate: false,
        coins: coinsToCredit,
        baseCoins: baseCoinsToCredit,
        bonusCoins: bonusCoinsToCredit,
        vipGrowthPoints,
        vipLevel: vipAfter.effectiveVipLevel,
        trialCardsGranted: trialGrant.cardIds,
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
        baseCoins: Number(existing.data?.baseCoins || 0),
        bonusCoins: Number(existing.data?.bonusCoins || 0),
        vipGrowthPoints: Number(existing.data?.vipGrowthPoints || 0),
        vipLevel: Number(existing.data?.vipLevel || 0),
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
    const result = await creditPurchase(
      db,
      decoded.sub,
      hash,
      productId,
      packageName,
      rechargePackage,
      verified,
      quantity,
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
      baseCoins: result.baseCoins,
      bonusCoins: result.bonusCoins,
      vipGrowthPoints: result.vipGrowthPoints,
      vipLevel: result.vipLevel,
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
