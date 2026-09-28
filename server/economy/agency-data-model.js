const clean = (value) => String(value ?? "").trim();

export const AGENCY_DATA_MODEL_VERSION = 1;

export const AGENCY_LIMITS = Object.freeze({
  applicationHostIds: 5,
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
  memberships: "agency_memberships",
  userMemberships: "agency_user_memberships",
  managerSlots: "agency_manager_slots",
  applications: "agency_applications",
  membershipRequests: "agency_membership_requests",
  policyOverrides: "agency_policy_overrides",
  targetSnapshots: "agency_target_snapshots",
  supportStats: "agency_support_stats",
  rankingEntries: "agency_ranking_entries",
  hostMonthly: "agency_host_monthly",
  monthlyAccrualShards: "agency_monthly_accrual_shards",
  monthlyStatements: "agency_monthly_statements",
  wallets: "agency_wallets",
  bonusAccruals: "agency_bonus_accruals",
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

export function agencyMembershipRequestPath(requestId) {
  return `${AGENCY_COLLECTIONS.membershipRequests}/${safePart(requestId, "request_id", 220)}`;
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

export function agencyTransferPath(operationId) {
  return `${AGENCY_COLLECTIONS.transfers}/${safePart(operationId, "agency_transfer_id", 220)}`;
}

export function agencyStatusEventPath(eventId) {
  return `${AGENCY_COLLECTIONS.statusEvents}/${safePart(eventId, "agency_status_event_id", 220)}`;
}

export function normalizeApplicationHostIds(rawIds) {
  if (!Array.isArray(rawIds) || rawIds.length !== AGENCY_LIMITS.applicationHostIds) {
    throw new Error("invalid_agency_application_hosts");
  }
  const ids = rawIds.map((uid) => safePart(uid, "host_uid"));
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
  now,
} = {}) {
  const id = safePart(agencyId, "agency_id");
  const owner = safePart(ownerUid, "owner_uid");
  const displayName = clean(name);
  const normalizedPublicId = clean(publicId || id);
  if (!displayName || displayName.length > 80) throw new Error("invalid_agency_name");
  if (!/^\d{6}$/.test(normalizedPublicId)) throw new Error("invalid_agency_public_id");
  return {
    schemaVersion: AGENCY_DATA_MODEL_VERSION,
    agencyId: id,
    publicId: normalizedPublicId,
    name: displayName,
    ownerUid: owner,
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
  hostUids,
  reapplyMode = "immediate",
  now,
} = {}) {
  const mode = clean(reapplyMode);
  if (!["immediate", "24h"].includes(mode)) throw new Error("invalid_agency_reapply_mode");
  const applicationName = clean(name);
  if (!applicationName || applicationName.length > 80) throw new Error("invalid_agency_name");
  const publicId = clean(requestedPublicId);
  if (publicId && !/^\d{6}$/.test(publicId)) throw new Error("invalid_agency_public_id");
  return {
    schemaVersion: AGENCY_DATA_MODEL_VERSION,
    applicationId: safePart(applicationId, "application_id", 220),
    applicantUid: safePart(applicantUid, "applicant_uid"),
    name: applicationName,
    requestedPublicId: publicId || null,
    hostUids: normalizeApplicationHostIds(hostUids),
    status: "pending",
    reapplyMode: mode,
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
  return {
    schemaVersion: AGENCY_DATA_MODEL_VERSION,
    requestId: safePart(requestId, "request_id", 220),
    agencyId: safePart(agencyId, "agency_id"),
    uid: safePart(uid, "user_id"),
    type: normalizedType,
    status: "pending",
    actorUid: safePart(actorUid, "actor_uid"),
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
