import assert from "node:assert/strict";
import {test} from "node:test";

import {
  AGENCY_COLLECTIONS,
  AGENCY_LIMITS,
  agencyApplicationLockPath,
  agencyApplicationOperationPath,
  agencyCreationOperationPath,
  agencyIdRegistryPath,
  agencyReviewOperationPath,
  agencyApplicationPath,
  agencyCarryoverPath,
  agencyHostMonthlyPath,
  agencyManagerSlotsPath,
  agencyMembershipAcceptanceLockPath,
  agencyMembershipPath,
  agencyMembershipPendingPath,
  agencyMembershipRequestKeyPath,
  agencyMembershipRequestOperationPath,
  agencyMonthlyAccrualShardPath,
  agencyMonthlyStatementPath,
  agencyStatusEventPath,
  agencyTargetSnapshotPath,
  agencyTransferPath,
  agencyUserMembershipPath,
  agencyWalletPath,
  boundedAgencyPageSize,
  createAgencyApplicationDocument,
  createAgencyDocument,
  createAgencyManagerSlotsDocument,
  createAgencyMembershipDocument,
  createAgencyMembershipRequestDocument,
  createAgencyStatusEventDocument,
  createAgencyTargetSnapshotDocument,
  normalizeApplicationHostIds,
  normalizeDayKey,
  normalizeMonthKey,
} from "../economy/agency-data-model.js";

test("agency model keeps bounded pressure constants",()=>{
  assert.equal(AGENCY_LIMITS.monthlyAccrualShards,32);
  assert.equal(AGENCY_LIMITS.defaultPageSize,50);
  assert.equal(AGENCY_LIMITS.maxPageSize,100);
  assert.equal(AGENCY_LIMITS.managerSlots,3);
  assert.equal(AGENCY_LIMITS.agencyManagers,2);
  assert.equal(AGENCY_LIMITS.seniorManagers,1);
  assert.equal(AGENCY_LIMITS.minApplicationHostIds,0);
  assert.equal(AGENCY_LIMITS.maxApplicationHostIds,30);
  assert.equal(boundedAgencyPageSize(999),100);
  assert.equal(boundedAgencyPageSize(0),1);
});

test("canonical agency paths are deterministic and direct lookup friendly",()=>{
  assert.equal(agencyMembershipPath("123456","user_1"),"agency_memberships/123456__user_1");
  assert.equal(agencyUserMembershipPath("user_1"),"agency_user_memberships/user_1");
  assert.equal(
    agencyMembershipRequestKeyPath("123456","user_1"),
    "agency_membership_request_keys/123456__user_1",
  );
  assert.equal(
    agencyMembershipRequestOperationPath("user_1","membership_op_123"),
    "agency_membership_request_operations/user_1__membership_op_123",
  );
  assert.equal(
    agencyMembershipPendingPath("123456","user_1"),
    "agency_membership_pending/123456__user_1",
  );
  assert.equal(
    agencyMembershipAcceptanceLockPath("user_1"),
    "agency_membership_acceptance_locks/user_1",
  );
  assert.equal(agencyManagerSlotsPath("123456"),"agency_manager_slots/123456");
  assert.equal(agencyApplicationPath("application_1"),"agency_applications/application_1");
  assert.equal(agencyApplicationLockPath("user_1"),"agency_application_locks/user_1");
  assert.equal(
    agencyApplicationOperationPath("user_1","operation_123456"),
    "agency_application_operations/user_1__operation_123456",
  );
  assert.equal(agencyIdRegistryPath("654321"),"agency_ids/654321");
  assert.equal(agencyIdRegistryPath("321"),"agency_ids/321");
  assert.equal(agencyIdRegistryPath("12345678"),"agency_ids/12345678");
  assert.equal(
    agencyCreationOperationPath("owner_1","operation_123456"),
    "agency_creation_operations/owner_1__operation_123456",
  );
  assert.throws(()=>agencyIdRegistryPath("12"),/invalid_agency_public_id/);
  assert.throws(()=>agencyIdRegistryPath("123456789"),/invalid_agency_public_id/);
  assert.equal(
    agencyReviewOperationPath("owner_1","review_operation_123"),
    "agency_review_operations/owner_1__review_operation_123",
  );
  assert.equal(
    agencyHostMonthlyPath("123456","2026-09","user_1"),
    "agency_host_monthly/123456__2026-09__user_1",
  );
  assert.equal(
    agencyMonthlyStatementPath("123456","2026-09"),
    "agency_monthly_statements/123456__2026-09",
  );
  assert.equal(agencyTransferPath("transfer_1"),"agency_transfers/transfer_1");
  assert.equal(agencyStatusEventPath("event_1"),"agency_status_events/event_1");
  assert.equal(AGENCY_COLLECTIONS.rankingEntries,"agency_ranking_entries");
});

test("agency fractional carryover has one canonical wallet location",()=>{
  assert.equal(agencyCarryoverPath("123456"),agencyWalletPath("123456"));
  assert.equal(agencyCarryoverPath("123456"),"agency_wallets/123456");
});

test("monthly accrual shard paths are fixed to 32 bounded shards",()=>{
  assert.equal(
    agencyMonthlyAccrualShardPath("123456","2026-09",0),
    "agency_monthly_accrual_shards/123456__2026-09__00",
  );
  assert.equal(
    agencyMonthlyAccrualShardPath("123456","2026-09",31),
    "agency_monthly_accrual_shards/123456__2026-09__31",
  );
  assert.throws(()=>agencyMonthlyAccrualShardPath("123456","2026-09",32),/invalid_agency_accrual_shard/);
});

test("agency calendar keys reject invalid values",()=>{
  assert.equal(normalizeMonthKey("2026-09"),"2026-09");
  assert.equal(normalizeDayKey("2026-09-28"),"2026-09-28");
  assert.throws(()=>normalizeMonthKey("2026-13"),/invalid_agency_month/);
  assert.throws(()=>normalizeDayKey("2026-02-31"),/invalid_agency_day/);
});

test("agency creation accepts 3-8 digit public ids",()=>{
  const doc=createAgencyDocument({
    agencyId:"123456",
    ownerUid:"owner_1",
    name:"Shadow Agency",
    publicId:"123456",
    now:"now",
  });
  assert.equal(doc.status,"active");
  assert.equal(doc.ownerUid,"owner_1");
  assert.equal(doc.memberCount,1);
  assert.equal(
    createAgencyDocument({
      agencyId:"123456",ownerUid:"owner_1",name:"Shadow",publicId:"321",now:"now",
    }).publicId,
    "321",
  );
  assert.equal(
    createAgencyDocument({
      agencyId:"123456",ownerUid:"owner_1",name:"Shadow",publicId:"12345678",now:"now",
    }).publicId,
    "12345678",
  );
  assert.throws(
    ()=>createAgencyDocument({
      agencyId:"123456",ownerUid:"owner_1",name:"Shadow",publicId:"12",now:"now",
    }),
    /invalid_agency_public_id/,
  );
  assert.throws(
    ()=>createAgencyDocument({
      agencyId:"123456",ownerUid:"owner_1",name:"Shadow",publicId:"123456789",now:"now",
    }),
    /invalid_agency_public_id/,
  );
});

test("application data model supports configured 0-30 unique host ids",()=>{
  const hostIds=["101","1002","10003","100004","10000005"];
  const hostUids=["h1","h2","h3","h4","h5"];
  assert.deepEqual(normalizeApplicationHostIds(hostIds),hostIds);
  const doc=createAgencyApplicationDocument({
    applicationId:"app_1",
    applicantUid:"owner_1",
    name:"Agency",
    requestedPublicId:"654321",
    hostIds,
    hostUids,
    reapplyMode:"30d",
    now:"now",
  });
  assert.equal(doc.hostIds.length,5);
  assert.equal(doc.hostUids.length,5);
  assert.equal(doc.status,"pending");
  assert.equal(doc.reapplyMode,"30d");
  assert.deepEqual(normalizeApplicationHostIds([],0),[]);
  assert.deepEqual(
    normalizeApplicationHostIds(["123","1234","12345"],3),
    ["123","1234","12345"],
  );
  assert.throws(
    ()=>normalizeApplicationHostIds(["100001"],5),
    /invalid_agency_application_hosts/,
  );
  assert.throws(
    ()=>normalizeApplicationHostIds([],31),
    /invalid_agency_application_host_count/,
  );
  assert.throws(
    ()=>normalizeApplicationHostIds(["101","1002","10003","100004","100004"]),
    /duplicate_agency_application_host/,
  );
  assert.throws(
    ()=>normalizeApplicationHostIds(["12","1002","10003","100004","10000005"]),
    /invalid_agency_application_host_id/,
  );
});

test("manager slots are bounded to two managers plus one senior manager",()=>{
  const slots=createAgencyManagerSlotsDocument({
    agencyId:"123456",
    seniorManagerUid:"senior_1",
    managerUids:["manager_1","manager_2"],
    now:"now",
  });
  assert.equal(slots.seniorManagerUid,"senior_1");
  assert.equal(slots.managerUids.length,2);
  assert.throws(
    ()=>createAgencyManagerSlotsDocument({
      agencyId:"123456",
      managerUids:["m1","m2","m3"],
      now:"now",
    }),
    /invalid_agency_manager_slots/,
  );
  assert.throws(
    ()=>createAgencyManagerSlotsDocument({
      agencyId:"123456",
      seniorManagerUid:"m1",
      managerUids:["m1"],
      now:"now",
    }),
    /duplicate_agency_manager_slot/,
  );
});

test("membership and requests preserve direct agency and user keys",()=>{
  const membership=createAgencyMembershipDocument({
    agencyId:"123456",uid:"host_1",role:"host",joinedAt:"now",
  });
  assert.equal(membership.status,"active");
  assert.equal(membership.role,"host");

  const request=createAgencyMembershipRequestDocument({
    requestId:"request_1",
    agencyId:"123456",
    uid:"host_1",
    type:"join",
    actorUid:"host_1",
    now:"now",
  });
  assert.equal(request.status,"pending");
  assert.equal(request.type,"join");
  assert.equal(request.targetRole,"host");
  assert.equal(request.userConsent,true);
  assert.equal(request.agencyConsent,false);
  assert.equal(request.initiatorSide,"user");
});

test("target snapshots and status events are monthly and audit friendly",()=>{
  const snapshot=createAgencyTargetSnapshotDocument({
    agencyId:"123456",
    month:"2026-09",
    targets:[{id:"starter_g",thresholdCoins:50000,salaryDiamonds:5}],
    now:"now",
  });
  assert.equal(snapshot.month,"2026-09");
  assert.equal(
    agencyTargetSnapshotPath("123456","2026-09"),
    "agency_target_snapshots/123456__2026-09",
  );

  const event=createAgencyStatusEventDocument({
    eventId:"event_1",
    agencyId:"123456",
    type:"suspend",
    reason:"review",
    actorUid:"owner_1",
    now:"now",
  });
  assert.equal(event.type,"suspend");
  assert.equal(event.reason,"review");
});
