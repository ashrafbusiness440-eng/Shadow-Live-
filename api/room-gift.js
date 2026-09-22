import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

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
    const sa = parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT);
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

const fallbackGifts = [
  {id:"rose",nameAr:"وردة",priceCoins:100,enabled:true,assetKey:"gifts.placeholder.default"},
  {id:"coffee",nameAr:"قهوة",priceCoins:300,enabled:true,assetKey:"gifts.placeholder.default"},
  {id:"heart",nameAr:"قلب",priceCoins:500,enabled:true,assetKey:"gifts.placeholder.default"},
  {id:"chocolate",nameAr:"شوكولا",priceCoins:1000,enabled:true,assetKey:"gifts.placeholder.default"},
  {id:"crown",nameAr:"تاج",priceCoins:2500,enabled:true,assetKey:"gifts.placeholder.default"},
  {id:"ring",nameAr:"خاتم ألماس",priceCoins:5000,enabled:true,assetKey:"gifts.placeholder.default"},
  {id:"sports_car",nameAr:"سيارة رياضية",priceCoins:10000,enabled:true,assetKey:"gifts.placeholder.default"},
  {id:"yacht",nameAr:"يخت فاخر",priceCoins:25000,enabled:true,assetKey:"gifts.placeholder.default"},
  {id:"private_jet",nameAr:"طائرة خاصة",priceCoins:50000,enabled:true,assetKey:"gifts.placeholder.default"},
  {id:"castle",nameAr:"قصر ملكي",priceCoins:100000,enabled:true,assetKey:"gifts.placeholder.default"},
  {id:"golden_dragon",nameAr:"التنين الذهبي",priceCoins:250000,enabled:true,assetKey:"gifts.placeholder.default"},
  {id:"galaxy",nameAr:"مجرة شادو",priceCoins:500000,enabled:true,assetKey:"gifts.placeholder.default"},
];

async function actor(req) {
  const authorization = clean(req.headers.authorization);
  if (!authorization.startsWith("Bearer ")) throw Error("unauthorized");
  const decoded = await getAuth().verifyIdToken(authorization.slice(7));
  if (decoded.firebase?.sign_in_provider === "anonymous") {
    throw Error("account_required");
  }
  return decoded;
}

function validKey(value) {
  return /^[A-Za-z0-9_-]{12,220}$/.test(clean(value));
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
    const roomId = clean(body.roomId);
    const receiverId = clean(body.receiverId);
    const giftId = clean(body.giftId);
    const quantity = Number(body.quantity || 1);
    const key = clean(body.idempotencyKey);

    if (
      !/^[A-Za-z0-9_-]{1,180}$/.test(roomId) ||
      !receiverId ||
      receiverId === decoded.uid ||
      !giftId ||
      ![1, 7, 77, 777].includes(quantity) ||
      !validKey(key)
    ) {
      return out(res, 400, { ok: false, code: "invalid_request" });
    }

    const db = getFirestore();
    const roomRef = db.collection("rooms").doc(roomId);
    const senderRef = db.collection("users").doc(decoded.uid);
    const receiverRef = db.collection("users").doc(receiverId);
    const senderPresenceRef = db
      .collection("room_presence")
      .doc(roomId)
      .collection("users")
      .doc(decoded.uid);
    const receiverPresenceRef = db
      .collection("room_presence")
      .doc(roomId)
      .collection("users")
      .doc(receiverId);
    const senderBlockRef = db
      .collection("user_blocks")
      .doc(decoded.uid)
      .collection("items")
      .doc(receiverId);
    const receiverBlockRef = db
      .collection("user_blocks")
      .doc(receiverId)
      .collection("items")
      .doc(decoded.uid);
    const catalogRef = db.collection("system_config").doc("gift_catalog");
    const opRef = db.collection("gift_operations").doc(key);
    const lockRef = db.collection("system_config").doc("emergency_lock");

    const result = await db.runTransaction(async (tx) => {
      const [
        roomSnap,
        senderSnap,
        receiverSnap,
        senderPresence,
        receiverPresence,
        senderBlock,
        receiverBlock,
        catalogSnap,
        opSnap,
        lockSnap,
      ] = await Promise.all([
        tx.get(roomRef),
        tx.get(senderRef),
        tx.get(receiverRef),
        tx.get(senderPresenceRef),
        tx.get(receiverPresenceRef),
        tx.get(senderBlockRef),
        tx.get(receiverBlockRef),
        tx.get(catalogRef),
        tx.get(opRef),
        tx.get(lockRef),
      ]);

      if (opSnap.exists) {
        return {
          ok: true,
          code: "duplicate",
          ...(opSnap.data()?.result || {}),
        };
      }
      if (!roomSnap.exists || roomSnap.data()?.isActive === false) {
        throw Error("room_unavailable");
      }
      if (!senderSnap.exists || !receiverSnap.exists) {
        throw Error("user_not_found");
      }
      if (senderBlock.exists || receiverBlock.exists) {
        throw Error("blocked");
      }
      if (lockSnap.exists && lockSnap.data()?.enabled === true) {
        throw Error("emergency_locked");
      }

      const nowMs = Date.now();
      const senderLastSeen = Number(senderPresence.data()?.lastSeenAtMs || 0);
      const receiverLastSeen = Number(receiverPresence.data()?.lastSeenAtMs || 0);
      if (!senderPresence.exists || nowMs - senderLastSeen > 90000) {
        throw Error("sender_not_in_room");
      }
      if (!receiverPresence.exists || nowMs - receiverLastSeen > 90000) {
        throw Error("receiver_not_in_room");
      }

      const rawCatalog =
        catalogSnap.exists && Array.isArray(catalogSnap.data()?.gifts)
          ? catalogSnap.data().gifts
          : fallbackGifts;
      const gift = rawCatalog.find(
        (item) => clean(item?.id) === giftId,
      );
      if (!gift) throw Error("gift_not_found");
      if (gift.enabled === false) throw Error("gift_inactive");

      const unitCoins = Number(gift.priceCoins || 0);
      if (!Number.isSafeInteger(unitCoins) || unitCoins <= 0) {
        throw Error("invalid_gift_price");
      }
      const totalCost = unitCoins * quantity;
      if (!Number.isSafeInteger(totalCost) || totalCost <= 0) {
        throw Error("invalid_gift_price");
      }

      const sender = senderSnap.data() || {};
      const receiver = receiverSnap.data() || {};
      const before = Number(sender.coins ?? sender.balance ?? 0);
      if (!Number.isFinite(before) || before < 0) {
        throw Error("invalid_wallet_state");
      }
      if (before < totalCost) throw Error("insufficient_balance");
      const after = before - totalCost;

      const senderPresenceData = senderPresence.data() || {};
      const receiverPresenceData = receiverPresence.data() || {};
      const senderName = clean(
        senderPresenceData.displayName ||
        sender.displayName ||
        sender.username ||
        "مستخدم Shadow Live",
      );
      const receiverName = clean(
        receiverPresenceData.displayName ||
        receiver.displayName ||
        receiver.username ||
        "مستخدم Shadow Live",
      );
      const senderPhoto = clean(
        senderPresenceData.profileImageUrl || sender.profileImageUrl,
      );
      const giftName = clean(gift.nameAr || "هدية");
      const assetKey = clean(gift.assetKey || "gifts.placeholder.default");
      const imageUrl = clean(gift.imageUrl);
      const now = FieldValue.serverTimestamp();

      const messageRef = roomRef.collection("messages").doc();
      const transactionRef = db.collection("gift_transactions").doc(key);
      const ledgerRef = db.collection("financial_ledger").doc("gift_" + key);
      const showcaseRef = db
        .collection("public_gift_showcases")
        .doc(receiverId)
        .collection("items")
        .doc(giftId);

      tx.update(senderRef, {
        coins: after,
        totalGiftsSent: FieldValue.increment(quantity),
        walletUpdatedAt: now,
      });
      tx.update(receiverRef, {
        totalGiftsReceived: FieldValue.increment(quantity),
        totalValueReceived: FieldValue.increment(totalCost),
      });

      tx.create(messageRef, {
        type: "gift",
        senderUid: decoded.uid,
        receiverUid: receiverId,
        displayName: senderName,
        profileImageUrl: senderPhoto,
        giftId,
        giftName,
        quantity,
        unitCoins,
        totalCost,
        assetKey,
        imageUrl,
        text:
          senderName +
          " أرسل " +
          giftName +
          " ×" +
          quantity +
          " إلى " +
          receiverName +
          " — " +
          totalCost +
          " كوينز",
        createdAt: now,
      });

      tx.create(transactionRef, {
        senderId: decoded.uid,
        receiverId,
        contextType: "room",
        roomId,
        giftId,
        giftName,
        quantity,
        unitCoins,
        totalCost,
        assetKey,
        earningsStatus: "pending_policy",
        createdAt: now,
      });

      tx.create(ledgerRef, {
        userId: decoded.uid,
        asset: "coins",
        delta: -totalCost,
        openingBalance: before,
        closingBalance: after,
        reason: "room_gift_send",
        sourceType: "gift",
        sourceId: key,
        actorUid: decoded.uid,
        counterpartyUid: receiverId,
        roomId,
        idempotencyKey: key,
        createdAt: now,
      });

      tx.set(
        showcaseRef,
        {
          giftId,
          name: giftName,
          imageUrl,
          assetKey,
          count: FieldValue.increment(quantity),
          updatedAt: now,
        },
        { merge: true },
      );

      const resultData = {
        giftId,
        giftName,
        receiverId,
        receiverName,
        quantity,
        totalCost,
        balance: after,
        messageId: messageRef.id,
      };

      tx.create(opRef, {
        senderId: decoded.uid,
        receiverId,
        roomId,
        action: "sendRoomGift",
        status: "completed",
        result: resultData,
        createdAt: now,
      });

      return { ok: true, code: "ok", ...resultData };
    });

    return out(res, 200, result);
  } catch (error) {
    const code = clean(error?.message) || "server_error";
    const status =
      code === "unauthorized"
        ? 401
        : code === "account_required"
          ? 403
          : code === "user_not_found" || code === "gift_not_found"
            ? 404
            : [
                "room_unavailable",
                "sender_not_in_room",
                "receiver_not_in_room",
                "gift_inactive",
                "insufficient_balance",
                "blocked",
                "emergency_locked",
              ].includes(code)
              ? 409
              : [
                  "invalid_gift_price",
                  "invalid_wallet_state",
                ].includes(code)
                ? 400
                : 500;

    return out(res, status, {
      ok: false,
      code: status === 500 ? "room_gift_failed" : code,
    });
  }
}
