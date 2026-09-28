const clean = (value) => String(value ?? "").trim();

export const PLATFORM_AGENCY_CAPABILITIES = Object.freeze([
  "manageAgencies",
  "reviewAgencyApplications",
  "manageAgencyMemberships",
  "manageAgencyManagers",
  "viewAgencyFinance",
  "manageAgencyPolicies",
  "manageAgencySettlements",
  "suspendAgencies",
]);

export const AGENCY_MEMBER_ACTIONS = Object.freeze([
  "viewAgency",
  "viewOwnProgress",
  "viewHosts",
  "reviewMembershipRequests",
  "manageInvites",
  "manageRooms",
  "manageManagers",
  "viewAgencyFinance",
]);

function capabilitySet(user = {}) {
  return new Set(
    Array.isArray(user.capabilities)
      ? user.capabilities.map(clean).filter(Boolean)
      : [],
  );
}

export function platformAgencyPermissions(user = {}) {
  const capabilities = capabilitySet(user);
  const isOwner = clean(user.role) === "owner";
  const adminEnabled = user.adminEnabled === true;
  const has = (capability) =>
    isOwner || (adminEnabled && capabilities.has(capability));
  const broad = has("manageAgencies");

  return {
    isOwner,
    adminEnabled,
    canManageAgencies: broad,
    canReviewApplications: broad || has("reviewAgencyApplications"),
    canManageMemberships: broad || has("manageAgencyMemberships"),
    canManageManagers: broad || has("manageAgencyManagers"),
    canViewAgencyFinance: isOwner || has("viewAgencyFinance"),
    canManagePolicies: isOwner || has("manageAgencyPolicies"),
    canManageAgencySettlements: isOwner || has("manageAgencySettlements"),
    canSuspendAgencies: broad || has("suspendAgencies"),
    // Permanent agency closure is intentionally non-delegable.
    canCloseAgencies: isOwner,
  };
}

export function agencyMemberPermissions({
  membership = {},
  agencyStatus = "active",
} = {}) {
  const role = clean(membership.role);
  const membershipActive = clean(membership.status) === "active";
  const agencyActive = clean(agencyStatus) === "active";
  const active = membershipActive && agencyActive;

  const isOwner = membershipActive && role === "owner";
  const isSeniorManager = membershipActive && role === "senior_manager";
  const isManager = membershipActive && role === "manager";
  const isHost = membershipActive && role === "host";
  const isManagement = isOwner || isSeniorManager || isManager;

  return {
    role,
    membershipActive,
    agencyActive,
    canViewAgency: membershipActive,
    canViewOwnProgress: membershipActive,
    canViewHosts: isManagement,
    canReviewMembershipRequests: active && isManagement,
    canManageInvites: active && isManagement,
    canManageRooms: active && isManagement,
    // Senior managers intentionally inherit the approved manager baseline.
    // Additional senior-only rights are not invented here.
    canManageManagers: active && isOwner,
    canViewAgencyFinance: isOwner,
  };
}

export function canPerformAgencyAction({
  action,
  user = {},
  membership = {},
  agencyStatus = "active",
} = {}) {
  const platform = platformAgencyPermissions(user);
  const member = agencyMemberPermissions({membership, agencyStatus});

  switch (clean(action)) {
    case "reviewApplication":
      return platform.canReviewApplications;
    case "directCreateAgency":
      return platform.canManageAgencies;
    case "manageMembership":
      return platform.canManageMemberships;
    case "manageManager":
      return platform.canManageManagers || member.canManageManagers;
    case "setPolicyOverride":
      return platform.canManagePolicies;
    case "viewAgencyFinance":
      return platform.canViewAgencyFinance || member.canViewAgencyFinance;
    case "settleAgencyMonth":
      return platform.canManageAgencySettlements;
    case "suspendAgency":
      return platform.canSuspendAgencies;
    case "closeAgency":
      return platform.canCloseAgencies;
    case "reviewMembershipRequest":
      return platform.canManageMemberships || member.canReviewMembershipRequests;
    case "manageInvite":
      return platform.canManageMemberships || member.canManageInvites;
    case "viewHosts":
      return platform.canManageAgencies || member.canViewHosts;
    case "manageRoom":
      return platform.canManageAgencies || member.canManageRooms;
    case "viewOwnProgress":
      return member.canViewOwnProgress;
    default:
      return false;
  }
}

export function assertAgencyAction(context = {}) {
  if (!canPerformAgencyAction(context)) {
    throw new Error("agency_action_forbidden");
  }
}
