import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {after, before, test} from "node:test";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {collection, deleteDoc, doc, getDoc, getDocs, limit, query, setDoc, updateDoc} from "firebase/firestore";

let env;
const projectId="shadow-live-economy-test";
const uid="rules_regular_user";
const otherUid="rules_other_user";
const agencyId="654321";
const agencyOwnerUid="rules_agency_owner";
const agencyManagerUid="rules_agency_manager";
const agencyHostUid="rules_agency_host";
const agencyOutsiderUid="rules_agency_outsider";
const platformAgencyAdminUid="rules_platform_agency_admin";

function phoneDbFor(userId) {
  return env.authenticatedContext(userId,{
    phone_number:"+971500000001",
    firebase:{sign_in_provider:"phone"},
  }).firestore();
}

function unverifiedUserDb() {
  return env.authenticatedContext(uid,{
    email:"unverified@example.com",
    email_verified:false,
    firebase:{sign_in_provider:"password"},
  }).firestore();
}

function phoneUserDb() {
  return env.authenticatedContext(uid,{
    phone_number:"+971500000000",
    firebase:{sign_in_provider:"phone"},
  }).firestore();
}

function phoneUserWithEmailClaimDb() {
  return env.authenticatedContext(uid,{
    phone_number:"+971500000000",
    email:"linked-unverified@example.com",
    email_verified:false,
    firebase:{sign_in_provider:"phone"},
  }).firestore();
}

before(async()=>{
  env=await initializeTestEnvironment({
    projectId,
    firestore:{
      host:"127.0.0.1",
      port:8080,
      rules:readFileSync("firestore.rules","utf8"),
    },
  });
  await env.withSecurityRulesDisabled(async context=>{
    await setDoc(doc(context.firestore(),"users",uid),{
      role:"user",
      displayName:"Before",
      coins:1000000,
      diamonds:2,
      pendingGiftEarningCoins:0,
      pendingAgencyGiftEarningCoins:0,
      giftEarningCoinsLifetime:0,
      giftDiamondsLifetime:0,
      giftSupportReceivedCoins:0,
      giftRevenueMonth:"2026-09",
      giftRevenueMonthCoins:0,
      currentGiftRevenueTier:"starter",
      giftHostActivityMonth:"2026-09",
      giftHostMicSecondsMonth:0,
      giftHostQualifiedDays:0,
    });
    await setDoc(doc(context.firestore(),"users",otherUid),{
      role:"user",
      displayName:"Other",
      coins:0,
      diamonds:0,
      pendingGiftEarningCoins:0,
      pendingAgencyGiftEarningCoins:0,
      giftEarningCoinsLifetime:0,
      giftDiamondsLifetime:0,
      giftSupportReceivedCoins:0,
      giftRevenueMonth:"2026-09",
      giftRevenueMonthCoins:0,
      currentGiftRevenueTier:"starter",
      giftHostActivityMonth:"2026-09",
      giftHostMicSecondsMonth:0,
      giftHostQualifiedDays:0,
    });
    await setDoc(doc(context.firestore(),"conversations","rules_chat"),{
      participants:[uid,otherUid],
      createdAt:new Date(),
      updatedAt:new Date(),
      unreadCounts:{[uid]:0,[otherUid]:0},
    });
    await setDoc(doc(context.firestore(),"follows",`${uid}__${otherUid}`),{
      fromUid:uid,
      toUid:otherUid,
      createdAt:new Date(),
    });
    await setDoc(doc(context.firestore(),"follows",`${otherUid}__${uid}`),{
      fromUid:otherUid,
      toUid:uid,
      createdAt:new Date(),
    });
    await setDoc(doc(context.firestore(),"rooms","rules_room"),{
      name:"Rules Room",
      isActive:true,
      createdAt:new Date(),
    });
    for (const [userId,data] of [
      [agencyOwnerUid,{role:"user",adminEnabled:false,capabilities:[],agencyId}],
      [agencyManagerUid,{role:"user",adminEnabled:false,capabilities:[],agencyId}],
      [agencyHostUid,{role:"user",adminEnabled:false,capabilities:[],agencyId}],
      [agencyOutsiderUid,{role:"user",adminEnabled:false,capabilities:[]}],
      [platformAgencyAdminUid,{
        role:"admin",
        adminEnabled:true,
        capabilities:["manageAgencyMemberships","viewAgencyFinance"],
      }],
    ]) {
      await setDoc(doc(context.firestore(),"users",userId),{
        displayName:userId,
        coins:0,
        diamonds:0,
        ...data,
      });
    }
    await setDoc(doc(context.firestore(),"agencies",agencyId),{
      agencyId,
      publicId:agencyId,
      name:"Rules Agency",
      ownerUid:agencyOwnerUid,
      status:"active",
    });
    for (const [userId,role] of [
      [agencyOwnerUid,"owner"],
      [agencyManagerUid,"manager"],
      [agencyHostUid,"host"],
    ]) {
      await setDoc(doc(context.firestore(),"agency_memberships",agencyId+"__"+userId),{
        agencyId,
        uid:userId,
        role,
        status:"active",
      });
      await setDoc(doc(context.firestore(),"agency_user_memberships",userId),{
        agencyId,
        uid:userId,
        role,
        status:"active",
      });
    }
    await setDoc(doc(context.firestore(),"agency_manager_slots",agencyId),{
      agencyId,
      seniorManagerUid:null,
      managerUids:[agencyManagerUid],
    });
    await setDoc(doc(context.firestore(),"agency_policy_overrides",agencyId),{
      agencyId,
      hostShareBps:5000,
      agencyShareBps:500,
    });
    await setDoc(doc(context.firestore(),"agency_target_snapshots",agencyId+"__2026-09"),{
      agencyId,
      month:"2026-09",
      targets:[{id:"starter_g",thresholdCoins:50000}],
    });
    await setDoc(doc(context.firestore(),"agency_host_monthly",agencyId+"__2026-09__"+agencyHostUid),{
      agencyId,
      hostUid:agencyHostUid,
      month:"2026-09",
      supportCoins:50000,
      salaryPaidDiamonds:5,
    });
    await setDoc(doc(context.firestore(),"agency_wallets",agencyId),{
      agencyId,
      diamonds:12,
      remainderCoins:2500,
    });
    await setDoc(doc(context.firestore(),"agency_monthly_statements",agencyId+"__2026-09"),{
      agencyId,
      month:"2026-09",
      agencyDiamonds:5,
      status:"settled",
    });
    await setDoc(doc(context.firestore(),"agency_status_events","rules_agency_event"),{
      agencyId,
      type:"suspend",
      reason:"rules-test",
    });
    await setDoc(doc(context.firestore(),"agency_applications","rules_application"),{
      applicationId:"rules_application",
      applicantUid:uid,
      name:"Rules Application",
      hostIds:["410001","410002","410003","410004","410005"],
      hostUids:["h1","h2","h3","h4","h5"],
      status:"pending",
    });
    for (let i = 0; i < 59; i += 1) {
      await setDoc(doc(context.firestore(),"rooms",`rules_room_${i}`),{
        name:`Rules Room ${i}`,
        isActive:true,
        createdAt:new Date(),
      });
    }
  });
});

after(async()=>{if(env)await env.cleanup();});

test("regular user can still update an ordinary profile field",async()=>{
  const userDb=phoneUserDb();
  await assertSucceeds(updateDoc(doc(userDb,"users",uid),{displayName:"After"}));
});

test("phone-auth user is unaffected by email verification gate",async()=>{
  const userDb=phoneUserDb();
  await assertSucceeds(updateDoc(doc(userDb,"users",uid),{displayName:"Phone User"}));
});

test("phone-auth user with an unverified linked email claim still has Firestore access",async()=>{
  const userDb=phoneUserWithEmailClaimDb();
  await assertSucceeds(updateDoc(doc(userDb,"users",uid),{displayName:"Phone With Email"}));
});

test("phone-auth user with an unverified linked email can still read rooms",async()=>{
  const userDb=phoneUserWithEmailClaimDb();
  await assertSucceeds(getDoc(doc(userDb,"rooms","rules_room")));
});

test("phone-auth user can execute the production room-list query at limit 60",async()=>{
  const userDb=phoneUserWithEmailClaimDb();
  const roomQuery=query(collection(userDb,"rooms"),limit(60));
  const snapshot=await assertSucceeds(getDocs(roomQuery));
  assert.equal(snapshot.size,60);
});

test("unverified email/password user cannot access Firestore",async()=>{
  const userDb=unverifiedUserDb();
  await assertFails(updateDoc(doc(userDb,"users",uid),{displayName:"Blocked"}));
  await assertFails(getDoc(doc(userDb,"rooms","rules_room")));
});

test("public profile accepts R2 media object ids",async()=>{
  const userDb=phoneUserDb();
  await assertSucceeds(setDoc(doc(userDb,"public_profiles",uid),{
    uid,
    displayName:"R2 Profile",
    username:"",
    publicId:"",
    searchTokens:["r2","profile"],
    profileImageUrl:"https://shadow-live.example/api/public-media/profile_image/rules_regular_user/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg",
    profileImageObjectId:"a".repeat(32),
    profileAvatarAsset:"",
    coverImageUrl:"https://shadow-live.example/api/public-media/profile_cover/rules_regular_user/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.jpg",
    coverImageObjectId:"b".repeat(32),
    bio:"",
    location:"",
    interests:[],
    level:0,
    vipLevel:0,
    badges:[],
    isOnline:true,
    createdAt:new Date(),
    updatedAt:new Date(),
  }));
});

test("chat image message accepts private R2 object metadata",async()=>{
  const userDb=phoneUserDb();
  await assertSucceeds(setDoc(
    doc(userDb,"conversations","rules_chat","messages","r2_image"),
    {
      senderId:uid,
      receiverId:otherUid,
      type:"image",
      storageObjectId:"c".repeat(32),
      mimeType:"image/webp",
      sizeBytes:4096,
      createdAt:new Date(),
    },
  ));
});

test("regular user cannot change protected balances earnings agency or mic activity",async()=>{
  const userDb=phoneUserDb();
  const ref=doc(userDb,"users",uid);
  for(const patch of [
    {coins:999999},
    {diamonds:999},
    {agencyId:"agency_hacked"},
    {agencyPolicySnapshot:{targets:[{id:"hacked",thresholdCoins:1,salaryDiamonds:999999}]}},
    {agencyTargetMonth:"2026-09"},
    {agencyTargetProgressCoins:50000000},
    {agencySalaryPaidDiamonds:0},
    {agencyCurrentTargetId:"diamond"},
    {agencyNextTargetCoins:0},
    {agencyTargetUpdatedAt:new Date()},
    {pendingGiftEarningCoins:5000},
    {pendingAgencyGiftEarningCoins:5000},
    {giftEarningCoinsLifetime:5000},
    {giftDiamondsLifetime:5000},
    {giftSupportReceivedCoins:5000},
    {giftRevenueMonthCoins:5000},
    {currentGiftRevenueTier:"diamond"},
    {giftHostMicSecondsMonth:7200},
    {giftHostQualifiedDays:9},
  ]){
    await assertFails(updateDoc(ref,patch));
  }
});

test("new client user cannot pre-seed agency target or policy state",async()=>{
  const forbiddenFields=[
    {agencyPolicySnapshot:{targets:[{id:"hacked",thresholdCoins:1,salaryDiamonds:999999}]}},
    {agencyTargetMonth:"2026-09"},
    {agencyTargetProgressCoins:50000000},
    {agencySalaryPaidDiamonds:0},
    {agencyCurrentTargetId:"diamond"},
    {agencyNextTargetCoins:0},
    {agencyTargetUpdatedAt:new Date()},
  ];
  for(let index=0;index<forbiddenFields.length;index+=1){
    const userId="rules_target_forge_"+String(index);
    const userDb=phoneDbFor(userId);
    await assertFails(setDoc(doc(userDb,"users",userId),{
      role:"user",
      coins:0,
      diamonds:0,
      ...forbiddenFields[index],
    }));
  }
});

test("client cannot forge gift operations ledgers accrual activity or settlement",async()=>{
  const userDb=phoneUserDb();
  const writes=[
    ["gift_operations","fake_op"],
    ["gift_transactions","fake_tx"],
    ["financial_ledger","fake_ledger"],
    ["agency_settlement_accruals","fake_accrual"],
    ["agency_settlements","fake_settlement"],
    ["system_config","gift_economy"],
    ["game_operations","fake_game_op"],
    ["game_rounds","fake_game_round"],
    ["game_user_history","fake_game_history"],
  ];
  for(const [collection,id] of writes){
    await assertFails(setDoc(doc(userDb,collection,id),{forged:true}));
  }
  await assertFails(setDoc(
    doc(userDb,"host_mic_activity",uid,"days","2026-09-22"),
    {day:"2026-09-22",micSeconds:7200,qualified:true},
  ));
});


test("agency host reads own progress but not agency finance or policy",async()=>{
  const hostDb=phoneDbFor(agencyHostUid);
  await assertSucceeds(getDoc(doc(hostDb,"agencies",agencyId)));
  await assertSucceeds(getDoc(doc(
    hostDb,"agency_host_monthly",agencyId+"__2026-09__"+agencyHostUid,
  )));
  await assertFails(getDoc(doc(hostDb,"agency_wallets",agencyId)));
  await assertFails(getDoc(doc(hostDb,"agency_policy_overrides",agencyId)));
});

test("agency manager reads host state and manager slots but not finance or policy",async()=>{
  const managerDb=phoneDbFor(agencyManagerUid);
  await assertSucceeds(getDoc(doc(managerDb,"agency_manager_slots",agencyId)));
  await assertSucceeds(getDoc(doc(
    managerDb,"agency_host_monthly",agencyId+"__2026-09__"+agencyHostUid,
  )));
  await assertSucceeds(getDoc(doc(managerDb,"agency_status_events","rules_agency_event")));
  await assertFails(getDoc(doc(managerDb,"agency_wallets",agencyId)));
  await assertFails(getDoc(doc(managerDb,"agency_policy_overrides",agencyId)));
});

test("agency owner can read own agency finance and policy but cannot write server owned data",async()=>{
  const ownerDb=phoneDbFor(agencyOwnerUid);
  await assertSucceeds(getDoc(doc(ownerDb,"agency_wallets",agencyId)));
  await assertSucceeds(getDoc(doc(ownerDb,"agency_monthly_statements",agencyId+"__2026-09")));
  await assertSucceeds(getDoc(doc(ownerDb,"agency_policy_overrides",agencyId)));
  await assertFails(updateDoc(doc(ownerDb,"agency_wallets",agencyId),{diamonds:9999}));
  await assertFails(updateDoc(doc(ownerDb,"agency_policy_overrides",agencyId),{agencyShareBps:9000}));
  await assertFails(setDoc(doc(ownerDb,"agency_transfers","forged_transfer"),{
    agencyId,
    diamonds:9999,
    status:"completed",
  }));
  await assertFails(setDoc(doc(ownerDb,"financial_ledger","forged_agency_ledger"),{
    agencyId,
    asset:"diamonds",
    delta:9999,
  }));
});

test("agency outsider cannot read private agency data",async()=>{
  const outsiderDb=phoneDbFor(agencyOutsiderUid);
  await assertFails(getDoc(doc(outsiderDb,"agencies",agencyId)));
  await assertFails(getDoc(doc(
    outsiderDb,"agency_host_monthly",agencyId+"__2026-09__"+agencyHostUid,
  )));
  await assertFails(getDoc(doc(outsiderDb,"agency_wallets",agencyId)));
});

test("platform granular capabilities allow only their intended agency reads",async()=>{
  const adminDb=phoneDbFor(platformAgencyAdminUid);
  await assertSucceeds(getDoc(doc(adminDb,"agency_wallets",agencyId)));
  await assertSucceeds(getDoc(doc(
    adminDb,"agency_memberships",agencyId+"__"+agencyHostUid,
  )));
  await assertFails(getDoc(doc(adminDb,"agency_policy_overrides",agencyId)));
});

test("legacy C1 C2 agency settlement collections stay quarantined",async()=>{
  await env.withSecurityRulesDisabled(async context=>{
    await setDoc(doc(context.firestore(),"agency_settlements","legacy_rules"),{agencyId});
    await setDoc(doc(context.firestore(),"agency_settlement_accruals","legacy_rules"),{agencyId});
  });
  const ownerDb=phoneDbFor(agencyOwnerUid);
  await assertFails(getDoc(doc(ownerDb,"agency_settlements","legacy_rules")));
  await assertFails(getDoc(doc(ownerDb,"agency_settlement_accruals","legacy_rules")));
});

test("agency applicant can read own application but another regular user cannot",async()=>{
  const applicantDb=phoneUserDb();
  const otherDb=phoneDbFor(otherUid);
  await assertSucceeds(getDoc(doc(applicantDb,"agency_applications","rules_application")));
  await assertFails(getDoc(doc(otherDb,"agency_applications","rules_application")));
});

test("agency membership request is readable only by target user or agency management",async()=>{
  await env.withSecurityRulesDisabled(async context=>{
    await setDoc(doc(context.firestore(),"agency_membership_requests","rules_membership_request"),{
      requestId:"rules_membership_request",
      agencyId,
      uid,
      type:"invite",
      status:"pending",
      userConsent:false,
      agencyConsent:true,
      actorUid:agencyManagerUid,
      createdAt:new Date(),
      updatedAt:new Date(),
    });
  });
  const targetDb=phoneUserDb();
  const managerDb=phoneDbFor(agencyManagerUid);
  const outsiderDb=phoneDbFor(agencyOutsiderUid);
  await assertSucceeds(
    getDoc(doc(targetDb,"agency_membership_requests","rules_membership_request")),
  );
  await assertSucceeds(
    getDoc(doc(managerDb,"agency_membership_requests","rules_membership_request")),
  );
  await assertFails(
    getDoc(doc(outsiderDb,"agency_membership_requests","rules_membership_request")),
  );
});

test("client cannot forge active agency membership or agency counters",async()=>{
  const applicantDb=phoneUserDb();
  await assertFails(setDoc(doc(applicantDb,"agency_memberships",agencyId+"__"+uid),{
    agencyId,
    uid,
    role:"host",
    status:"active",
  }));
  await assertFails(setDoc(doc(applicantDb,"agency_user_memberships",uid),{
    agencyId,
    uid,
    role:"host",
    status:"active",
  }));
  await assertFails(updateDoc(doc(applicantDb,"agencies",agencyId),{
    memberCount:999,
    hostCount:999,
  }));
});

test("client cannot leave or remove agency membership by direct Firestore writes",async()=>{
  const hostDb=phoneDbFor(agencyHostUid);
  await assertFails(updateDoc(
    doc(hostDb,"agency_memberships",agencyId+"__"+agencyHostUid),
    {status:"left",leftAt:new Date()},
  ));
  await assertFails(deleteDoc(
    doc(hostDb,"agency_memberships",agencyId+"__"+agencyHostUid),
  ));
  await assertFails(updateDoc(
    doc(hostDb,"agency_user_memberships",agencyHostUid),
    {status:"left",leftAt:new Date()},
  ));
  await assertFails(deleteDoc(
    doc(hostDb,"agency_user_memberships",agencyHostUid),
  ));
  await assertFails(updateDoc(doc(hostDb,"users",agencyHostUid),{
    agencyId:"",
    agencyRole:"",
  }));
});

test("clients cannot directly forge agency manager roles or slots",async()=>{
  const ownerDb=phoneDbFor(agencyOwnerUid);
  const managerDb=phoneDbFor(agencyManagerUid);
  await assertFails(updateDoc(
    doc(ownerDb,"agency_memberships",agencyId+"__"+agencyHostUid),
    {role:"manager"},
  ));
  await assertFails(updateDoc(
    doc(ownerDb,"agency_user_memberships",agencyHostUid),
    {role:"manager"},
  ));
  await assertFails(updateDoc(
    doc(ownerDb,"agency_manager_slots",agencyId),
    {managerUids:[agencyHostUid]},
  ));
  await assertFails(updateDoc(
    doc(managerDb,"users",agencyManagerUid),
    {agencyRole:"senior_manager"},
  ));
});

test("client cannot forge agency application locks idempotency or creation registry",async()=>{
  const applicantDb=phoneUserDb();
  await assertFails(setDoc(doc(applicantDb,"agency_applications","forged_application"),{
    applicantUid:uid,
    name:"Forged",
    status:"pending",
  }));
  await assertFails(setDoc(doc(applicantDb,"agency_application_locks",uid),{
    applicationId:"forged_application",
    applicantUid:uid,
    status:"pending",
  }));
  await assertFails(setDoc(doc(applicantDb,"agency_application_operations","forged_operation"),{
    uid,
    action:"submitAgencyApplication",
    status:"completed",
  }));
  await assertFails(setDoc(doc(applicantDb,"agency_ids","699999"),{
    agencyId:"699999",
    ownerUid:uid,
  }));
  await assertFails(setDoc(doc(applicantDb,"agency_creation_operations","forged_creation"),{
    actorUid:uid,
    action:"directCreateAgency",
    status:"completed",
  }));
  await assertFails(setDoc(doc(applicantDb,"agency_review_operations","forged_review"),{
    actorUid:uid,
    action:"rejectAgencyApplication",
    status:"completed",
  }));
  await assertFails(setDoc(doc(applicantDb,"agency_manual_reapply_blocks","rules_application"),{
    applicationId:"rules_application",
    applicantUid:uid,
  }));
  await assertFails(setDoc(doc(applicantDb,"agency_membership_requests","forged_membership_request"),{
    agencyId,
    uid,
    type:"join",
    status:"pending",
  }));
  await assertFails(setDoc(doc(applicantDb,"agency_membership_request_keys","forged_key"),{
    requestId:"forged_membership_request",
    agencyId,
    uid,
  }));
  await assertFails(setDoc(doc(applicantDb,"agency_membership_request_operations","forged_membership_op"),{
    actorUid:uid,
    action:"requestJoin",
    status:"completed",
  }));
  await assertFails(setDoc(doc(applicantDb,"agency_membership_pending","forged_pending"),{
    requestId:"forged_membership_request",
    agencyId,
    uid,
  }));
  await assertFails(setDoc(doc(applicantDb,"agency_membership_acceptance_locks",uid),{
    requestId:"forged_membership_request",
    agencyId,
    uid,
    status:"accepted",
  }));
});

test("agency rejection notification is private to its applicant",async()=>{
  await env.withSecurityRulesDisabled(async context=>{
    await setDoc(doc(context.firestore(),"notifications","rules_agency_rejected"),{
      userId:uid,
      type:"agency_application_rejected",
      title:"تم رفض طلب إنشاء الوكالة",
      body:"سبب تجريبي",
      read:false,
      applicationId:"rules_application",
      createdAt:new Date(),
    });
  });
  const applicantDb=phoneUserDb();
  const otherDb=phoneDbFor(otherUid);
  await assertSucceeds(
    getDoc(doc(applicantDb,"notifications","rules_agency_rejected")),
  );
  await assertFails(
    getDoc(doc(otherDb,"notifications","rules_agency_rejected")),
  );
  await assertSucceeds(
    updateDoc(
      doc(applicantDb,"notifications","rules_agency_rejected"),
      {read:true},
    ),
  );
  await assertFails(
    updateDoc(
      doc(applicantDb,"notifications","rules_agency_rejected"),
      {body:"forged"},
    ),
  );
});

test("security assertions actually executed",()=>{
  assert.ok(env);
});
