import assert from "node:assert/strict";
import test from "node:test";
import {
  agencyMemberPermissions,
  canPerformAgencyAction,
  platformAgencyPermissions,
} from "../economy/agency-permissions.js";

test("platform owner has all agency permissions and permanent close",()=>{
  const p=platformAgencyPermissions({role:"owner"});
  assert.equal(p.canManageAgencies,true);
  assert.equal(p.canReviewApplications,true);
  assert.equal(p.canManageMemberships,true);
  assert.equal(p.canManageManagers,true);
  assert.equal(p.canViewAgencyFinance,true);
  assert.equal(p.canManagePolicies,true);
  assert.equal(p.canManageAgencySettlements,true);
  assert.equal(p.canSuspendAgencies,true);
  assert.equal(p.canCloseAgencies,true);
});

test("granular admin agency capabilities require adminEnabled",()=>{
  const disabled=platformAgencyPermissions({
    role:"admin",
    adminEnabled:false,
    capabilities:["reviewAgencyApplications","suspendAgencies"],
  });
  assert.equal(disabled.canReviewApplications,false);
  assert.equal(disabled.canSuspendAgencies,false);

  const enabled=platformAgencyPermissions({
    role:"admin",
    adminEnabled:true,
    capabilities:["reviewAgencyApplications","suspendAgencies"],
  });
  assert.equal(enabled.canReviewApplications,true);
  assert.equal(enabled.canSuspendAgencies,true);
  assert.equal(enabled.canCloseAgencies,false);
});

test("manageAgencies is operational only and never delegates finance policy settlement or close",()=>{
  const p=platformAgencyPermissions({
    role:"super_admin",
    adminEnabled:true,
    capabilities:["manageAgencies"],
  });
  assert.equal(p.canManageMemberships,true);
  assert.equal(p.canManageManagers,true);
  assert.equal(p.canViewAgencyFinance,false);
  assert.equal(p.canManagePolicies,false);
  assert.equal(p.canManageAgencySettlements,false);
  assert.equal(p.canSuspendAgencies,true);
  assert.equal(p.canCloseAgencies,false);
});

test("senior manager can review while manager requires explicit review capability",()=>{
  const senior=agencyMemberPermissions({
    membership:{role:"senior_manager",status:"active"},
    agencyStatus:"active",
  });
  assert.equal(senior.canReviewMembershipRequests,true);
  assert.equal(senior.canManageInvites,true);
  assert.equal(senior.canViewHosts,true);
  assert.equal(senior.canManageRooms,true);
  assert.equal(senior.canManageManagers,false);
  assert.equal(senior.canViewAgencyFinance,false);

  const managerWithoutCapability=agencyMemberPermissions({
    membership:{role:"manager",status:"active",capabilities:[]},
    agencyStatus:"active",
  });
  assert.equal(managerWithoutCapability.canReviewMembershipRequests,false);
  assert.equal(managerWithoutCapability.canManageInvites,true);

  const managerWithCapability=agencyMemberPermissions({
    membership:{
      role:"manager",
      status:"active",
      capabilities:["reviewMembershipRequest"],
    },
    agencyStatus:"active",
  });
  assert.equal(managerWithCapability.canReviewMembershipRequests,true);
  assert.equal(managerWithCapability.canManageManagers,false);
  assert.equal(managerWithCapability.canViewAgencyFinance,false);
});

test("agency owner can manage managers and view finance",()=>{
  const p=agencyMemberPermissions({
    membership:{role:"owner",status:"active"},
    agencyStatus:"active",
  });
  assert.equal(p.canManageManagers,true);
  assert.equal(p.canViewAgencyFinance,true);
});

test("suspension preserves reads but disables internal management",()=>{
  const p=agencyMemberPermissions({
    membership:{role:"manager",status:"active"},
    agencyStatus:"suspended",
  });
  assert.equal(p.canViewAgency,true);
  assert.equal(p.canViewHosts,true);
  assert.equal(p.canReviewMembershipRequests,false);
  assert.equal(p.canManageInvites,false);
  assert.equal(p.canManageRooms,false);
});

test("host can view own progress but cannot manage agency",()=>{
  const p=agencyMemberPermissions({
    membership:{role:"host",status:"active"},
    agencyStatus:"active",
  });
  assert.equal(p.canViewOwnProgress,true);
  assert.equal(p.canViewHosts,false);
  assert.equal(p.canManageInvites,false);
});

test("permanent close remains owner only",()=>{
  assert.equal(canPerformAgencyAction({
    action:"closeAgency",
    user:{role:"admin",adminEnabled:true,capabilities:["manageAgencies","suspendAgencies"]},
  }),false);
  assert.equal(canPerformAgencyAction({
    action:"closeAgency",
    user:{role:"owner"},
  }),true);
});
