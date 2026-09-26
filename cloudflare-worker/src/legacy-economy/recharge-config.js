import { getApps, initializeApp, cert, getAuth, FieldValue, getFirestore, legacyEnv } from "../legacy-firebase-admin-shim.js";
import { assertUserDocumentSessionState } from "../firebase-auth.js";
import { invalidateConfigCache, readThroughConfigCache } from "../config-cache.js";

function parseServiceAccount(raw) {
  const text = String(raw || "").trim();
  if (!text) throw Error("server_not_configured");
  let sa = JSON.parse(text);
  if (typeof sa === "string") sa = JSON.parse(sa);
  const projectId = sa.project_id || sa.projectId;
  const clientEmail = sa.client_email || sa.clientEmail;
  const privateKey = String(sa.private_key || sa.privateKey || "").replace(/\\n/g, "\n");
  if (!projectId || !clientEmail || !privateKey) throw Error("invalid_service_account_json");
  return { projectId, clientEmail, privateKey };
}

function initFirebase() {
  if (!getApps().length) {
    const sa = parseServiceAccount(legacyEnv.FIREBASE_SERVICE_ACCOUNT);
    initializeApp({ credential: cert(sa), projectId: sa.projectId });
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
const clean = (value) => String(value ?? "").trim();

async function authenticatedUser(req) {
  const authorization = clean(req.headers.authorization);
  if (!authorization.startsWith("Bearer ")) throw Error("unauthorized");
  return getAuth().verifyIdToken(authorization.slice(7), {checkUserState:false});
}

async function getActor(req) {
  const decoded = await authenticatedUser(req);
  const db = getFirestore();
  const snap = await db.collection("users").doc(decoded.uid).get();
  if (!snap.exists) throw Error("forbidden");
  const actor = snap.data() || {};
  assertUserDocumentSessionState(decoded, actor);
  const caps = Array.isArray(actor.capabilities) ? actor.capabilities : [];
  const allowed =
    actor.role === "owner" ||
    (actor.adminEnabled === true && caps.includes("manageEconomy"));
  if (!allowed) throw Error("forbidden");
  return { uid: decoded.uid, actor, db };
}

async function cachedRechargeState(db) {
  return readThroughConfigCache(
    "config:recharge",
    async () => {
      const snap = await db.collection("system_config").doc("recharge").get();
      return {
        exists: snap.exists,
        config: snap.exists ? snap.data() : null,
      };
    },
    { ttlMs: 30_000, staleMs: 5 * 60_000 },
  );
}

function publicPackages(config) {
  const raw = Array.isArray(config?.packages) ? config.packages : [];
  return raw
    .filter((item) => item && item.enabled !== false)
    .map((item) => ({
      id: clean(item.id),
      productId: clean(item.productId),
      priceUsd: Number(item.priceUsd || 0),
      baseCoins: Number(item.baseCoins || 0),
      bonusCoins: Number(item.bonusCoins || 0),
      enabled: item.enabled !== false,
      badge: clean(item.badge),
      sortOrder: Number(item.sortOrder || 0),
      imageAsset: clean(item.imageAsset),
    }))
    .filter((item) =>
      item.id &&
      item.productId &&
      Number.isFinite(item.priceUsd) &&
      item.priceUsd > 0 &&
      Number.isSafeInteger(item.baseCoins) &&
      item.baseCoins > 0 &&
      Number.isSafeInteger(item.bonusCoins) &&
      item.bonusCoins >= 0
    )
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

function validatePackages(raw) {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 20) {
    throw Error("invalid_packages");
  }
  const ids = new Set();
  const products = new Set();
  const result = raw.map((item, index) => {
    const id = clean(item?.id);
    const productId = clean(item?.productId);
    const priceUsd = Number(item?.priceUsd);
    const baseCoins = Number(item?.baseCoins);
    const bonusCoins = Number(item?.bonusCoins);
    const enabled = item?.enabled !== false;
    const badge = clean(item?.badge).slice(0, 40);
    const imageAsset = clean(item?.imageAsset).slice(0, 220);
    if (!/^[a-z0-9_]{3,64}$/.test(id)) throw Error("invalid_package_id");
    if (!/^[a-z0-9_.]{3,120}$/.test(productId)) throw Error("invalid_product_id");
    if (!Number.isFinite(priceUsd) || priceUsd <= 0 || priceUsd > 10000) throw Error("invalid_price");
    if (!Number.isSafeInteger(baseCoins) || baseCoins < 1 || baseCoins > 1000000000) throw Error("invalid_coins");
    if (!Number.isSafeInteger(bonusCoins) || bonusCoins < 0 || bonusCoins > 1000000000) throw Error("invalid_bonus");
    if (ids.has(id) || products.has(productId)) throw Error("duplicate_package");
    ids.add(id);
    products.add(productId);
    return {
      id,
      productId,
      priceUsd: Math.round(priceUsd * 100) / 100,
      baseCoins,
      bonusCoins,
      enabled,
      badge,
      sortOrder: index,
      imageAsset,
    };
  });
  return result;
}

export async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== "POST") return out(res, 405, { ok: false, code: "method_not_allowed" });

  try {
    initFirebase();
    const action = clean(req.body?.action);

    if (action === "packages") {
      await authenticatedUser(req);
      const db = getFirestore();
      const state = await cachedRechargeState(db);
      return out(res, 200, {
        ok: true,
        coinsPerUsd: 10000,
        packages: publicPackages(state.config),
      });
    }

    const { uid, db } = await getActor(req);

    if (action === "state") {
      const state = await cachedRechargeState(db);
      return out(res, 200, {
        ok: true,
        exists: state.exists,
        config: state.config,
      });
    }

    if (action === "save") {
      const packages = validatePackages(req.body?.packages);
      const ref = db.collection("system_config").doc("recharge");
      const auditRef = db.collection("admin_audit_logs").doc();
      const previous = await ref.get();
      const next = {
        coinsPerUsd: 10000,
        packages,
        updatedBy: uid,
        updatedAt: FieldValue.serverTimestamp(),
      };
      await db.runTransaction(async (tx) => {
        tx.set(ref, next, { merge: true });
        tx.create(auditRef, {
          actorUid: uid,
          action: "updateRechargeConfig",
          targetType: "system_config",
          targetId: "recharge",
          before: previous.exists ? previous.data() : null,
          after: {
            coinsPerUsd: 10000,
            packageCount: packages.length,
            enabledCount: packages.filter((p) => p.enabled).length,
          },
          createdAt: FieldValue.serverTimestamp(),
        });
      });
      invalidateConfigCache("config:recharge");
      return out(res, 200, { ok: true, packages });
    }

    return out(res, 400, { ok: false, code: "invalid_action" });
  } catch (error) {
    const code = clean(error?.message) || "server_error";
    const status =
      code === "unauthorized" ? 401 :
      code === "forbidden" ? 403 :
      [
        "invalid_packages",
        "invalid_package_id",
        "invalid_product_id",
        "invalid_price",
        "invalid_coins",
        "invalid_bonus",
        "duplicate_package",
        "invalid_action",
      ].includes(code) ? 400 : 500;
    return out(res, status, { ok: false, code });
  }
}
