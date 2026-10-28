// Offline-only store transaction primitive: intentionally NOT imported by
// any public Worker handler. /api/store-purchase remains hard-disabled.
// Never wire this without explicit Owner launch approval and integration tests.
import {
  prepareStorePurchase, validateStorePurchaseOperationId,
} from "./store-purchase-policy.js";
import {
  isTransientFirestoreError, firestoreErrorRetryDelayMs,
} from "./firestore.js";
import {assertUserDocumentSessionState} from "./firebase-auth.js";

const clean = value => String(value ?? "").trim();
const MAX_ATTEMPTS = 3;

export class StoreTransactionError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function safeBalance(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

// This function takes only an already verified Firebase token and resolved
// server-side level values; no client-supplied balance, price, or level is used.
// Receipt, debit, ownership and immutable ledger are one Firestore commit.
export async function commitStorePurchaseOffline(
  db, verifiedToken, body, serverLevels, nowMs = Date.now(),
) {
  const uid = clean(verifiedToken?.sub);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) {
    throw new StoreTransactionError("unauthorized");
  }
  const key = validateStorePurchaseOperationId(body?.operationId);
  const productId = clean(body?.productId);
  if (!/^[1-9][0-9]{5,8}$/.test(productId)) {
    throw new StoreTransactionError("invalid_store_product_id");
  }
  const opPath = `store_purchase_operations/${uid}__${key}`;
  const walletPath = `users/${uid}`;
  const entitlementPath = `user_store_entitlements/${uid}/items/${productId}`;
  const ledgerPath = `financial_ledger/store_${uid}__${key}`;
  const receiptPath = `store_purchase_receipts/${uid}__${key}`;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    let tx = null;
    try {
      tx = await db.beginTransaction();
      const [user, catalog, op] = await Promise.all([
        db.get(walletPath, tx),
        db.get("system_config/store_catalog", tx),
        db.get(opPath, tx),
      ]);
      if (!user.exists) throw new StoreTransactionError("unauthorized");
      assertUserDocumentSessionState(verifiedToken, user.data || {});
      if (op.exists) {
        if (op.data?.buyerUid !== uid || op.data?.productId !== productId) {
          throw new StoreTransactionError("store_operation_id_conflict");
        }
        const response = op.data?.result;
        if (!response || response.operationId !== key) {
          throw new StoreTransactionError("store_operation_record_invalid");
        }
        await db.rollback(tx);
        tx = null;
        return {ok:true,duplicate:true,...response};
      }
      // Existing Control writes always enforce false. This secondary guard
      // means even an internal accidental invocation cannot charge a user.
      if (catalog.data?.purchasingEnabled !== true) {
        throw new StoreTransactionError("purchasing_disabled");
      }
      const now = new Date(nowMs);
      const quote = prepareStorePurchase({
        catalog:catalog.data,productId,
        buyer:{uid,accountStatus:user.data?.accountStatus || "active"},
        vipLevel:serverLevels?.vipLevel,
        wealthLevel:serverLevels?.wealthLevel,
        nowMs,
      });
      const [asset, entitlement] = await Promise.all([
        db.get(`app_asset_registry/${quote.assetKey}`,tx),
        db.get(entitlementPath,tx),
      ]);
      if (!asset.exists || asset.data?.published !== true ||
          typeof asset.data?.rawUrl !== "string" ||
          !/^https:\/\//.test(asset.data.rawUrl.trim())) {
        throw new StoreTransactionError("store_asset_not_published");
      }
      // Renewals and stacking must have an explicit policy before activation.
      if (entitlement.exists) {
        throw new StoreTransactionError("store_item_already_owned");
      }
      const before = safeBalance(user.data?.coins ?? user.data?.balance);
      if (before === null) throw new StoreTransactionError("invalid_wallet_state");
      if (before < quote.priceCoins) {
        throw new StoreTransactionError("insufficient_balance");
      }
      const after = before - quote.priceCoins;
      const result = {
        operationId:key,productId:quote.productId,priceCoins:quote.priceCoins,
        durationDays:quote.durationDays,acquiredAtMs:nowMs,
        expiresAtMs:quote.expiresAtMs,deliveryStatus:"delivered",
      };
      await db.commit(tx,[
        db.writeUpdate(walletPath,
          {coins:after,walletUpdatedAt:now},["coins","walletUpdatedAt"]),
        db.writeCreate(entitlementPath,{
          ownerUid:uid,productId:quote.productId,nameAr:quote.nameAr,
          category:quote.category,assetKey:quote.assetKey,
          source:"purchase",status:"active",equipped:false,
          acquiredAtMs:nowMs,expiresAtMs:quote.expiresAtMs,
          purchaseOperationId:key,updatedAt:now,
        }),
        db.writeCreate(ledgerPath,{
          userId:uid,asset:"coins",delta:-quote.priceCoins,
          openingBalance:before,closingBalance:after,
          reason:"store_item_purchase",sourceType:"storePurchase",
          sourceId:key,idempotencyKey:key,createdAt:now,
        }),
        db.writeCreate(receiptPath,{
          buyerUid:uid,operationId:key,
          productId:quote.productId,nameAr:quote.nameAr,
          category:quote.category,assetKey:quote.assetKey,
          rarity:quote.rarity,priceCoins:quote.priceCoins,
          durationDays:quote.durationDays,
          acquiredAtMs:nowMs,expiresAtMs:quote.expiresAtMs,
          deliveryStatus:"delivered",refundStatus:"none",createdAt:now,
        }),
        db.writeCreate(opPath,{
          buyerUid:uid,productId:quote.productId,status:"completed",
          result,createdAt:now,
        }),
      ]);
      tx = null;
      return {ok:true,...result};
    } catch (error) {
      if (tx) await db.rollback(tx).catch(() => {});
      if (error instanceof StoreTransactionError) throw error;
      if (attempt < MAX_ATTEMPTS-1 && isTransientFirestoreError(error)) {
        await new Promise(resolve =>
          setTimeout(resolve,firestoreErrorRetryDelayMs(attempt)));
        continue;
      }
      throw error;
    }
  }
  throw new StoreTransactionError("store_transaction_failed");
}
