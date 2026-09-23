import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const COINS_PER_DIAMOND = 10000;

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
    const sa = parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT);
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

function clean(value) {
  return String(value ?? "").trim();
}

function asInt(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : 0;
}

function validateOperationKey(value) {
  const key = clean(value);
  if (!/^[A-Za-z0-9_-]{12,160}$/.test(key)) throw Error("invalid_idempotency_key");
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
  return expectedBuffer.length === actual.length && timingSafeEqual(expectedBuffer, actual);
}

async function actor(req) {
  const authorization = clean(req.headers.authorization);
  if (!authorization.startsWith("Bearer ")) throw Error("unauthorized");
  const decoded = await getAuth().verifyIdToken(authorization.slice(7));
  if (decoded.firebase?.sign_in_provider === "anonymous") throw Error("account_required");
  return decoded;
}

async function walletState(db, uid) {
  const [userSnap, privateSnap] = await Promise.all([
    db.collection("users").doc(uid).get(),
    db.collection("wallet_private").doc(uid).get(),
  ]);
  if (!userSnap.exists) throw Error("user_not_found");
  const user = userSnap.data() || {};
  return {
    ok: true,
    coins: Math.max(0, asInt(user.coins ?? user.balance)),
    diamonds: Math.max(0, asInt(user.diamonds)),
    passwordSet: privateSnap.exists && Boolean(privateSnap.data()?.passwordHash),
    coinsPerDiamond: COINS_PER_DIAMOND,
  };
}

async function setWalletPassword(db, uid, body) {
  const password = String(body.password ?? "");
  if (password.length < 6 || password.length > 64) throw Error("invalid_password");
  const userRef = db.collection("users").doc(uid);
  const privateRef = db.collection("wallet_private").doc(uid);
  const secured = passwordRecord(password);

  return db.runTransaction(async (tx) => {
    const [userSnap, privateSnap] = await Promise.all([
      tx.get(userRef),
      tx.get(privateRef),
    ]);
    if (!userSnap.exists) throw Error("user_not_found");
    if (privateSnap.exists && clean(privateSnap.data()?.passwordHash)) {
      throw Error("password_already_set");
    }
    tx.set(privateRef, {
      uid,
      passwordSalt: secured.salt,
      passwordHash: secured.hash,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.set(userRef, {
      diamondPasswordSet: true,
      diamondPasswordUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { ok: true, passwordSet: true };
  });
}

async function requireWalletPassword(db, uid, password) {
  const privateSnap = await db.collection("wallet_private").doc(uid).get();
  if (!privateSnap.exists || !verifyPassword(String(password ?? ""), privateSnap.data() || {})) {
    throw Error("wallet_password_invalid");
  }
}

async function exchangeDiamonds(db, uid, body) {
  const diamonds = asInt(body.diamonds);
  if (diamonds < 1 || diamonds > 1000000) throw Error("invalid_amount");
  const key = validateOperationKey(body.idempotencyKey);
  await requireWalletPassword(db, uid, body.password);

  const userRef = db.collection("users").doc(uid);
  const operationRef = db.collection("wallet_operations").doc(uid + "__" + key);
  const ledgerDiamondRef = db.collection("financial_ledger").doc(uid + "__" + key + "__diamond");
  const ledgerCoinRef = db.collection("financial_ledger").doc(uid + "__" + key + "__coin");
  const coins = diamonds * COINS_PER_DIAMOND;

  return db.runTransaction(async (tx) => {
    const [userSnap, operationSnap, lockSnap] = await Promise.all([
      tx.get(userRef),
      tx.get(operationRef),
      tx.get(db.collection("system_config").doc("emergency_lock")),
    ]);
    if (!userSnap.exists) throw Error("user_not_found");
    if (operationSnap.exists) {
      return { ok: true, code: "duplicate", operationId: key, ...operationSnap.data()?.result };
    }
    const economyLock = lockSnap.exists ? (lockSnap.data() || {}) : {};
    if (
      economyLock.enabled === true ||
      economyLock.economyLocked === true ||
      economyLock.transfersLocked === true
    ) throw Error("emergency_locked");

    const user = userSnap.data() || {};
    const openingDiamonds = Math.max(0, asInt(user.diamonds));
    const openingCoins = Math.max(0, asInt(user.coins ?? user.balance));
    if (openingDiamonds < diamonds) throw Error("insufficient_diamonds");

    const closingDiamonds = openingDiamonds - diamonds;
    const closingCoins = openingCoins + coins;
    tx.update(userRef, {
      diamonds: closingDiamonds,
      coins: closingCoins,
      walletUpdatedAt: FieldValue.serverTimestamp(),
    });
    tx.create(ledgerDiamondRef, {
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
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.create(ledgerCoinRef, {
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
      createdAt: FieldValue.serverTimestamp(),
    });
    const result = {
      diamondsSpent: diamonds,
      coinsReceived: coins,
      diamonds: closingDiamonds,
      coins: closingCoins,
    };
    tx.create(operationRef, {
      uid,
      action: "exchangeDiamonds",
      status: "completed",
      result,
      createdAt: FieldValue.serverTimestamp(),
    });
    return { ok: true, code: "ok", operationId: key, ...result };
  });
}

async function giftDiamonds(db, uid, body) {
  const recipientUid = clean(body.recipientUid);
  const diamonds = asInt(body.diamonds);
  if (!recipientUid || recipientUid === uid) throw Error("invalid_recipient");
  if (diamonds < 1 || diamonds > 1000000) throw Error("invalid_amount");
  const key = validateOperationKey(body.idempotencyKey);
  await requireWalletPassword(db, uid, body.password);

  const senderRef = db.collection("users").doc(uid);
  const recipientRef = db.collection("users").doc(recipientUid);
  const operationRef = db.collection("wallet_operations").doc(uid + "__" + key);
  const transferRef = db.collection("wallet_transfers").doc(uid + "__" + key);
  const senderLedgerRef = db.collection("financial_ledger").doc(uid + "__" + key + "__sender");
  const receiverLedgerRef = db.collection("financial_ledger").doc(uid + "__" + key + "__receiver");
  const coins = diamonds * COINS_PER_DIAMOND;

  return db.runTransaction(async (tx) => {
    const [senderSnap, recipientSnap, operationSnap, lockSnap] = await Promise.all([
      tx.get(senderRef),
      tx.get(recipientRef),
      tx.get(operationRef),
      tx.get(db.collection("system_config").doc("emergency_lock")),
    ]);
    if (!senderSnap.exists || !recipientSnap.exists) throw Error("user_not_found");
    if (operationSnap.exists) {
      return { ok: true, code: "duplicate", operationId: key, ...operationSnap.data()?.result };
    }
    const economyLock = lockSnap.exists ? (lockSnap.data() || {}) : {};
    if (
      economyLock.enabled === true ||
      economyLock.economyLocked === true ||
      economyLock.transfersLocked === true
    ) throw Error("emergency_locked");

    const sender = senderSnap.data() || {};
    const recipient = recipientSnap.data() || {};
    const openingDiamonds = Math.max(0, asInt(sender.diamonds));
    const recipientOpeningCoins = Math.max(0, asInt(recipient.coins ?? recipient.balance));
    if (openingDiamonds < diamonds) throw Error("insufficient_diamonds");

    const senderClosingDiamonds = openingDiamonds - diamonds;
    const recipientClosingCoins = recipientOpeningCoins + coins;
    tx.update(senderRef, {
      diamonds: senderClosingDiamonds,
      walletUpdatedAt: FieldValue.serverTimestamp(),
    });
    tx.update(recipientRef, {
      coins: recipientClosingCoins,
      walletUpdatedAt: FieldValue.serverTimestamp(),
    });
    tx.create(senderLedgerRef, {
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
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.create(receiverLedgerRef, {
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
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.create(transferRef, {
      senderUid: uid,
      recipientUid,
      diamonds,
      coinsReceived: coins,
      exchangeRate: COINS_PER_DIAMOND,
      type: "diamond_gift_to_coins",
      status: "completed",
      createdAt: FieldValue.serverTimestamp(),
    });
    const result = {
      recipientUid,
      diamondsSent: diamonds,
      coinsReceived: coins,
      diamonds: senderClosingDiamonds,
    };
    tx.create(operationRef, {
      uid,
      action: "giftDiamonds",
      status: "completed",
      result,
      createdAt: FieldValue.serverTimestamp(),
    });
    return { ok: true, code: "ok", operationId: key, ...result };
  });
}

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== "POST") return out(res, 405, { ok: false, code: "method_not_allowed" });

  try {
    initFirebase();
    const decoded = await actor(req);
    const db = getFirestore();
    const action = clean(req.body?.action);

    if (action === "state") return out(res, 200, await walletState(db, decoded.uid));
    if (action === "setPassword") return out(res, 200, await setWalletPassword(db, decoded.uid, req.body || {}));
    if (action === "exchangeDiamonds") return out(res, 200, await exchangeDiamonds(db, decoded.uid, req.body || {}));
    if (action === "giftDiamonds") return out(res, 200, await giftDiamonds(db, decoded.uid, req.body || {}));

    return out(res, 400, { ok: false, code: "invalid_action" });
  } catch (error) {
    const code = clean(error?.message) || "server_error";
    const status =
      ["unauthorized"].includes(code) ? 401 :
      ["account_required", "wallet_password_invalid"].includes(code) ? 403 :
      ["user_not_found"].includes(code) ? 404 :
      ["password_already_set", "insufficient_diamonds", "emergency_locked"].includes(code) ? 409 :
      ["invalid_password", "invalid_amount", "invalid_recipient", "invalid_idempotency_key", "invalid_action"].includes(code) ? 400 :
      500;
    return out(res, status, { ok: false, code });
  }
}


export {
  walletState,
  setWalletPassword,
  exchangeDiamonds,
  giftDiamonds,
};
