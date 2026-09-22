import { createHash } from "node:crypto";
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { GoogleAuth } from "google-auth-library";

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

function clean(value) {
  return String(value ?? "").trim();
}

function parseServiceAccount(raw) {
  const text = clean(raw);
  if (!text) throw Error("server_not_configured");
  let sa = JSON.parse(text);
  if (typeof sa === "string") sa = JSON.parse(sa);
  const projectId = sa.project_id || sa.projectId;
  const clientEmail = sa.client_email || sa.clientEmail;
  const privateKey = String(sa.private_key || sa.privateKey || "").replace(/\\n/g, "\n");
  if (!projectId || !clientEmail || !privateKey) throw Error("invalid_service_account_json");
  return {
    project_id: projectId,
    client_email: clientEmail,
    private_key: privateKey,
  };
}

function initFirebase() {
  if (!getApps().length) {
    const sa = parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT);
    initializeApp({
      credential: cert({
        projectId: sa.project_id,
        clientEmail: sa.client_email,
        privateKey: sa.private_key,
      }),
      projectId: sa.project_id,
    });
  }
}

function cors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true;
  }
  return false;
}

const out = (res, status, body) => res.status(status).json(body);

async function actor(req) {
  const authorization = clean(req.headers.authorization);
  if (!authorization.startsWith("Bearer ")) throw Error("unauthorized");
  const decoded = await getAuth().verifyIdToken(authorization.slice(7));
  if (decoded.firebase?.sign_in_provider === "anonymous") {
    throw Error("account_required");
  }
  return decoded;
}

function tokenHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

function accountHash(uid) {
  return createHash("sha256").update(uid).digest("hex");
}

async function loadPackage(db, productId) {
  const snap = await db.collection("system_config").doc("recharge").get();
  const raw = snap.data()?.packages;
  const packages = Array.isArray(raw)
    ? raw.map((item) => ({
        id: clean(item?.id),
        productId: clean(item?.productId),
        totalCoins:
          Number(item?.baseCoins || 0) + Number(item?.bonusCoins || 0),
        enabled: item?.enabled !== false,
      }))
    : FALLBACK_PACKAGES;

  const packageItem = packages.find(
    (item) =>
      item.productId === productId &&
      item.enabled === true &&
      Number.isSafeInteger(item.totalCoins) &&
      item.totalCoins > 0,
  );
  if (!packageItem) throw Error("unknown_product");
  return packageItem;
}

async function playClient() {
  const raw =
    process.env.GOOGLE_PLAY_SERVICE_ACCOUNT ||
    process.env.FIREBASE_SERVICE_ACCOUNT;
  const sa = parseServiceAccount(raw);
  const auth = new GoogleAuth({
    credentials: {
      client_email: sa.client_email,
      private_key: sa.private_key,
    },
    scopes: [PLAY_SCOPE],
  });
  return auth.getClient();
}

async function verifyWithGoogle(client, packageName, purchaseToken) {
  const url =
    "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/" +
    encodeURIComponent(packageName) +
    "/purchases/productsv2/tokens/" +
    encodeURIComponent(purchaseToken);

  const response = await client.request({ url, method: "GET" });
  const data = response.data || {};
  const state = clean(data?.purchaseStateContext?.purchaseState);
  if (state !== "PURCHASED") {
    if (state === "PENDING") throw Error("purchase_pending");
    throw Error("purchase_not_valid");
  }
  return data;
}

async function consumePurchase(client, packageName, productId, purchaseToken) {
  const url =
    "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/" +
    encodeURIComponent(packageName) +
    "/purchases/products/" +
    encodeURIComponent(productId) +
    "/tokens/" +
    encodeURIComponent(purchaseToken) +
    ":consume";
  await client.request({ url, method: "POST" });
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== "POST") {
    return out(res, 405, { ok: false, code: "method_not_allowed" });
  }

  try {
    initFirebase();
    const decoded = await actor(req);
    const body = req.body || {};
    const purchaseToken = clean(body.purchaseToken);
    const productId = clean(body.productId);
    const packageName = clean(
      process.env.GOOGLE_PLAY_PACKAGE_NAME || "com.shadowlive.app",
    );

    if (
      purchaseToken.length < 20 ||
      purchaseToken.length > 4096 ||
      !/^[a-z0-9_.]{3,120}$/.test(productId) ||
      !/^[A-Za-z0-9_.]+$/.test(packageName)
    ) {
      return out(res, 400, { ok: false, code: "invalid_request" });
    }

    const db = getFirestore();
    const rechargePackage = await loadPackage(db, productId);
    const hash = tokenHash(purchaseToken);
    const purchaseRef = db.collection("google_play_purchases").doc(hash);
    const existing = await purchaseRef.get();

    const client = await playClient();

    if (existing.exists && existing.data()?.status === "credited") {
      try {
        await consumePurchase(client, packageName, productId, purchaseToken);
      } catch (_) {}
      return out(res, 200, {
        ok: true,
        code: "duplicate",
        purchaseId: hash,
        coins: Number(existing.data()?.coins || 0),
      });
    }

    const verified = await verifyWithGoogle(
      client,
      packageName,
      purchaseToken,
    );

    const lineItems = Array.isArray(verified.productLineItem)
      ? verified.productLineItem
      : [];
    const lineItem = lineItems.find(
      (item) => clean(item?.productId) === productId,
    );
    if (!lineItem) throw Error("product_mismatch");

    const externalAccountId = clean(verified.obfuscatedExternalAccountId);
    const expectedAccountId = accountHash(decoded.uid);
    if (!externalAccountId || externalAccountId !== expectedAccountId) {
      throw Error("account_mismatch");
    }

    const consumptionState = clean(
      lineItem?.productOfferDetails?.consumptionState,
    );
    if (consumptionState === "CONSUMPTION_STATE_CONSUMED") {
      throw Error("purchase_already_consumed");
    }

    const quantityRaw = Number(lineItem?.productOfferDetails?.quantity || 1);
    const quantity =
      Number.isSafeInteger(quantityRaw) && quantityRaw > 0 && quantityRaw <= 20
        ? quantityRaw
        : 1;
    const coinsToCredit = rechargePackage.totalCoins * quantity;

    const userRef = db.collection("users").doc(decoded.uid);
    const ledgerRef = db
      .collection("financial_ledger")
      .doc("play_" + hash);

    const result = await db.runTransaction(async (tx) => {
      const [userSnap, purchaseSnap, lockSnap] = await Promise.all([
        tx.get(userRef),
        tx.get(purchaseRef),
        tx.get(db.collection("system_config").doc("emergency_lock")),
      ]);

      if (!userSnap.exists) throw Error("user_not_found");
      const economyLock = lockSnap.exists ? (lockSnap.data() || {}) : {};
      if (
        economyLock.enabled === true ||
        economyLock.economyLocked === true ||
        economyLock.rechargeLocked === true
      ) {
        throw Error("emergency_locked");
      }

      if (purchaseSnap.exists && purchaseSnap.data()?.status === "credited") {
        return {
          duplicate: true,
          coins: Number(purchaseSnap.data()?.coins || 0),
        };
      }

      const user = userSnap.data() || {};
      const openingCoins = Number(user.coins ?? user.balance ?? 0);
      if (!Number.isFinite(openingCoins) || openingCoins < 0) {
        throw Error("invalid_wallet_state");
      }
      const closingCoins = openingCoins + coinsToCredit;

      tx.update(userRef, {
        coins: closingCoins,
        walletUpdatedAt: FieldValue.serverTimestamp(),
      });

      tx.set(purchaseRef, {
        uid: decoded.uid,
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
        creditedAt: FieldValue.serverTimestamp(),
      });

      tx.create(ledgerRef, {
        userId: decoded.uid,
        asset: "coins",
        delta: coinsToCredit,
        openingBalance: openingCoins,
        closingBalance: closingCoins,
        reason: "google_play_recharge",
        sourceType: "googlePlayPurchase",
        sourceId: hash,
        actorUid: decoded.uid,
        productId,
        packageId: rechargePackage.id,
        quantity,
        idempotencyKey: hash,
        createdAt: FieldValue.serverTimestamp(),
      });

      return {
        duplicate: false,
        coins: coinsToCredit,
        closingCoins,
      };
    });

    let consumed = true;
    try {
      await consumePurchase(client, packageName, productId, purchaseToken);
      await purchaseRef.set(
        {
          consumed: true,
          consumedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    } catch (_) {
      consumed = false;
      await purchaseRef.set(
        {
          consumed: false,
          consumeRetryRequired: true,
          consumeLastAttemptAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }

    return out(res, 200, {
      ok: true,
      code: result.duplicate ? "duplicate" : "ok",
      purchaseId: hash,
      coins: result.coins,
      balance: result.closingCoins,
      consumed,
    });
  } catch (error) {
    const raw = clean(error?.message) || "server_error";
    const known = [
      "account_required",
      "unknown_product",
      "purchase_pending",
      "purchase_not_valid",
      "product_mismatch",
      "account_mismatch",
      "purchase_already_consumed",
      "user_not_found",
      "emergency_locked",
      "invalid_wallet_state",
    ];
    const code = known.includes(raw) ? raw : "play_verification_failed";
    const status =
      code === "account_required" ? 403 :
      code === "user_not_found" ? 404 :
      ["purchase_pending", "emergency_locked"].includes(code) ? 409 :
      [
        "unknown_product",
        "purchase_not_valid",
        "product_mismatch",
        "account_mismatch",
        "purchase_already_consumed",
        "invalid_wallet_state",
      ].includes(code) ? 400 : 500;

    return out(res, status, { ok: false, code });
  }
}
