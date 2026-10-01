const clean = (value) => String(value ?? "").trim();

export function normalizeAgencySearchText(value) {
  return clean(value)
    .normalize("NFKD")
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "")
    .replace(/ـ/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function agencyNameSearchTokens(value) {
  const normalized = normalizeAgencySearchText(value);
  if (normalized.length < 2) return [];
  const tokens = new Set();
  const maxLength = Math.min(6, normalized.length);
  for (let size = 2; size <= maxLength; size += 1) {
    for (let start = 0; start + size <= normalized.length; start += 1) {
      tokens.add(normalized.slice(start, start + size));
    }
  }
  return [...tokens].slice(0, 512);
}

export const AGENCY_DATA_MODEL_VERSION = 1;

export const AGENCY_LIMITS = Object.freeze({
  applicationHostIds: 5,
  minApplicationHostIds: 0,
  maxApplicationHostIds: 30,
  managerSlots: 3,
  agencyManagers: 2,
  seniorManagers: 1,
  monthlyAccrualShards: 32,
  defaultPageSize: 50,
  maxPageSize: 100,
});

export const AGENCY_STATUS = Object.freeze([
  "pending",
  "active",
  "suspended",
  "closed",
]);

export const AGENCY_MEMBERSHIP_ROLE = Object.freeze([
  "owner",
  "senior_manager",
  "manager",
  "host",
]);

export const AGENCY_MEMBERSHIP_STATUS = Object.freeze([
  "pending",
  "active",
  "left",
  "removed",
]);

export const AGENCY_APPLICATION_STATUS = Object.freeze([
  "pending",
  "under_review",
  "approved",
  "rejected",
  "cancelled",
]);

export const AGENCY_REAPPLY_MODE = Object.freeze([
  "immediate",
  "24h",
  "3d",
  "7d",
  "30d",
  "manual",
]);

export const AGENCY_REQUEST_TYPE = Object.freeze([
  "join",
  "invite",
  "leave",
  "remove",
]);

export const AGENCY_REQUEST_STATUS = Object.freeze([
  "pending",
  "accepted",
  "rejected",
  "cancelled",
  "expired",
]);

export const AGENCY_COLLECTIONS = Object.freeze({
  agencies: "agencies",
  agencyIds: "agency_ids",
  creationOperations: "agency_creation_operations",
  reviewOperations: "agency_review_operations",
  manualReapplyBlocks: "agency_manual_reapply_blocks",
  memberships: "agency_memberships",
  userMemberships: "agency_user_memberships",
  managerSlots: "agency_manager_slots",
  applications: "agency_applications",
  applicationLocks: "agency_application_locks",
  applicationOperations: "agency_application_operations",
  membershipRequests: "agency_membership_requests",
  membershipRequestKeys: "agency_membership_request_keys",
  membershipRequestOperations: "agency_membership_request_operations",
  membershipPending: "agency_membership_pending",
  membershipAcceptanceLocks: "agency_membership_acceptance_locks",
  policyOverrides: "agency_policy_overrides",
  targetSnapshots: "agency_target_snapshots",
  supportStats: "agency_support_stats",
  rankingEntries: "agency_ranking_entries",
  hostMonthly: "agency_host_monthly",
  monthlyAccrualShards: "agency_monthly_accrual_shards",
  monthlyStatements: "agency_monthly_statements",
  wallets: "agency_wallets",
  bonusAccruals: "agency_bonus_accruals",
  surplusPolicySnapshots: "agency_surplus_policy_snapshots",
  surplusSettlements: "agency_surplus_settlements",
  transfers: "agency_transfers",
  statusEvents: "agency_status_events",
});

function safePart(value, label, maxLength = 180) {
  const part = clean(value);
  if (
    !part ||
    part.length > maxLength ||
    part.includes("/") ||
    !/^[A-Za-z0-9_-]+$/.test(part)
  ) {
    throw new Error("invalid_" + label);
  }
  return part;
}

export function normalizeMonthKey(value) {
  const month = clean(value);
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new Error("invalid_agency_month");
  }
  const monthNumber = Number(month.slice(5, 7));
  if (monthNumber < 1 || monthNumber > 12) {
    throw new Error("invalid_agency_month");
  }
  return month;
}

export function normalizeDayKey(value) {
  const day = clean(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error("invalid_agency_day");
  }
  const timestamp = Date.parse(day + "T00:00:00.000Z");
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== day) {
    throw new Error("invalid_agency_day");
  }
  return day;
}

export function boundedAgencyPageSize(value, fallback = AGENCY_LIMITS.defaultPageSize) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(AGENCY_LIMITS.maxPageSize, Math.floor(parsed)));
}

export function agencyPath(agencyId) {
  return `${AGENCY_COLLECTIONS.agencies}/${safePart(agencyId, "agency_id")}`;
}

export function agencyIdRegistryPath(agencyId) {
  const id = clean(agencyId);
  if (!/^\d{3,8}$/.test(id)) throw new Error("invalid_agency_public_id");
  return `${AGENCY_COLLECTIONS.agencyIds}/${id}`;
}

export function agencyCreationOperationPath(actorUid, operationId) {
  return `${AGENCY_COLLECTIONS.creationOperations}/${safePart(actorUid, "actor_uid")}__${safePart(operationId, "agency_creation_operation_id", 120)}`;
}

export function agencyReviewOperationPath(actorUid, operationId) {
  return `${AGENCY_COLLECTIONS.reviewOperations}/${safePart(actorUid, "actor_uid")}__${safePart(operationId, "agency_review_operation_id", 120)}`;
}

export function agencyMembershipPath(agencyId, uid) {
  return `${AGENCY_COLLECTIONS.memberships}/${safePart(agencyId, "agency_id")}__${safePart(uid, "user_id")}`;
}

export function agencyUserMembershipPath(uid) {
  return `${AGENCY_COLLECTIONS.userMemberships}/${safePart(uid, "user_id")}`;
}

export function agencyManagerSlotsPath(agencyId) {
  return `${AGENCY_COLLECTIONS.managerSlots}/${safePart(agencyId, "agency_id")}`;
}

export function agencyApplicationPath(applicationId) {
  return `${AGENCY_COLLECTIONS.applications}/${safePart(applicationId, "application_id", 220)}`;
}

export function agencyApplicationLockPath(uid) {
  return `${AGENCY_COLLECTIONS.applicationLocks}/${safePart(uid, "user_id")}`;
}

export function agencyApplicationOperationPath(uid, operationId) {
  return `${AGENCY_COLLECTIONS.applicationOperations}/${safePart(uid, "user_id")}__${safePart(operationId, "application_operation_id", 120)}`;
}

export function agencyMembershipRequestPath(requestId) {
  return `${AGENCY_COLLECTIONS.membershipRequests}/${safePart(requestId, "request_id", 220)}`;
}

export function agencyMembershipRequestKeyPath(agencyId, uid) {
  return `${AGENCY_COLLECTIONS.membershipRequestKeys}/${safePart(agencyId, "agency_id")}__${safePart(uid, "user_id")}`;
}

export function agencyMembershipRequestOperationPath(actorUid, operationId) {
  return `${AGENCY_COLLECTIONS.membershipRequestOperations}/${safePart(actorUid, "actor_uid")}__${safePart(operationId, "agency_membership_operation_id", 120)}`;
}

export function agencyMembershipPendingPath(agencyId, uid) {
  return `${AGENCY_COLLECTIONS.membershipPending}/${safePart(agencyId, "agency_id")}__${safePart(uid, "user_id")}`;
}

export function agencyMembershipAcceptanceLockPath(uid) {
  return `${AGENCY_COLLECTIONS.membershipAcceptanceLocks}/${safePart(uid, "user_id")}`;
}

export function agencyPolicyOverridePath(agencyId) {
  return `${AGENCY_COLLECTIONS.policyOverrides}/${safePart(agencyId, "agency_id")}`;
}

export function agencyTargetSnapshotPath(agencyId, month) {
  return `${AGENCY_COLLECTIONS.targetSnapshots}/${safePart(agencyId, "agency_id")}__${normalizeMonthKey(month)}`;
}

export function agencySupportStatsPath(agencyId, period, key) {
  const normalizedAgencyId = safePart(agencyId, "agency_id");
  const normalizedPeriod = clean(period);
  if (!["daily", "weekly", "monthly"].includes(normalizedPeriod)) {
    throw new Error("invalid_agency_stats_period");
  }
  const normalizedKey =
    normalizedPeriod === "daily"
      ? normalizeDayKey(key)
      : normalizedPeriod === "monthly"
        ? normalizeMonthKey(key)
        : safePart(key, "agency_week", 16);
  return `${AGENCY_COLLECTIONS.supportStats}/${normalizedAgencyId}/${normalizedPeriod}/${normalizedKey}`;
}

export function agencyRankingEntryPath(periodKey, agencyId) {
  return `${AGENCY_COLLECTIONS.rankingEntries}/${safePart(periodKey, "ranking_period", 32)}__${safePart(agencyId, "agency_id")}`;
}

export function agencyHostMonthlyPath(agencyId, month, uid) {
  return `${AGENCY_COLLECTIONS.hostMonthly}/${safePart(agencyId, "agency_id")}__${normalizeMonthKey(month)}__${safePart(uid, "user_id")}`;
}

export function agencyMonthlyAccrualShardPath(agencyId, month, shard) {
  const value = Number(shard);
  if (!Number.isInteger(value) || value < 0 || value >= AGENCY_LIMITS.monthlyAccrualShards) {
    throw new Error("invalid_agency_accrual_shard");
  }
  return `${AGENCY_COLLECTIONS.monthlyAccrualShards}/${safePart(agencyId, "agency_id")}__${normalizeMonthKey(month)}__${String(value).padStart(2, "0")}`;
}

export function agencyMonthlyStatementPath(agencyId, month) {
  return `${AGENCY_COLLECTIONS.monthlyStatements}/${safePart(agencyId, "agency_id")}__${normalizeMonthKey(month)}`;
}

export function agencyWalletPath(agencyId) {
  return `${AGENCY_COLLECTIONS.wallets}/${safePart(agencyId, "agency_id")}`;
}

// Fractional Agency Share carryover has one canonical home: agency_wallets.remainderCoins.
// Do not duplicate it in a second collection.
export function agencyCarryoverPath(agencyId) {
  return agencyWalletPath(agencyId);
}

export function agencyBonusAccrualPath(agencyId, month) {
  return `${AGENCY_COLLECTIONS.bonusAccruals}/${safePart(agencyId, "agency_id")}__${normalizeMonthKey(month)}`;
}

export function agencySurplusPolicySnapshotPath(agencyId, month) {
  return `${AGENCY_COLLECTIONS.surplusPolicySnapshots}/${safePart(agencyId, "agency_id")}__${normalizeMonthKey(month)}`;
}

export function agencySurplusSettlementPath(agencyId, month, uid) {
  return `${AGENCY_COLLECTIONS.surplusSettlements}/${safePart(agencyId, "agency_id")}__${normalizeMonthKey(month)}__${safePart(uid, "user_id")}`;
}

export function agencyTransferPath(operationId) {
  return `${AGENCY_COLLECTIONS.transfers}/${safePart(operationId, "agency_transfer_id", 220)}`;
}

export function agencyStatusEventPath(eventId) {
  return `${AGENCY_COLLECTIONS.statusEvents}/${safePart(eventId, "agency_status_event_id", 220)}`;
}

export function normalizeApplicationHostIds(
  rawIds,
  requiredCount = AGENCY_LIMITS.applicationHostIds,
) {
  const count = Number(requiredCount);
  if (
    !Number.isInteger(count) ||
    count < AGENCY_LIMITS.minApplicationHostIds ||
    count > AGENCY_LIMITS.maxApplicationHostIds
  ) {
    throw new Error("invalid_agency_application_host_count");
  }
  if (!Array.isArray(rawIds) || rawIds.length !== count) {
    throw new Error("invalid_agency_application_hosts");
  }
  const ids = rawIds.map((value) => clean(value));
  if (ids.some((value) => !/^\d{3,8}$/.test(value))) {
    throw new Error("invalid_agency_application_host_id");
  }
  if (new Set(ids).size !== ids.length) {
    throw new Error("duplicate_agency_application_host");
  }
  return ids;
}

export function createAgencyDocument({
  agencyId,
  ownerUid,
  name,
  publicId,
  country = null,
  createdFrom = "application",
  sourceApplicationId = null,
  now,
} = {}) {
  const id = safePart(agencyId, "agency_id");
  const owner = safePart(ownerUid, "owner_uid");
  const displayName = clean(name);
  const normalizedPublicId = clean(publicId || id);
  if (!displayName || displayName.length > 80) throw new Error("invalid_agency_name");
  if (!/^\d{3,8}$/.test(normalizedPublicId)) throw new Error("invalid_agency_public_id");
  const normalizedCountry = country == null ? null : clean(country);
  if (normalizedCountry != null && (normalizedCountry.length < 2 || normalizedCountry.length > 64)) {
    throw new Error("invalid_agency_country");
  }
  const normalizedCreatedFrom = clean(createdFrom);
  if (!["application", "control_direct"].includes(normalizedCreatedFrom)) {
    throw new Error("invalid_agency_creation_source");
  }
  return {
    schemaVersion: AGENCY_DATA_MODEL_VERSION,
    agencyId: id,
    publicId: normalizedPublicId,
    name: displayName,
    searchNameNormalized: normalizeAgencySearchText(displayName),
    searchNameTokens: agencyNameSearchTokens(displayName),
    country: normalizedCountry,
    ownerUid: owner,
    createdFrom: normalizedCreatedFrom,
    sourceApplicationId: sourceApplicationId == null ? null : safePart(sourceApplicationId, "application_id", 220),
    status: "active",
    memberCount: 1,
    hostCount: 0,
    managerCount: 0,
    seniorManagerCount: 0,
    createdAt: now,
    updatedAt: now,
    suspendedAt: null,
    suspendedBy: null,
    suspensionReason: null,
    closedAt: null,
    closedBy: null,
    closureReason: null,
  };
}

export function createAgencyMembershipDocument({
  agencyId,
  uid,
  role = "host",
  joinedAt,
} = {}) {
  const normalizedRole = clean(role);
  if (!AGENCY_MEMBERSHIP_ROLE.includes(normalizedRole)) {
    throw new Error("invalid_agency_membership_role");
  }
  return {
    schemaVersion: AGENCY_DATA_MODEL_VERSION,
    agencyId: safePart(agencyId, "agency_id"),
    uid: safePart(uid, "user_id"),
    role: normalizedRole,
    status: "active",
    joinedAt,
    updatedAt: joinedAt,
    leftAt: null,
    removedAt: null,
    cooldownUntil: null,
  };
}

export function createAgencyManagerSlotsDocument({
  agencyId,
  seniorManagerUid = null,
  managerUids = [],
  now,
} = {}) {
  const managers = Array.isArray(managerUids)
    ? managerUids.map((uid) => safePart(uid, "manager_uid"))
    : [];
  if (managers.length > AGENCY_LIMITS.agencyManagers || new Set(managers).size !== managers.length) {
    throw new Error("invalid_agency_manager_slots");
  }
  const senior = seniorManagerUid ? safePart(seniorManagerUid, "senior_manager_uid") : null;
  if (senior && managers.includes(senior)) {
    throw new Error("duplicate_agency_manager_slot");
  }
  return {
    schemaVersion: AGENCY_DATA_MODEL_VERSION,
    agencyId: safePart(agencyId, "agency_id"),
    seniorManagerUid: senior,
    managerUids: managers,
    updatedAt: now,
  };
}

export function createAgencyApplicationDocument({
  applicationId,
  applicantUid,
  name,
  requestedPublicId,
  hostIds,
  hostUids,
  requiredHostCount = AGENCY_LIMITS.applicationHostIds,
  country = null,
  reapplyMode = null,
  now,
} = {}) {
  const mode = reapplyMode == null ? null : clean(reapplyMode);
  if (mode != null && !AGENCY_REAPPLY_MODE.includes(mode)) throw new Error("invalid_agency_reapply_mode");
  const applicationName = clean(name);
  if (!applicationName || applicationName.length > 80) throw new Error("invalid_agency_name");
  const publicId = clean(requestedPublicId);
  if (publicId && !/^\d{3,8}$/.test(publicId)) throw new Error("invalid_agency_public_id");
  const normalizedHostIds = normalizeApplicationHostIds(
    hostIds,
    requiredHostCount,
  );
  const normalizedHostUids = Array.isArray(hostUids)
    ? hostUids.map((uid) => safePart(uid, "host_uid"))
    : [];
  if (
    normalizedHostUids.length !== requiredHostCount ||
    new Set(normalizedHostUids).size !== normalizedHostUids.length
  ) {
    throw new Error("invalid_agency_application_host_uids");
  }
  const normalizedCountry = country == null ? null : clean(country);
  if (normalizedCountry != null && (normalizedCountry.length < 2 || normalizedCountry.length > 64)) {
    throw new Error("invalid_agency_country");
  }
  return {
    schemaVersion: AGENCY_DATA_MODEL_VERSION,
    applicationId: safePart(applicationId, "application_id", 220),
    applicantUid: safePart(applicantUid, "applicant_uid"),
    name: applicationName,
    requestedPublicId: publicId || null,
    country: normalizedCountry,
    hostIds: normalizedHostIds,
    hostUids: normalizedHostUids,
    requiredHostCount,
    status: "pending",
    reapplyMode: mode,
    reapplyAllowedAt: null,
    rejectionReason: null,
    createdAt: now,
    updatedAt: now,
    reviewedAt: null,
    reviewedBy: null,
  };
}

export function createAgencyMembershipRequestDocument({
  requestId,
  agencyId,
  uid,
  type,
  actorUid,
  now,
} = {}) {
  const normalizedType = clean(type);
  if (!AGENCY_REQUEST_TYPE.includes(normalizedType)) {
    throw new Error("invalid_agency_request_type");
  }
  const normalizedActorUid = safePart(actorUid, "actor_uid");
  const userConsent = normalizedType === "join";
  const agencyConsent = normalizedType === "invite";
  return {
    schemaVersion: AGENCY_DATA_MODEL_VERSION,
    requestId: safePart(requestId, "request_id", 220),
    agencyId: safePart(agencyId, "agency_id"),
    uid: safePart(uid, "user_id"),
    type: normalizedType,
    targetRole: "host",
    status: "pending",
    actorUid: normalizedActorUid,
    initiatorSide:
      normalizedType === "join"
        ? "user"
        : normalizedType === "invite"
          ? "agency"
          : "system",
    userConsent,
    agencyConsent,
    acceptedAt: null,
    createdAt: now,
    updatedAt: now,
    resolvedAt: null,
    resolvedBy: null,
    reason: null,
  };
}

export function createAgencyTargetSnapshotDocument({
  agencyId,
  month,
  targets,
  source = "global_default",
  now,
} = {}) {
  if (!Array.isArray(targets) || targets.length === 0 || targets.length > 64) {
    throw new Error("invalid_agency_targets");
  }
  return {
    schemaVersion: AGENCY_DATA_MODEL_VERSION,
    agencyId: safePart(agencyId, "agency_id"),
    month: normalizeMonthKey(month),
    source: clean(source) || "global_default",
    targets,
    createdAt: now,
    updatedAt: now,
  };
}

export function createAgencyStatusEventDocument({
  eventId,
  agencyId,
  type,
  reason,
  actorUid,
  now,
} = {}) {
  const normalizedType = clean(type);
  if (!["suspend", "resume", "close"].includes(normalizedType)) {
    throw new Error("invalid_agency_status_event");
  }
  return {
    schemaVersion: AGENCY_DATA_MODEL_VERSION,
    eventId: safePart(eventId, "agency_status_event_id", 220),
    agencyId: safePart(agencyId, "agency_id"),
    type: normalizedType,
    reason: clean(reason).slice(0, 500),
    actorUid: safePart(actorUid, "actor_uid"),
    createdAt: now,
  };
}
