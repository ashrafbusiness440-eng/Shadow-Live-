import {
  effectiveVipState,
  materializeVipState,
} from "./vip-state.js";
import {
  vipPublicProfilePatch,
  vipStateFromUser,
  vipUserPatch,
} from "./vip-runtime.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const TRIAL_LEVEL = 5;
const TRIAL_DAYS = 7;
const CARDS_PER_COMPLETED_VIP10_MAINTENANCE = 3;
const UID_PATTERN = /^[A-Za-z0-9_-]{1,180}$/;

const clean = (value) => String(value ?? "").trim();

class TrialCardError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function safePathPart(value) {
  return clean(value)
    .replace(/[^A-Za-z0-9_.-]/g, "_")
    .slice(0, 180);
}

function cardPath(ownerUid, cardId) {
  return `vip_trial_cards/${safePathPart(ownerUid)}/items/${safePathPart(cardId)}`;
}

function cycleKey(uid, earnedVipExpiresAtMs) {
  return `vip10_maintenance_${safePathPart(uid)}_${Math.max(
    0,
    Number(earnedVipExpiresAtMs || 0),
  )}`;
}

export function vip10MaintenanceTrialCardWrites(
  db,
  uid,
  beforeState,
  afterState,
  maintenanceRequired,
  nowMs = Date.now(),
) {
  const required = Math.max(0, Number(maintenanceRequired || 0));
  const beforeMaintenance = Math.max(
    0,
    Number(beforeState?.maintenancePoints || 0),
  );
  const afterMaintenance = Math.max(
    0,
    Number(afterState?.maintenancePoints || 0),
  );

  const qualifies =
    required > 0 &&
    Number(beforeState?.earnedVipLevel || 0) === 10 &&
    Number(afterState?.earnedVipLevel || 0) === 10 &&
    beforeMaintenance < required &&
    afterMaintenance >= required;

  if (!qualifies) {
    return { awarded: false, count: 0, cycleId: "", writes: [] };
  }

  const cycleId = cycleKey(uid, beforeState?.earnedVipExpiresAtMs);
  const now = new Date(nowMs);
  const writes = [];

  for (let index = 1; index <= CARDS_PER_COMPLETED_VIP10_MAINTENANCE; index++) {
    const cardId = `${cycleId}_card_${index}`;
    writes.push(
      db.writeCreate(cardPath(uid, cardId), {
        cardId,
        ownerUid: uid,
        source: "vip10_maintenance",
        sourceCycleId: cycleId,
        sourceVipLevel: 10,
        trialVipLevel: TRIAL_LEVEL,
        durationDays: TRIAL_DAYS,
        status: "available",
        issuedAt: now,
        consumedAt: null,
        recipientUid: null,
        recipientTrialExpiresAt: null,
      }),
    );
  }

  writes.push(
    db.writeCreate(`vip_trial_card_awards/${cycleId}`, {
      cycleId,
      uid,
      vipLevel: 10,
      maintenanceRequired: required,
      maintenancePointsBefore: beforeMaintenance,
      maintenancePointsAfter: afterMaintenance,
      cardCount: CARDS_PER_COMPLETED_VIP10_MAINTENANCE,
      issuedAt: now,
    }),
  );

  return {
    awarded: true,
    count: CARDS_PER_COMPLETED_VIP10_MAINTENANCE,
    cycleId,
    writes,
  };
}

export async function listVipTrialCards(db, uid, nowMs = Date.now()) {
  const rows = await db.runQuery(`vip_trial_cards/${uid}/items`, {
    orderBy: [{ field: "issuedAt", direction: "desc" }],
    limit: 50,
  });

  return {
    ok: true,
    items: rows.map((row) => {
      const data = row.data || {};
      return {
        cardId: clean(data.cardId || row.id),
        ownerUid: clean(data.ownerUid),
        source: clean(data.source),
        sourceCycleId: clean(data.sourceCycleId),
        trialVipLevel: Number(data.trialVipLevel || 0),
        durationDays: Number(data.durationDays || 0),
        status: clean(data.status),
        issuedAt: data.issuedAt || null,
        consumedAt: data.consumedAt || null,
        recipientUid: clean(data.recipientUid) || null,
        recipientTrialExpiresAt: data.recipientTrialExpiresAt || null,
        available: clean(data.status) === "available",
        serverNowMs: nowMs,
      };
    }),
  };
}

export async function giftVipTrialCard(
  db,
  senderUid,
  body,
  nowMs = Date.now(),
) {
  const cardId = clean(body?.cardId);
  const recipientUid = clean(body?.recipientUid);
  if (!cardId || cardId.length > 220) {
    throw new TrialCardError("invalid_trial_card", 400);
  }
  if (!UID_PATTERN.test(recipientUid) || recipientUid === senderUid) {
    throw new TrialCardError("invalid_trial_recipient", 400);
  }

  const transaction = await db.beginTransaction();
  try {
    const path = cardPath(senderUid, cardId);
    const [
      cardSnap,
      senderUserSnap,
      recipientUserSnap,
      recipientProfileSnap,
      forwardFollow,
      reverseFollow,
    ] = await Promise.all([
      db.get(path, transaction),
      db.get(`users/${senderUid}`, transaction),
      db.get(`users/${recipientUid}`, transaction),
      db.get(`public_profiles/${recipientUid}`, transaction),
      db.get(`follows/${senderUid}__${recipientUid}`, transaction),
      db.get(`follows/${recipientUid}__${senderUid}`, transaction),
    ]);

    if (!cardSnap.exists) {
      throw new TrialCardError("trial_card_not_found", 404);
    }
    const card = cardSnap.data || {};
    if (
      clean(card.ownerUid) !== senderUid ||
      clean(card.status) !== "available"
    ) {
      throw new TrialCardError("trial_card_unavailable", 409);
    }
    if (!senderUserSnap.exists || !recipientUserSnap.exists) {
      throw new TrialCardError("user_not_found", 404);
    }
    if (!forwardFollow.exists || !reverseFollow.exists) {
      throw new TrialCardError("friend_required", 403);
    }

    const recipientUser = recipientUserSnap.data || {};
    if (clean(recipientUser.accountStatus || "active") !== "active") {
      throw new TrialCardError("recipient_unavailable", 409);
    }

    const current = materializeVipState(
      null,
      vipStateFromUser(recipientUser),
      nowMs,
    );
    const existingTrialExpiry = Math.max(
      0,
      Number(current.trialVipExpiresAtMs || 0),
    );
    const trialBaseMs = existingTrialExpiry > nowMs
      ? existingTrialExpiry
      : nowMs;
    const trialVipExpiresAtMs = trialBaseMs + TRIAL_DAYS * DAY_MS;
    const trialBase = {
      ...current,
      trialVipLevel: Math.max(
        Number(current.trialVipLevel || 0),
        TRIAL_LEVEL,
      ),
      trialVipExpiresAtMs,
    };
    const nextState = {
      ...trialBase,
      ...effectiveVipState(trialBase, nowMs),
    };
    const now = new Date(nowMs);
    const trialExpiry = new Date(trialVipExpiresAtMs);
    const giftId = `trial_gift_${safePathPart(cardId)}_${safePathPart(recipientUid)}`;

    const writes = [
      db.writeUpdate(
        path,
        {
          status: "consumed",
          consumedAt: now,
          recipientUid,
          recipientTrialExpiresAt: trialExpiry,
        },
        [
          "status",
          "consumedAt",
          "recipientUid",
          "recipientTrialExpiresAt",
        ],
      ),
      db.writeUpdate(
        `users/${recipientUid}`,
        vipUserPatch(nextState, now),
        [
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
      db.writeCreate(`vip_trial_card_gifts/${giftId}`, {
        giftId,
        cardId,
        senderUid,
        recipientUid,
        sourceCycleId: clean(card.sourceCycleId),
        trialVipLevel: TRIAL_LEVEL,
        durationDays: TRIAL_DAYS,
        recipientTrialExpiresAt: trialExpiry,
        giftedAt: now,
      }),
      db.writeCreate(`vip_audit_logs/${giftId}`, {
        actorUid: senderUid,
        targetUserId: recipientUid,
        action: "giftVipTrialCard",
        cardId,
        trialVipLevel: TRIAL_LEVEL,
        durationDays: TRIAL_DAYS,
        recipientTrialExpiresAt: trialExpiry,
        createdAt: now,
      }),
    ];

    if (recipientProfileSnap.exists) {
      writes.push(
        db.writeUpdate(
          `public_profiles/${recipientUid}`,
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
      cardId,
      recipientUid,
      trialVipLevel: TRIAL_LEVEL,
      durationDays: TRIAL_DAYS,
      trialVipExpiresAtMs,
      effectiveVipLevel: nextState.effectiveVipLevel,
      effectiveVipSource: nextState.effectiveVipSource,
    };
  } catch (error) {
    await db.rollback(transaction);
    throw error;
  }
}

export { TrialCardError };
