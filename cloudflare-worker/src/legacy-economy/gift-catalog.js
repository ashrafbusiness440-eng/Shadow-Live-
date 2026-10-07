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
  "cp",
  "friends",
]);

const EFFECT_MODES = new Set(["none", "seat", "cinematic"]);

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

function giftMinVipLevel(item = {}) {
  const explicit = Number(item.minVipLevel);
  if (Number.isSafeInteger(explicit) && explicit >= 0 && explicit <= 10) {
    return explicit;
  }
  return clean(item.category) === "vip" ? 4 : 0;
}

async function publicGiftBag(db, uid) {
  const snapshot = await db
    .collection("user_gift_bags")
    .doc(uid)
    .collection("items")
    .limit(100)
    .get();
  return snapshot.docs
    .map((doc) => {
      const data = doc.data() || {};
      const quantity = Number(data.quantity || 0);
      return {
        giftId: clean(data.giftId || doc.id),
        quantity:
          Number.isSafeInteger(quantity) && quantity > 0 ? quantity : 0,
        source: clean(data.source || "admin"),
      };
    })
    .filter((item) => item.giftId && item.quantity > 0)
    .slice(0, 100);
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
      minVipLevel: giftMinVipLevel(item),
      assetKey: clean(item.assetKey || "gifts.placeholder.default"),
      localPlaceholder: clean(
        item.localPlaceholder || "assets/images/gifts/gift_placeholder.webp",
      ),
      isAnimated: item.isAnimated === true,
      effectMode: EFFECT_MODES.has(clean(item.effectMode))
        ? clean(item.effectMode)
        : "none",
      effectAssetKey: clean(
        item.effectAssetKey || item.assetKey || "gifts.placeholder.default",
      ),
      effectSoundAssetKey: clean(item.effectSoundAssetKey),
      effectMinQuantity: Math.max(0, Number(item.effectMinQuantity || 0)),
      effectDurationMs: Math.max(
        300,
        Math.min(12000, Number(item.effectDurationMs || 2200)),
      ),
      effectSize: Math.max(
        0,
        Math.min(420, Number(item.effectSize || 0)),
      ),
      premiumBannerMinQuantity: Math.max(
        0,
        Number(item.premiumBannerMinQuantity || 0),
      ),
      affinityBasePoints: Math.max(0, Number(item.affinityBasePoints || 0)),
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
    const rawMinVipLevel = Number(item?.minVipLevel ?? (category === "vip" ? 4 : 0));
    const minVipLevel =
      Number.isSafeInteger(rawMinVipLevel) && rawMinVipLevel >= 0 && rawMinVipLevel <= 10
        ? rawMinVipLevel
        : -1;
    const assetKey = clean(item?.assetKey || "gifts.placeholder.default");
    const localPlaceholder = clean(
      item?.localPlaceholder || "assets/images/gifts/gift_placeholder.webp",
    );
    const isAnimated = item?.isAnimated === true;
    const effectMode = clean(item?.effectMode || "none");
    const effectAssetKey = clean(item?.effectAssetKey || assetKey);
    const effectSoundAssetKey = clean(item?.effectSoundAssetKey);
    const effectMinQuantity = Number(item?.effectMinQuantity || 0);
    const effectDurationMs = Number(item?.effectDurationMs || 2200);
    const effectSize = Number(item?.effectSize || 0);
    const premiumBannerMinQuantity = Number(
      item?.premiumBannerMinQuantity || 0,
    );
    const affinityBasePoints = Number(item?.affinityBasePoints || 0);
    const relationshipGift = category === "cp" || category === "friends";

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
    if (minVipLevel < 0) throw Error("invalid_gift_vip_level");
    if (!/^[a-z0-9][a-z0-9._-]{2,119}$/.test(assetKey)) {
      throw Error("invalid_asset_key");
    }
    if (
      !localPlaceholder.startsWith("assets/images/gifts/") ||
      localPlaceholder.length > 220
    ) {
      throw Error("invalid_placeholder_path");
    }
    if (!EFFECT_MODES.has(effectMode)) throw Error("invalid_effect_mode");
    if (
      !/^[a-z0-9][a-z0-9._-]{2,119}$/.test(effectAssetKey)
    ) {
      throw Error("invalid_effect_asset_key");
    }
    if (
      effectSoundAssetKey &&
      !/^[a-z0-9][A-Za-z0-9._-]{2,119}$/.test(effectSoundAssetKey)
    ) {
      throw Error("invalid_effect_sound_asset_key");
    }
    if (
      !Number.isSafeInteger(effectMinQuantity) ||
      effectMinQuantity < 0 ||
      effectMinQuantity > 777 ||
      (effectMode === "none" && effectMinQuantity !== 0) ||
      (effectMode !== "none" && effectMinQuantity < 1)
    ) {
      throw Error("invalid_effect_min_quantity");
    }
    if (
      !Number.isSafeInteger(effectDurationMs) ||
      effectDurationMs < 300 ||
      effectDurationMs > 12000
    ) {
      throw Error("invalid_effect_duration");
    }
    if (
      !Number.isSafeInteger(effectSize) ||
      effectSize < 0 ||
      effectSize > 420 ||
      (effectSize > 0 && effectSize < 40)
    ) {
      throw Error("invalid_effect_size");
    }
    if (
      !Number.isSafeInteger(premiumBannerMinQuantity) ||
      premiumBannerMinQuantity < 0 ||
      premiumBannerMinQuantity > 777
    ) {
      throw Error("invalid_premium_banner_quantity");
    }
    if (
      !Number.isSafeInteger(affinityBasePoints) ||
      affinityBasePoints < 0 ||
      affinityBasePoints > 1000000000 ||
      (relationshipGift &&
        (affinityBasePoints < 2 || affinityBasePoints % 2 !== 0)) ||
      (!relationshipGift && affinityBasePoints !== 0)
    ) {
      throw Error("invalid_affinity_base_points");
    }

    return {
      id,
      nameAr,
      priceCoins,
      category,
      enabled,
      featured,
      minVipLevel,
      sortOrder: index,
      assetKey,
      localPlaceholder,
      isAnimated,
      effectMode,
      effectAssetKey,
      effectSoundAssetKey,
      effectMinQuantity,
      effectDurationMs,
      effectSize,
      premiumBannerMinQuantity,
      affinityBasePoints,
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
      const decoded = await authenticatedUser(req);
      const db = getFirestore();
      const [state, userSnap, bag] = await Promise.all([
        cachedCatalogState(db),
        db.collection("users").doc(decoded.uid).get(),
        publicGiftBag(db, decoded.uid),
      ]);
      if (!userSnap.exists) throw Error("forbidden");
      const user = userSnap.data() || {};
      assertUserDocumentSessionState(decoded, user);
      const balance = Math.max(0, Number(user.coins ?? user.balance ?? 0));
      return out(res, 200, {
        ok: true,
        gifts: publicCatalog(state.config),
        bag,
        balance: Number.isSafeInteger(balance) ? balance : 0,
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
            vipOnlyCount: gifts.filter((gift) => gift.minVipLevel > 0).length,
          },
          createdAt: FieldValue.serverTimestamp(),
        });
      });

      invalidateConfigCache("config:gift_catalog");
      return out(res, 200, { ok: true, gifts });
    }

    if (action === "grantBagGift") {
      const targetUserId = clean(
        req.body?.targetUserId || req.body?.targetUid,
      );
      const giftId = clean(req.body?.giftId);
      const quantity = Number(req.body?.quantity || 0);
      const source = clean(req.body?.source || "admin");
      if (
        !/^[A-Za-z0-9_-]{1,180}$/.test(targetUserId) ||
        !/^[a-z0-9_]{2,64}$/.test(giftId) ||
        !Number.isSafeInteger(quantity) ||
        quantity < 1 ||
        quantity > 9999 ||
        !["admin", "event", "free"].includes(source)
      ) {
        throw Error("invalid_bag_grant");
      }

      const state = await cachedCatalogState(db);
      const gift = publicCatalog(state.config)
        .find((item) => item.id === giftId);
      if (!gift) throw Error("gift_not_found");

      let target = await db.collection("users").doc(targetUserId).get();
      let targetUid = target.exists ? target.id : "";
      if (!target.exists) {
        const byPublicId = await db
          .collection("users")
          .where("publicId", "==", targetUserId)
          .limit(2)
          .get();
        if (byPublicId.size !== 1) throw Error("target_not_found");
        target = byPublicId.docs[0];
        targetUid = target.id;
      }

      const itemRef = db
        .collection("user_gift_bags")
        .doc(targetUid)
        .collection("items")
        .doc(giftId);
      const auditRef = db.collection("admin_audit_logs").doc();
      const now = FieldValue.serverTimestamp();
      const batch = db.batch();
      batch.set(
        itemRef,
        {
          giftId,
          quantity: FieldValue.increment(quantity),
          source,
          lastGrantedBy: uid,
          updatedAt: now,
        },
        { merge: true },
      );
      batch.create(auditRef, {
        actorUid: uid,
        action: "grantGiftBagItem",
        targetType: "user",
        targetId: targetUid,
        giftId,
        quantity,
        source,
        createdAt: now,
      });
      await batch.commit();
      return out(res, 200, {
        ok: true,
        targetUid,
        giftId,
        quantityGranted: quantity,
        source,
      });
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
              "invalid_gift_vip_level",
              "invalid_asset_key",
              "invalid_placeholder_path",
              "invalid_effect_mode",
              "invalid_effect_asset_key",
              "invalid_effect_sound_asset_key",
              "invalid_effect_min_quantity",
              "invalid_effect_duration",
              "invalid_premium_banner_quantity",
              "invalid_affinity_base_points",
              "invalid_bag_grant",
              "gift_not_found",
              "target_not_found",
              "invalid_action",
            ].includes(code)
            ? 400
            : 500;

    return out(res, status, { ok: false, code });
  }
}
