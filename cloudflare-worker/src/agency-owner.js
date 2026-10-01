import { json, readJson, firestoreQuotaResponse } from "./http.js";
import { verifyFirebaseIdToken } from "./firebase-auth.js";
import { firestoreClient } from "./firestore.js";
import {
  calculateAgencyTargetProgress,
  currentAgencyMonthKey,
  DEFAULT_AGENCY_TARGETS,
} from "./agency-policy.js";
import { calculateAgencyMonthlyBonus } from "./economy-policy.js";
import { annotatePressureRequest } from "./pressure-telemetry.js";

const clean = (value) => String(value ?? "").trim();

class ApiError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function validAgencyId(value) {
  return /^\d{3,8}$/.test(clean(value));
}

function validMonth(value) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(clean(value));
}

function nonNegativeInteger(value, code) {
  const parsed = Number(value ?? 0);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new ApiError(code, 409);
  }
  return parsed;
}

function boundedInteger(value, fallback, min, max, code) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    if (value == null || value === "") return fallback;
    throw new ApiError(code, 409);
  }
  return parsed;
}

async function assertAgencyOwner(db, uidInput) {
  const uid = clean(uidInput);
  if (!uid) throw new ApiError("unauthorized", 401);

  const membershipSnap = await db.get("agency_user_memberships/" + uid);
  if (!membershipSnap.exists) throw new ApiError("agency_owner_not_found", 404);

  const membership = membershipSnap.data || {};
  const agencyId = clean(membership.agencyId);
  if (
    !validAgencyId(agencyId) ||
    clean(membership.role) !== "owner" ||
    clean(membership.status) !== "active"
  ) {
    throw new ApiError("agency_owner_required", 403);
  }

  const agencySnap = await db.get("agencies/" + agencyId);
  if (!agencySnap.exists) throw new ApiError("agency_not_found", 404);
  const agency = agencySnap.data || {};
  if (
    clean(agency.ownerUid) !== uid ||
    clean(agency.agencyId || agencyId) !== agencyId
  ) {
    throw new ApiError("agency_owner_state_corrupt", 409);
  }

  return { uid, agencyId, agency };
}

function effectiveBonusPolicy(economy = {}, override = {}) {
  const overrideIsNew =
    clean(override.agencyPerformanceBonusMode) ===
    "per_host_target_month_end";
  const globalIsNew =
    clean(economy.agencyPerformanceBonusMode) ===
    "per_host_target_month_end";
  return {
    ...economy,
    agencyPerformanceBonusMode:"per_host_target_month_end",
    agencyPerformanceBonusBps:overrideIsNew
      ?Math.max(0,Math.min(3000,Number(override.agencyPerformanceBonusBps??100)))
      :globalIsNew
        ?Math.max(0,Math.min(3000,Number(economy.agencyPerformanceBonusBps??100)))
        :100,
  };
}

function currentMonthSummary(month, stats = {}, wallet = {}, bonus = {}) {
  const supportCoins = nonNegativeInteger(
    stats.supportCoins,
    "agency_performance_state_corrupt",
  );
  const hostShareCoins = nonNegativeInteger(
    stats.hostEarningCoins,
    "agency_performance_state_corrupt",
  );
  const agencyBaseShareCoins = nonNegativeInteger(
    stats.agencyEarningCoins,
    "agency_performance_state_corrupt",
  );
  const platformShareCoins = nonNegativeInteger(
    stats.platformShareCoins,
    "agency_performance_state_corrupt",
  );
  const giftCount = nonNegativeInteger(
    stats.giftCount,
    "agency_performance_state_corrupt",
  );
  const activeHostFallback = Array.isArray(stats.activeHostIds)
    ? stats.activeHostIds.length
    : 0;
  const activeHostCount = nonNegativeInteger(
    stats.activeHostCount ?? activeHostFallback,
    "agency_performance_state_corrupt",
  );

  const diamonds = nonNegativeInteger(
    wallet.diamonds,
    "agency_wallet_state_corrupt",
  );
  const remainderCoins = nonNegativeInteger(
    wallet.remainderCoins,
    "agency_wallet_state_corrupt",
  );
  const lifetimeDiamonds = nonNegativeInteger(
    wallet.lifetimeDiamonds ?? diamonds,
    "agency_wallet_state_corrupt",
  );
  if (lifetimeDiamonds < diamonds) {
    throw new ApiError("agency_wallet_state_corrupt", 409);
  }

  return {
    month,
    supportCoins,
    hostShareCoins,
    agencyBaseShareCoins,
    platformShareCoins,
    giftCount,
    activeHostCount,
    bonus: {
      eligible: false,
      requiredActiveHosts: 0,
      bps: nonNegativeInteger(
        bonus.configuredBonusBps ?? bonus.agencyBonusBps ?? 100,
        "agency_bonus_state_corrupt",
      ),
      estimatedCoins: 0,
      mode:"per_host_target_month_end",
      deferredToMonthEnd: true,
    },
    wallet: {
      diamonds,
      remainderCoins,
      lifetimeDiamonds,
    },
  };
}

export async function loadAgencyOwnerPerformance(
  db,
  uidInput,
  now = new Date(),
) {
  const owner = await assertAgencyOwner(db, uidInput);
  const month = currentAgencyMonthKey(now);

  const [statsSnap, walletSnap, economySnap, overrideSnap] = await Promise.all([
    db.get(`agency_support_stats/${owner.agencyId}/monthly/${month}`),
    db.get("agency_wallets/" + owner.agencyId),
    db.get("system_config/gift_economy"),
    db.get("agency_policy_overrides/" + owner.agencyId),
  ]);

  const stats = statsSnap.exists ? statsSnap.data || {} : {};
  const wallet = walletSnap.exists ? walletSnap.data || {} : {};
  const economy = economySnap.exists ? economySnap.data || {} : {};
  const override = overrideSnap.exists ? overrideSnap.data || {} : {};
  const policy = effectiveBonusPolicy(economy, override);

  let bonus;
  try {
    const activeHostCount = nonNegativeInteger(
      stats.activeHostCount ??
        (Array.isArray(stats.activeHostIds) ? stats.activeHostIds.length : 0),
      "agency_performance_state_corrupt",
    );
    bonus = calculateAgencyMonthlyBonus(policy, {
      supportCoins: nonNegativeInteger(
        stats.supportCoins,
        "agency_performance_state_corrupt",
      ),
      activeHostCount,
      hasAgency: true,
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("agency_bonus_state_corrupt", 409);
  }

  const coinsPerDiamond = boundedInteger(
    economy.coinsPerDiamond,
    10000,
    1,
    Number.MAX_SAFE_INTEGER,
    "agency_economy_state_corrupt",
  );

  return {
    ok: true,
    agencyId: owner.agencyId,
    current: currentMonthSummary(month, stats, wallet, bonus),
    policy: {
      coinsPerDiamond,
      source:
        clean(override.agencyPerformanceBonusMode) ===
          "per_host_target_month_end"
          ? "agency_override"
          : "global",
    },
  };
}

function hostTargetLevelSummary(target) {
  if (!target) return null;
  return {
    id: clean(target.id),
    tierId: clean(target.tierId),
    rank: clean(target.rank),
    thresholdCoins: nonNegativeInteger(
      target.thresholdCoins,
      "agency_target_state_corrupt",
    ),
    salaryDiamonds: nonNegativeInteger(
      target.salaryDiamonds,
      "agency_target_state_corrupt",
    ),
    openEnded: target.openEnded === true,
  };
}

function achievementTimestampMs(value) {
  if (value instanceof Date) return value.getTime();
  const ms = Date.parse(clean(value));
  return Number.isFinite(ms) ? ms : 0;
}

function hostPerformanceAchievements(levels, rows) {
  const sortedRows = rows.slice().sort(
    (a, b) =>
      achievementTimestampMs(a?.data?.createdAt) -
      achievementTimestampMs(b?.data?.createdAt),
  );
  const achieved = new Map();
  for (const row of sortedRows) {
    const data = row?.data || {};
    const progress = nonNegativeInteger(
      data.agencyTargetProgressCoins,
      "agency_target_history_corrupt",
    );
    for (const level of levels) {
      if (
        !achieved.has(level.id) &&
        progress >= level.thresholdCoins
      ) {
        achieved.set(level.id, {
          targetId: level.id,
          tierId: level.tierId,
          rank: level.rank,
          thresholdCoins: level.thresholdCoins,
          achievedAt: data.createdAt || null,
        });
      }
    }
  }
  return [...achieved.values()].slice(-12);
}

export async function loadAgencyOwnerHostPerformance(
  db,
  uidInput,
  targetUidInput,
  now = new Date(),
) {
  const owner = await assertAgencyOwner(db, uidInput);
  const targetUid = clean(targetUidInput);
  if (!targetUid) throw new ApiError("invalid_target_uid", 400);

  const [userSnap, membershipSnap, economySnap] = await Promise.all([
    db.get(`users/${targetUid}`),
    db.get(`agency_user_memberships/${targetUid}`),
    db.get("system_config/gift_economy"),
  ]);
  if (!userSnap.exists || !membershipSnap.exists) {
    throw new ApiError("agency_host_not_found", 404);
  }

  const user = userSnap.data || {};
  const membership = membershipSnap.data || {};
  if (
    clean(membership.agencyId) !== owner.agencyId ||
    clean(membership.status) !== "active" ||
    clean(user.agencyId) !== owner.agencyId
  ) {
    throw new ApiError("agency_host_not_active", 409);
  }

  const month = currentAgencyMonthKey(now);
  const targetPolicy =
    user.agencyPolicySnapshot?.targets ||
    DEFAULT_AGENCY_TARGETS;
  let targetProgress;
  try {
    targetProgress = calculateAgencyTargetProgress({
      monthKey: month,
      storedMonth: user.agencyTargetMonth,
      storedProgressCoins: user.agencyTargetProgressCoins,
      addedHostShareCoins: 0,
      storedPaidDiamonds: user.agencySalaryPaidDiamonds,
      targets: targetPolicy,
    });
  } catch (_) {
    throw new ApiError("agency_target_state_corrupt", 409);
  }

  const levels = Array.isArray(targetPolicy)
    ? targetPolicy.map(hostTargetLevelSummary).filter(Boolean)
    : [];
  const activitySameMonth = clean(user.giftHostActivityMonth) === month;
  const qualifiedDays = activitySameMonth
    ? nonNegativeInteger(
        user.giftHostQualifiedDays,
        "agency_activity_state_corrupt",
      )
    : 0;
  const micSecondsMonth = activitySameMonth
    ? nonNegativeInteger(
        user.giftHostMicSecondsMonth,
        "agency_activity_state_corrupt",
      )
    : 0;
  const economy = economySnap.exists ? economySnap.data || {} : {};
  const requiredQualifiedDays = 14;
  const requiredMinutesPerDay = 120;

  const historyRows = await db.runQuery("gift_transactions", {
    filters: [
      { field: "receiverId", op: "==", value: targetUid },
      { field: "agencyId", op: "==", value: owner.agencyId },
      { field: "agencyTargetMonth", op: "==", value: month },
      { field: "earningsStatus", op: "==", value: "target_paid" },
    ],
    limit: 20,
  });

  const currentLevel = hostTargetLevelSummary(targetProgress.reachedTarget);
  const nextLevel = hostTargetLevelSummary(targetProgress.nextTarget);
  return {
    ok: true,
    agencyId: owner.agencyId,
    host: {
      uid: targetUid,
      publicId: clean(user.publicId) || null,
      displayName:
        clean(user.displayName || user.name || user.username) ||
        "Shadow Live",
      profileImageUrl:
        clean(user.profileImageUrl || user.photoUrl || user.avatarUrl) ||
        null,
      role: clean(membership.role),
      status: clean(membership.status),
      accountStatus: clean(user.accountStatus || "active"),
    },
    target: {
      month,
      progressCoins: targetProgress.progressCoins,
      remainingCoins: targetProgress.remainingToNextTargetCoins,
      currentLevel,
      nextLevel,
      targetCoins:
        nextLevel?.thresholdCoins ||
        currentLevel?.thresholdCoins ||
        0,
      levels,
    },
    activity: {
      month,
      qualifiedDays,
      micSecondsMonth,
      requiredQualifiedDays,
      requiredMinutesPerDay,
      requiredMicSecondsMonth:
        requiredQualifiedDays * requiredMinutesPerDay * 60,
    },
    achievements: hostPerformanceAchievements(levels, historyRows),
  };
}

function statementSummary(agencyId, month, snap, bonusSnap) {
  if (!snap.exists) {
    return {
      agencyId,
      month,
      settled: false,
      statement: null,
    };
  }
  const data = snap.data || {};
  const bonusData = bonusSnap?.exists ? bonusSnap.data || {} : {};
  const perHostBonusCoins = nonNegativeInteger(
    bonusData.perHostBonusCoins,
    "agency_statement_bonus_state_corrupt",
  );
  const perHostBonusDiamonds = nonNegativeInteger(
    bonusData.perHostBonusDiamonds,
    "agency_statement_bonus_state_corrupt",
  );
  const eligibleHostCount = nonNegativeInteger(
    bonusData.perHostEligibleHostCount,
    "agency_statement_bonus_state_corrupt",
  );
  const configuredBonusBps = nonNegativeInteger(
    bonusData.configuredBonusBps,
    "agency_statement_bonus_state_corrupt",
  );
  if (
    clean(data.agencyId) !== agencyId ||
    clean(data.month) !== month ||
    clean(data.status) !== "settled"
  ) {
    throw new ApiError("agency_statement_state_corrupt", 409);
  }
  return {
    agencyId,
    month,
    settled: true,
    statement: {
      supportCoins: nonNegativeInteger(
        data.supportCoins,
        "agency_statement_state_corrupt",
      ),
      agencyBaseShareCoins: nonNegativeInteger(
        data.agencyBaseShareCoins ?? data.agencyShareCoins,
        "agency_statement_state_corrupt",
      ),
      agencyBonusCoins:
        nonNegativeInteger(
          data.agencyBonusCoins,
          "agency_statement_state_corrupt",
        ) + perHostBonusCoins,
      agencyPayableCoins:
        nonNegativeInteger(
          data.agencyBaseShareCoins ?? data.agencyShareCoins,
          "agency_statement_state_corrupt",
        ) +
        nonNegativeInteger(
          data.agencyBonusCoins,
          "agency_statement_state_corrupt",
        ) +
        perHostBonusCoins,
      agencyDiamonds:
        nonNegativeInteger(
          data.agencyDiamonds,
          "agency_statement_state_corrupt",
        ) + perHostBonusDiamonds,
      agencyRemainderCoins: nonNegativeInteger(
        data.agencyRemainderCoins,
        "agency_statement_state_corrupt",
      ),
      activeHostCount: eligibleHostCount,
      requiredActiveHosts: 0,
      bonusEligible: eligibleHostCount > 0,
      bonusBps:
        configuredBonusBps > 0
          ? configuredBonusBps
          : nonNegativeInteger(
              data.agencyBonusBps,
              "agency_statement_state_corrupt",
            ),
      giftCount: nonNegativeInteger(
        data.giftCount,
        "agency_statement_state_corrupt",
      ),
    },
  };
}

export async function loadAgencyOwnerStatement(
  db,
  uidInput,
  monthInput,
  now = new Date(),
) {
  const month = clean(monthInput);
  if (!validMonth(month)) throw new ApiError("invalid_agency_month", 400);
  const currentMonth = currentAgencyMonthKey(now);
  if (month >= currentMonth) {
    throw new ApiError("agency_month_not_closed", 409);
  }

  const owner = await assertAgencyOwner(db, uidInput);
  const [statementSnap, bonusSnap] = await Promise.all([
    db.get(`agency_monthly_statements/${owner.agencyId}__${month}`),
    db.get(`agency_bonus_accruals/${owner.agencyId}__${month}`),
  ]);
  return {
    ok: true,
    ...statementSummary(owner.agencyId, month, statementSnap, bonusSnap),
  };
}

export async function agencyOwner(request, env) {
  if (request.method !== "POST") {
    return json(request, env, { ok: false, code: "method_not_allowed" }, 405);
  }

  try {
    const token = await verifyFirebaseIdToken(request, env);
    const body = await readJson(request);
    const action = clean(body.action) || "performance";
    const db = firestoreClient(env);

    if (action === "performance") {
      annotatePressureRequest(request, { action: "agencyOwner:performance" });
      return json(
        request,
        env,
        await loadAgencyOwnerPerformance(db, token.sub),
      );
    }

    if (action === "statement") {
      annotatePressureRequest(request, { action: "agencyOwner:statement" });
      return json(
        request,
        env,
        await loadAgencyOwnerStatement(db, token.sub, body.month),
      );
    }

    if (action === "hostPerformance") {
      annotatePressureRequest(request, {
        action: "agencyOwner:hostPerformance",
      });
      return json(
        request,
        env,
        await loadAgencyOwnerHostPerformance(
          db,
          token.sub,
          body.targetUid,
        ),
      );
    }

    throw new ApiError("invalid_agency_owner_action", 400);
  } catch (error) {
    if (error instanceof ApiError) {
      return json(
        request,
        env,
        { ok: false, code: error.code },
        error.status,
      );
    }

    const quota = firestoreQuotaResponse(request, env, error);
    if (quota) return quota;

    const code = clean(error?.message);
    if (code === "unauthorized") {
      return json(request, env, { ok: false, code }, 401);
    }
    if (
      code === "server_not_configured" ||
      code === "invalid_service_account_json"
    ) {
      return json(request, env, { ok: false, code }, 503);
    }
    return json(
      request,
      env,
      { ok: false, code: "agency_owner_failed" },
      500,
    );
  }
}
