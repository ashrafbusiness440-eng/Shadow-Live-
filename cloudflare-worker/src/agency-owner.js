import { json, readJson, firestoreQuotaResponse } from "./http.js";
import { verifyFirebaseIdToken } from "./firebase-auth.js";
import { firestoreClient } from "./firestore.js";
import { currentAgencyMonthKey } from "./agency-policy.js";
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
  return /^\d{6}$/.test(clean(value));
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
  return {
    ...economy,
    agencyPerformanceBonusBps:
      override.agencyPerformanceBonusBps ??
      economy.agencyPerformanceBonusBps,
    agencyBonusActiveHosts:
      override.agencyBonusActiveHosts ??
      economy.agencyBonusActiveHosts,
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
      eligible: bonus.eligible === true,
      requiredActiveHosts: nonNegativeInteger(
        bonus.requiredActiveHosts,
        "agency_bonus_state_corrupt",
      ),
      bps: nonNegativeInteger(
        bonus.agencyBonusBps,
        "agency_bonus_state_corrupt",
      ),
      estimatedCoins: nonNegativeInteger(
        bonus.agencyBonusCoins,
        "agency_bonus_state_corrupt",
      ),
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
        Object.prototype.hasOwnProperty.call(
          override,
          "agencyPerformanceBonusBps",
        ) ||
        Object.prototype.hasOwnProperty.call(
          override,
          "agencyBonusActiveHosts",
        )
          ? "agency_override"
          : "global",
    },
  };
}

function statementSummary(agencyId, month, snap) {
  if (!snap.exists) {
    return {
      agencyId,
      month,
      settled: false,
      statement: null,
    };
  }
  const data = snap.data || {};
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
      agencyBonusCoins: nonNegativeInteger(
        data.agencyBonusCoins,
        "agency_statement_state_corrupt",
      ),
      agencyPayableCoins: nonNegativeInteger(
        data.agencyPayableCoins,
        "agency_statement_state_corrupt",
      ),
      agencyDiamonds: nonNegativeInteger(
        data.agencyDiamonds,
        "agency_statement_state_corrupt",
      ),
      agencyRemainderCoins: nonNegativeInteger(
        data.agencyRemainderCoins,
        "agency_statement_state_corrupt",
      ),
      activeHostCount: nonNegativeInteger(
        data.agencyActiveHostCount,
        "agency_statement_state_corrupt",
      ),
      requiredActiveHosts: nonNegativeInteger(
        data.agencyRequiredActiveHosts,
        "agency_statement_state_corrupt",
      ),
      bonusEligible: data.agencyBonusEligible === true,
      bonusBps: nonNegativeInteger(
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
  const statementSnap = await db.get(
    `agency_monthly_statements/${owner.agencyId}__${month}`,
  );
  return {
    ok: true,
    ...statementSummary(owner.agencyId, month, statementSnap),
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
