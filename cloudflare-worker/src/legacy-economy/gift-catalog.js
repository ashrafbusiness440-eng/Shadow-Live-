import { getApps, initializeApp, cert, getAuth, FieldValue, getFirestore, legacyEnv } from "../legacy-firebase-admin-shim.js";
import { assertUserDocumentSessionState } from "../firebase-auth.js";
import { invalidateConfigCache, readThroughConfigCache } from "../config-cache.js";

const CATEGORIES = new Set([
  "general",
  "countries",
  "celebrities",
  "vip",
  "lucky",
  "activities",
]);

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
  if (!projectId || !clientEmail || !privateKey) {
    throw Error("invalid_service_account_json");
  }
  return { projectId, clientEmail, privateKey };
}

function initFirebase() {
  if (!getApps().length) {
    const sa = parseServiceAccount(legacyEnv.FIREBASE_SERVICE_ACCOUNT);
    initializeApp({
      credential: cert(sa),
      projectId: sa.projectId,
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

async function authenticatedUser(req) {
  const authorization = clean(req.headers.authorization);
  if (!authorization.startsWith("Bearer ")) throw Error("unauthorized");
  return getAuth().verifyIdToken(authorization.slice(7), {checkUserState:false});
}

async function actor(req) {
  const decoded = await authenticatedUser(req);
  const db = getFirestore();
  const snap = await db.collection("users").doc(decoded.uid).get();
  if (!snap.exists) throw Error("forbidden");
  const user = snap.data() || {};
  assertUserDocumentSessionState(decoded, user);
  const caps = Array.isArray(user.capabilities) ? user.capabilities : [];
  const allowed =
    user.role === "owner" ||
    (user.adminEnabled === true && caps.includes("manageEconomy"));
  if (!allowed) throw Error("forbidden");
  return { uid: decoded.uid, db };
}

async function cachedCatalogState(db) {
  return readThroughConfigCache(
    "config:gift_catalog",
    async () => {
      const snap = await db.collection("system_config").doc("gift_catalog").get();
      return {
        exists: snap.exists,
        config: snap.exists ? snap.data() : null,
      };
    },
    { ttlMs: 30_000, staleMs: 5 * 60_000 },
  );
}

function publicCatalog(config) {
  const raw = Array.isArray(config?.gifts) ? config.gifts : [];
  return raw
    .filter((item) => item && item.enabled !== false)
    .map((item) => ({
      id: clean(item.id),
      nameAr: clean(item.nameAr),
      priceCoins: Number(item.priceCoins || 0),
      category: clean(item.category || "general"),
      enabled: item.enabled !== false,
      featured: item.featured === true,
      sortOrder: Number(item.sortOrder || 0),
      assetKey: clean(item.assetKey || "gifts.placeholder.default"),
      localPlaceholder: clean(
        item.localPlaceholder || "assets/images/gifts/gift_placeholder.webp",
      ),
    }))
    .filter((item) =>
      item.id &&
      item.nameAr &&
      Number.isSafeInteger(item.priceCoins) &&
      item.priceCoins > 0 &&
      CATEGORIES.has(item.category)
    )
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

function validateGifts(raw) {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 100) {
    throw Error("invalid_gifts");
  }

  const ids = new Set();
  return raw.map((item, index) => {
    const id = clean(item?.id);
    const nameAr = clean(item?.nameAr);
    const priceCoins = Number(item?.priceCoins);
    const category = clean(item?.category);
    const enabled = item?.enabled !== false;
    const featured = item?.featured === true;
    const assetKey = clean(item?.assetKey || "gifts.placeholder.default");
    const localPlaceholder = clean(
      item?.localPlaceholder || "assets/images/gifts/gift_placeholder.webp",
    );

    if (!/^[a-z0-9_]{2,64}$/.test(id)) throw Error("invalid_gift_id");
    if (ids.has(id)) throw Error("duplicate_gift_id");
    ids.add(id);

    if (nameAr.length < 1 || nameAr.length > 80) throw Error("invalid_gift_name");
    if (
      !Number.isSafeInteger(priceCoins) ||
      priceCoins < 1 ||
      priceCoins > 1000000000
    ) {
      throw Error("invalid_gift_price");
    }
    if (!CATEGORIES.has(category)) throw Error("invalid_gift_category");
    if (!/^[a-z0-9][a-z0-9._-]{2,119}$/.test(assetKey)) {
      throw Error("invalid_asset_key");
    }
    if (
      !localPlaceholder.startsWith("assets/images/gifts/") ||
      localPlaceholder.length > 220
    ) {
      throw Error("invalid_placeholder_path");
    }

    return {
      id,
      nameAr,
      priceCoins,
      category,
      enabled,
      featured,
      sortOrder: index,
      assetKey,
      localPlaceholder,
    };
  });
}

export async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== "POST") {
    return out(res, 405, { ok: false, code: "method_not_allowed" });
  }

  try {
    initFirebase();
    const action = clean(req.body?.action);

    if (action === "catalog") {
      await authenticatedUser(req);
      const db = getFirestore();
      const state = await cachedCatalogState(db);
      return out(res, 200, {
        ok: true,
        gifts: publicCatalog(state.config),
      });
    }

    const { uid, db } = await actor(req);
    const ref = db.collection("system_config").doc("gift_catalog");

    if (action === "state") {
      const state = await cachedCatalogState(db);
      return out(res, 200, {
        ok: true,
        exists: state.exists,
        config: state.config,
      });
    }

    if (action === "save") {
      const gifts = validateGifts(req.body?.gifts);
      const previous = await ref.get();
      const auditRef = db.collection("admin_audit_logs").doc();
      const next = {
        gifts,
        categories: Array.from(CATEGORIES),
        updatedBy: uid,
        updatedAt: FieldValue.serverTimestamp(),
      };

      await db.runTransaction(async (tx) => {
        tx.set(ref, next, { merge: true });
        tx.create(auditRef, {
          actorUid: uid,
          action: "updateGiftCatalog",
          targetType: "system_config",
          targetId: "gift_catalog",
          before: previous.exists
            ? {
                giftCount: Array.isArray(previous.data()?.gifts)
                  ? previous.data().gifts.length
                  : 0,
              }
            : null,
          after: {
            giftCount: gifts.length,
            enabledCount: gifts.filter((gift) => gift.enabled).length,
            featuredCount: gifts.filter((gift) => gift.featured).length,
          },
          createdAt: FieldValue.serverTimestamp(),
        });
      });

      invalidateConfigCache("config:gift_catalog");
      return out(res, 200, { ok: true, gifts });
    }

    return out(res, 400, { ok: false, code: "invalid_action" });
  } catch (error) {
    const code = clean(error?.message) || "server_error";
    const status =
      code === "unauthorized"
        ? 401
        : code === "forbidden"
          ? 403
          : [
              "invalid_gifts",
              "invalid_gift_id",
              "duplicate_gift_id",
              "invalid_gift_name",
              "invalid_gift_price",
              "invalid_gift_category",
              "invalid_asset_key",
              "invalid_placeholder_path",
              "invalid_action",
            ].includes(code)
            ? 400
            : 500;

    return out(res, status, { ok: false, code });
  }
}
