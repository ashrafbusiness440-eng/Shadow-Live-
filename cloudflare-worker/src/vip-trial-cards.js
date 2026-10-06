import { loadVipPolicy, vipMaintenanceThreshold } from "./vip-policy.js";
import { materializeVipState } from "./vip-state.js";
import {
  vipPublicProfilePatch,
  vipStateFromUser,
  vipUserPatch,
} from "./vip-runtime.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const TRIAL_LEVEL = 5;
const TRIAL_DAYS = 7;
const CARDS_PER_CYCLE = 3;
const MAX_HELD_CARD_IDS = 120;

const clean = (value) => String(value ?? "").trim();

function safeIds(raw) {
  const values = Array.isArray(raw) ? raw : [];
  return values
    .map(clean)
    .filter((value) => /^[A-Za-z0-9_.:-]{8,220}$/.test(value))
    .slice(0, MAX_HELD_CARD_IDS);
}

function cycleKeyFromState(uid, state) {
  const expiry = Number(state?.earnedVipExpiresAtMs || 0);
  return `${uid}:${expiry > 0 ? expiry : "no-expiry"}`;
}

function cardId(uid, cycleKey, index) {
  const safeUid = clean(uid).replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 80);
  const safeCycle = clean(cycleKey)
    .replace(/[^A-Za-z0-9_.-]/g, "_")
    .slice(-90);
  return `vip10trial_${safeUid}_${safeCycle}_${index}`;
}

export function vip10TrialCardGrantWrites(
  db,
  uid,
  user,
  policy,
  beforeState,
  afterState,
  nowMs = Date.now(),
) {
  const required = vipMaintenanceThreshold(policy, 10);
  const crossed =
    beforeState?.earnedVipLevel === 10 &&
    afterState?.earnedVipLevel === 10 &&
    Number.isSafeInteger(required) &&
    required > 0 &&
    Number(beforeState?.maintenancePoints || 0) < required &&
    Number(afterState?.maintenancePoints || 0) >= required;

  if (!crossed) return { writes: [], cardIds: [], granted: false };

  const cycleKey = cycleKeyFromState(uid, beforeState);
  if (clean(user?.vip10TrialCardsCycleKey) === cycleKey) {
    return { writes: [], cardIds: [], granted: false };
  }

  const existingIds = safeIds(user?.vipTrialCardIds);
  const ids = Array.from(
    { length: CARDS_PER_CYCLE },
    (_, index) => cardId(uid, cycleKey, index + 1),
  );
  const mergedIds = [...existingIds];
  for (const id of ids) {
    if (!mergedIds.includes(id)) mergedIds.push(id);
  }
  if (mergedIds.length > MAX_HELD_CARD_IDS) {
    throw new Error("vip_trial_inventory_limit");
  }

  const now = new Date(nowMs);
  const writes = ids.map((id, index) =>
    db.writeCreate(`vip_trial_cards/${id}`, {
      cardId: id,
      ownerUid: uid,
      originalOwnerUid: uid,
      sourceUid: uid,
      source: "vip10_maintenance",
      sourceCycleKey: cycleKey,
      sourceCycleExpiresAtMs: Number(beforeState?.earnedVipExpiresAtMs || 0),
      vipLevel: TRIAL_LEVEL,
      durationDays: TRIAL_DAYS,
      status: "available",
      recipientUid: uid,
      cardIndex: index + 1,
      createdAt: now,
      updatedAt: now,
      redeemedAt: null,
      redeemedByUid: null,
      giftedAt: null,
      giftedByUid: null,
    }),
  );

  writes.push(
    db.writeUpdate(
      `users/${uid}`,
      {
        vipTrialCardIds: mergedIds,
        vip10TrialCardsCycleKey: cycleKey,
        vip10TrialCardsGrantedAt: now,
      },
      [
        "vipTrialCardIds",
        "vip10TrialCardsCycleKey",
        "vip10TrialCardsGrantedAt",
      ],
    ),
    db.writeCreate(`vip_audit_logs/${ids[0]}__grant`, {
      actorUid: uid,
      targetUserId: uid,
      action: "grantVip10TrialCards",
      sourceCycleKey: cycleKey,
      cardIds: ids,
      vipLevel: TRIAL_LEVEL,
      durationDays: TRIAL_DAYS,
      quantity: CARDS_PER_CYCLE,
      createdAt: now,
    }),
  );

  return { writes, cardIds: ids, granted: true };
}

export async function listVipTrialCards(db, uid) {
  const userSnap = await db.get(`users/${uid}`);
  if (!userSnap.exists) throw new Error("user_not_found");
  const ids = safeIds(userSnap.data?.vipTrialCardIds);
  if (!ids.length) return { ok: true, cards: [] };

  const snaps = await Promise.all(
    ids.map((id) => db.get(`vip_trial_cards/${id}`)),
  );
  const cards = snaps
    .filter((snap) => snap.exists)
    .map((snap) => snap.data || {})
    .filter(
      (card) =>
        clean(card.ownerUid) === uid &&
        clean(card.status) === "available",
    )
    .slice(0, MAX_HELD_CARD_IDS);

  return { ok: true, cards };
}

export async function giftVipTrialCard(
  db,
  uid,
  body,
  nowMs = Date.now(),
) {
  const id = clean(body?.cardId);
  const recipientUid = clean(body?.recipientUid);
  if (!id || !recipientUid || recipientUid === uid) {
    throw new Error("invalid_trial_card_gift");
  }

  const transaction = await db.beginTransaction();
  try {
    const [senderSnap, recipientSnap, cardSnap, forwardFollow, reverseFollow] =
      await Promise.all([
        db.get(`users/${uid}`, transaction),
        db.get(`users/${recipientUid}`, transaction),
        db.get(`vip_trial_cards/${id}`, transaction),
        db.get(`follows/${uid}__${recipientUid}`, transaction),
        db.get(`follows/${recipientUid}__${uid}`, transaction),
      ]);

    if (!senderSnap.exists || !recipientSnap.exists || !cardSnap.exists) {
      throw new Error("not_found");
    }
    if (!forwardFollow.exists || !reverseFollow.exists) {
      throw new Error("mutual_follow_required");
    }

    const card = cardSnap.data || {};
    if (
      clean(card.ownerUid) !== uid ||
      clean(card.status) !== "available"
    ) {
      throw new Error("trial_card_unavailable");
    }

    const senderIds = safeIds(senderSnap.data?.vipTrialCardIds);
    const recipientIds = safeIds(recipientSnap.data?.vipTrialCardIds);
    if (!senderIds.includes(id)) throw new Error("trial_card_unavailable");
    if (!recipientIds.includes(id)) recipientIds.push(id);
    if (recipientIds.length > MAX_HELD_CARD_IDS) {
      throw new Error("vip_trial_inventory_limit");
    }

    const now = new Date(nowMs);
    await db.commit(transaction, [
      db.writeUpdate(
        `users/${uid}`,
        { vipTrialCardIds: senderIds.filter((value) => value !== id) },
        ["vipTrialCardIds"],
      ),
      db.writeUpdate(
        `users/${recipientUid}`,
        { vipTrialCardIds: recipientIds },
        ["vipTrialCardIds"],
      ),
      db.writeUpdate(
        `vip_trial_cards/${id}`,
        {
          ownerUid: recipientUid,
          recipientUid,
          giftedAt: now,
          giftedByUid: uid,
          updatedAt: now,
        },
        [
          "ownerUid",
          "recipientUid",
          "giftedAt",
          "giftedByUid",
          "updatedAt",
        ],
      ),
      db.writeCreate(`vip_audit_logs/${id}__gift__${nowMs}`, {
        actorUid: uid,
        targetUserId: recipientUid,
        action: "giftVipTrialCard",
        cardId: id,
        createdAt: now,
      }),
    ]);
    return { ok: true, cardId: id, recipientUid };
  } catch (error) {
    await db.rollback(transaction);
    throw error;
  }
}

export async function redeemVipTrialCard(
  db,
  uid,
  body,
  nowMs = Date.now(),
) {
  const id = clean(body?.cardId);
  if (!id) throw new Error("invalid_trial_card");

  const transaction = await db.beginTransaction();
  try {
    const [userSnap, profileSnap, cardSnap, policy] = await Promise.all([
      db.get(`users/${uid}`, transaction),
      db.get(`public_profiles/${uid}`, transaction),
      db.get(`vip_trial_cards/${id}`, transaction),
      loadVipPolicy(db, { transaction, useCache: false }),
    ]);

    if (!userSnap.exists || !cardSnap.exists) throw new Error("not_found");
    const card = cardSnap.data || {};
    if (
      clean(card.ownerUid) !== uid ||
      clean(card.status) !== "available" ||
      Number(card.vipLevel || 0) !== TRIAL_LEVEL ||
      Number(card.durationDays || 0) !== TRIAL_DAYS
    ) {
      throw new Error("trial_card_unavailable");
    }

    const user = userSnap.data || {};
    const current = materializeVipState(
      policy,
      vipStateFromUser(user),
      nowMs,
    );
    const baseExpiry = Math.max(
      nowMs,
      Number(current.trialVipExpiresAtMs || 0),
    );
    const nextState = materializeVipState(
      policy,
      {
        ...current,
        trialVipLevel: TRIAL_LEVEL,
        trialVipExpiresAtMs: baseExpiry + TRIAL_DAYS * DAY_MS,
      },
      nowMs,
    );
    const now = new Date(nowMs);
    const ids = safeIds(user.vipTrialCardIds).filter((value) => value !== id);

    const writes = [
      db.writeUpdate(
        `users/${uid}`,
        {
          vipTrialCardIds: ids,
          ...vipUserPatch(nextState, now),
        },
        [
          "vipTrialCardIds",
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
        ],
      ),
      db.writeUpdate(
        `vip_trial_cards/${id}`,
        {
          status: "redeemed",
          redeemedAt: now,
          redeemedByUid: uid,
          updatedAt: now,
          trialExpiresAt: new Date(nextState.trialVipExpiresAtMs),
        },
        [
          "status",
          "redeemedAt",
          "redeemedByUid",
          "updatedAt",
          "trialExpiresAt",
        ],
      ),
      db.writeCreate(`vip_audit_logs/${id}__redeem__${nowMs}`, {
        actorUid: uid,
        targetUserId: uid,
        action: "redeemVipTrialCard",
        cardId: id,
        vipLevel: TRIAL_LEVEL,
        durationDays: TRIAL_DAYS,
        trialExpiresAt: new Date(nextState.trialVipExpiresAtMs),
        createdAt: now,
      }),
    ];

    if (profileSnap.exists) {
      writes.push(
        db.writeUpdate(
          `public_profiles/${uid}`,
          vipPublicProfilePatch(nextState, now),
          [
            "vipLevel",
            "effectiveVipLevel",
            "vipExpiresAt",
            "updatedAt",
          ],
        ),
      );
    }

    await db.commit(transaction, writes);
    return {
      ok: true,
      cardId: id,
      trialVipLevel: TRIAL_LEVEL,
      trialVipExpiresAtMs: nextState.trialVipExpiresAtMs,
      effectiveVipLevel: nextState.effectiveVipLevel,
      effectiveVipSource: nextState.effectiveVipSource,
    };
  } catch (error) {
    await db.rollback(transaction);
    throw error;
  }
}
