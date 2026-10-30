import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {
  canViewStorePurchases,projectStorePurchaseReceipt,loadStoreUserPurchases,
  verifyStorePurchaseEvidenceForOwner,reviewStorePurchaseEvidenceBatchForOwner,
  loadStoreUserFinancialEvidencePage,loadStoreFinancialSourcePageForOwner,
  loadStoreFinancialCoverageForOwner,
  loadStoreGlobalDailyPageForOwner,
  manageStorePurchases,
} from "../../cloudflare-worker/src/manage-store-purchases.js";
import {storeCatalogInternals} from "../../cloudflare-worker/src/manage-store-catalog.js";
import {manageUserAccessInternals} from "../../cloudflare-worker/src/manage-user-access.js";

const viewer={role:"admin",adminEnabled:true,capabilities:["viewStorePurchases"],
  accountStatus:"active"};
const token={sub:"auditor_1",auth_time:Math.floor(Date.now()/1000),
  iat:Math.floor(Date.now()/1000)};
const receipt={
  buyerUid:"buyer_1",operationId:"private_op_001",
  productId:"200001",nameAr:"إطار ملكي",category:"frames",
  priceCoins:14000,acquiredAtMs:100000,expiresAtMs:null,
  deliveryStatus:"delivered",refundStatus:"none",
  walletOpeningBalance:999999,privateEmail:"hidden@example.invalid",
};
function dbFor(user=viewer) {
  const reads=[];
  const docs=new Map([
    ["users/auditor_1",user],
    ["users/buyer_1",{role:"user",accountStatus:"active",publicId:"123456"}],
    ["public_ids/123456",{uid:"buyer_1"}],
    ["system_config/store_catalog",{revision:5,items:[
      {id:"200001",nameAr:"HIDDEN_ADMIN_DRAFT",enabled:false},
    ]}],
  ]);
  return {reads,docs,
    async get(path){
      reads.push(path);
      return {exists:docs.has(path),data:docs.get(path)};
    },
    async runQuery(path,params){
      reads.push({path,params});
      return [
        {data:receipt},
        {data:{...receipt,buyerUid:"unrelated_user"}},
      ];
    },
  };
}

test("purchase history requires independent Owner/admin permission",()=>{
  assert.equal(canViewStorePurchases({role:"owner"}),true);
  assert.equal(canViewStorePurchases(viewer),true);
  for(const actor of [
    {role:"admin",adminEnabled:true,capabilities:["manageStore"]},
    {role:"admin",adminEnabled:true,capabilities:["viewStore"]},
    {role:"admin",adminEnabled:true,capabilities:["viewStoreInventory"]},
    {role:"admin",adminEnabled:true,capabilities:["viewStoreAudit"]},
    {role:"moderator",adminEnabled:true,capabilities:["viewStorePurchases"]},
    {role:"user",adminEnabled:true,capabilities:["viewStorePurchases"]},
    {role:"admin",adminEnabled:false,capabilities:["viewStorePurchases"]},
  ]) assert.equal(canViewStorePurchases(actor),false);
});
test("receipt projection rejects other users and hides financial details",()=>{
  const safe=projectStorePurchaseReceipt(receipt,"buyer_1");
  assert.deepEqual(Object.keys(safe).sort(),[
    "productId","nameAr","category","priceCoins","acquiredAtMs",
    "expiresAtMs","deliveryStatus","refundStatus",
  ].sort());
  assert.ok(!JSON.stringify(safe).includes("private"));
  assert.ok(!JSON.stringify(safe).includes("999999"));
  assert.equal(projectStorePurchaseReceipt(receipt,"another_uid"),null);
  assert.equal(projectStorePurchaseReceipt({...receipt,priceCoins:-10},"buyer_1"),null);
  assert.equal(projectStorePurchaseReceipt({...receipt,productId:"../../x"},"buyer_1"),null);
  assert.equal(projectStorePurchaseReceipt({...receipt,expiresAtMs:2},"buyer_1"),null);
});
test("purchase history only reads one target by ID and bounded indexed receipts",async()=>{
  const db=dbFor();
  const result=await loadStoreUserPurchases(db,token,"١٢٣٤٥٦");
  assert.equal(result.ok,true);
  assert.equal(result.searchedId,"١٢٣٤٥٦");
  assert.equal(result.targetUid,"buyer_1");
  assert.equal(result.purchasingEnabled,false);
  assert.equal(result.receipts.length,1);
  assert.equal(result.receipts[0].productId,"200001");
  assert.equal(result.resultLimit,50);
  assert.equal(result.moreMayExist,false);
  assert.deepEqual(db.reads,[
    "users/auditor_1","public_ids/123456","users/buyer_1",
    {path:"store_purchase_receipts",params:{
      filters:[{field:"buyerUid",op:"==",value:"buyer_1"}],
      orderBy:[{field:"acquiredAtMs",direction:"desc"},
        {field:"__name__",direction:"desc"}],
      startAfter:[],limit:51,
    }},
  ]);
  const code=readFileSync(new URL(
    "../../cloudflare-worker/src/manage-store-purchases.js",import.meta.url),"utf8");
  assert.doesNotMatch(code,/db\.commit\(|db\.writeCreate\(|db\.writeUpdate\(|financial_ledger\//);
  assert.match(code,/Cache-Control":"no-store/);
});
test("inactive, unauthorized, stale and reassigned public IDs cannot view receipts",async()=>{
  for(const actor of [
    {role:"admin",adminEnabled:false,capabilities:["viewStorePurchases"]},
    {role:"user",adminEnabled:true,capabilities:["viewStorePurchases"]},
    {...viewer,accountStatus:"deleting"},
  ]) {
    const db=dbFor(actor);
    await assert.rejects(()=>loadStoreUserPurchases(db,token,"123456"));
    assert.deepEqual(db.reads,["users/auditor_1"]);
  }
  const stale=dbFor();
  await assert.rejects(()=>loadStoreUserPurchases(
    stale,{...token,auth_time:1},"123456"),/recent_auth_required/);
  assert.deepEqual(stale.reads,["users/auditor_1"]);
  const replaced=dbFor();
  replaced.docs.set("users/buyer_1",{publicId:"777777",accountStatus:"active"});
  await assert.rejects(()=>loadStoreUserPurchases(replaced,token,"123456"),
    /not_found/);
  assert.ok(!replaced.reads.some(x=>typeof x==="object"&&
    x.path==="store_purchase_receipts"));
});
test("purchase-only permission opens hub but never leaks hidden catalog or inventory",async()=>{
  const db=dbFor();
  const state=await storeCatalogInternals.loadState(db,token);
  assert.equal(state.canViewPurchases,true);
  assert.equal(state.canViewCatalog,false);
  assert.equal(state.canViewInventory,false);
  assert.equal(state.canViewAudit,false);
  assert.equal(state.canEdit,false);
  assert.equal(state.revision,0);
  assert.deepEqual(state.items,[]);
  assert.deepEqual(manageUserAccessInternals.normalizeCapabilities(
    ["viewStorePurchases","viewStore"]),["viewStore","viewStorePurchases"]);
  const control=readFileSync(new URL(
    "../../lib/admin/store_catalog_control_page.dart",import.meta.url),"utf8");
  assert.match(control,/if \(activeSection == 2\)/);
  assert.match(control,/StorePurchaseHistoryPanel\(/);
});
test("history handler disallows mutations and only accepts history action",async()=>{
  for (const method of ["GET","PUT","DELETE"]) {
    const response=await manageStorePurchases(
      new Request("https://example.com/api/manage-store-purchases",{method}),{});
    assert.equal(response.status,405);
    assert.equal((await response.json()).code,"method_not_allowed");
  }
  const code=readFileSync(new URL(
    "../../cloudflare-worker/src/index.js",import.meta.url),"utf8");
  assert.match(code,/url\.pathname === "\/api\/manage-store-purchases"/);
});

const evidenceOperationId="store_purchase_owner_review_0001";
function ownerEvidenceDb(){
  const owner={role:"owner",accountStatus:"active"};
  const db=dbFor(owner);
  const key="buyer_1__"+evidenceOperationId;
  const product="200001",price=14000,at=100000;
  db.docs.set("store_purchase_operations/"+key,{
    buyerUid:"buyer_1",productId:product,kind:"purchase",
    status:"completed",result:{
      operationId:evidenceOperationId,productId:product,priceCoins:price,
      durationDays:0,acquiredAtMs:at,expiresAtMs:null,
      deliveryStatus:"delivered",renewal:false,
    },
  });
  db.docs.set("store_purchase_receipts/"+key,{
    buyerUid:"buyer_1",operationId:evidenceOperationId,productId:product,
    priceCoins:price,durationDays:0,acquiredAtMs:at,
    expiresAtMs:null,deliveryStatus:"delivered",refundStatus:"none",
    renewal:false,privateCard:"NEVER_EXPOSE",
  });
  db.docs.set("financial_ledger/store_"+key,{
    userId:"buyer_1",asset:"coins",delta:-price,
    openingBalance:50000,closingBalance:36000,
    reason:"store_item_purchase",sourceType:"storePurchase",renewal:false,
    sourceId:key,idempotencyKey:key,privateWallet:"NEVER_EXPOSE",
  });
  db.docs.set("admin_audit_logs/store_purchase_"+key,{
    actorUid:"buyer_1",targetType:"store_entitlement",
    targetId:"user_store_entitlements/buyer_1/items/"+product,
    action:"purchaseStoreItem",operationId:evidenceOperationId,
    priceCoins:price,privateEmail:"NEVER_EXPOSE",
  });
  db.commit=()=>{throw Error("verification_must_not_write")};
  db.list=()=>{throw Error("verification_must_not_scan")};
  return db;
}

test("579E Owner-only history exposes verified operation keys but staff never sees keys",async()=>{
  const staff=dbFor();
  const regular=await loadStoreUserPurchases(staff,token,"123456");
  assert.equal(regular.canVerifyReceipts,false);
  assert.equal(regular.receipts[0].operationId,undefined);
  const owner=ownerEvidenceDb();
  const result=await loadStoreUserPurchases(owner,token,"123456");
  assert.equal(result.canVerifyReceipts,true);
  assert.equal(result.receipts[0].operationId,"private_op_001");
  assert.equal(result.receipts[0].privateEmail,undefined);
  const invalid=projectStorePurchaseReceipt(
    {...receipt,operationId:"../bad"},"buyer_1",true);
  assert.equal(invalid.operationId,undefined);
});

test("579E evidence inspection reuses four exact docs, no wallet totals or settlement",async()=>{
  const db=ownerEvidenceDb();
  const view=await verifyStorePurchaseEvidenceForOwner(
    db,token,"١٢٣٤٥٦",evidenceOperationId,"200001");
  assert.deepEqual(view,{
    ok:true,operationId:evidenceOperationId,verified:true,
    kind:"purchase",certifiedAmountCoins:14000,
  });
  assert.deepEqual(db.reads,[
    "users/auditor_1","public_ids/123456","users/buyer_1",
    "store_purchase_operations/buyer_1__"+evidenceOperationId,
    "store_purchase_receipts/buyer_1__"+evidenceOperationId,
    "financial_ledger/store_buyer_1__"+evidenceOperationId,
    "admin_audit_logs/store_purchase_buyer_1__"+evidenceOperationId,
  ]);
  assert.equal(JSON.stringify(view).includes("NEVER_EXPOSE"),false);
  assert.equal(db.reads.filter(row=>typeof row==="object").length,0);
});

test("581B only Owner with a recent live session can inspect financial evidence",async()=>{
  for(const actor of [
    viewer,{...viewer,capabilities:["manageStore","viewStoreAudit",
      "viewStorePurchases"]},
    {role:"admin",adminEnabled:true,capabilities:["viewStorePurchases"]},
    {role:"user",adminEnabled:true,capabilities:["viewStorePurchases"]},
    {role:"owner",accountStatus:"deleting"},
  ]){
    const db=dbFor(actor);
    await assert.rejects(()=>verifyStorePurchaseEvidenceForOwner(
      db,token,"123456",evidenceOperationId,"200001"),/forbidden|unauthorized/);
    assert.deepEqual(db.reads,["users/auditor_1"]);
  }
  const stale=ownerEvidenceDb();
  await assert.rejects(()=>verifyStorePurchaseEvidenceForOwner(
    stale,{...token,auth_time:1},"123456",evidenceOperationId,"200001"),
    /recent_auth_required/);
  assert.deepEqual(stale.reads,["users/auditor_1"]);
  const bad=ownerEvidenceDb();
  await assert.rejects(()=>verifyStorePurchaseEvidenceForOwner(
    bad,token,"123456","../bad","200001"),/invalid_store_purchase_operation_id/);
  assert.deepEqual(bad.reads,["users/auditor_1"]);
});

test("581B tampered, missing and refund-pending evidence is never certified",async()=>{
  for(const mutate of [
    db=>db.docs.delete("financial_ledger/store_buyer_1__"+evidenceOperationId),
    db=>db.docs.get("financial_ledger/store_buyer_1__"+
      evidenceOperationId).closingBalance=50000,
    db=>db.docs.get("store_purchase_receipts/buyer_1__"+
      evidenceOperationId).refundStatus="requested",
    db=>db.docs.get("admin_audit_logs/store_purchase_buyer_1__"+
      evidenceOperationId).actorUid="another_buyer",
  ]){
    const db=ownerEvidenceDb();
    mutate(db);
    const result=await verifyStorePurchaseEvidenceForOwner(
      db,token,"123456",evidenceOperationId,"200001");
    assert.equal(result.ok,true);
    assert.equal(result.verified,false);
    assert.ok(["incomplete_evidence","ledger_mismatch",
      "requires_refund_review","audit_mismatch"].includes(result.code));
    assert.equal(result.certifiedAmountCoins,undefined);
  }
  const wrongProduct=await verifyStorePurchaseEvidenceForOwner(
    ownerEvidenceDb(),token,"123456",evidenceOperationId,"200002");
  assert.deepEqual(wrongProduct,{
    ok:true,operationId:evidenceOperationId,verified:false,
    code:"operation_mismatch",
  });
  const notFound=await verifyStorePurchaseEvidenceForOwner(
    ownerEvidenceDb(),token,"123456","store_missing_operation_0001","200001");
  assert.deepEqual(notFound,{ok:true,verified:false,
    operationId:"store_missing_operation_0001",code:"not_found"});
});

test("579F ordered recent receipt query occurs before limit and keeps timestamp ties",async()=>{
  const db=dbFor({role:"owner",accountStatus:"active"});
  const queried=[];
  db.runQuery=async(path,params)=>{
    queried.push({path,params});
    return Array.from({length:51},(_,i)=>({
      id:"buyer_1__store_purchase_"+String(10000+i).padStart(12,"0"),
      data:{...receipt,operationId:"store_purchase_"+String(10000+i).padStart(12,"0"),
        acquiredAtMs:100000-Math.floor(i/2)},
    }));
  };
  const first=await loadStoreUserPurchases(db,token,"123456");
  assert.equal(first.receipts.length,50);
  assert.equal(first.moreMayExist,true);
  assert.equal(first.hasNextPage,true);
  assert.ok(first.nextCursor);
  assert.equal(queried[0].params.limit,51);
  assert.deepEqual(queried[0].params.orderBy,[
    {field:"acquiredAtMs",direction:"desc"},
    {field:"__name__",direction:"desc"},
  ]);
  await loadStoreUserPurchases(db,token,"123456",first.nextCursor);
  assert.equal(queried[1].params.startAfter[0],100000-Math.floor(49/2));
  assert.match(queried[1].params.startAfter[1].referencePath,
    /^store_purchase_receipts\/buyer_1__store_purchase_/);
  await assert.rejects(
    ()=>loadStoreUserPurchases(db,token,"123456",
      btoa(JSON.stringify({uid:"victim",at:100000,id:"victim__store_purchase_000000000001"}))),
    /invalid_store_receipt_cursor/);
  assert.equal(queried.length,2);
});
test("579F invalid and absent receipt dates are not mistaken for financial totals",async()=>{
  const db=dbFor();
  db.runQuery=async()=>[
    {id:"buyer_1__store_purchase_000000000001",data:{...receipt,acquiredAtMs:200}},
    {id:"buyer_1__store_purchase_000000000002",data:{...receipt,acquiredAtMs:-1}},
  ];
  const result=await loadStoreUserPurchases(db,token,"123456");
  assert.equal(result.receipts.length,1);
  assert.equal(result.hasNextPage,false);
  assert.ok(!("totalRevenue" in result));
  assert.ok(!("netCoins" in result));
});

test("579F delegated staff never receive an encoded operation-ID page cursor",async()=>{
  const db=dbFor();
  db.runQuery=async()=>Array.from({length:51},(_,i)=>({
    id:"buyer_1__store_purchase_"+String(10000+i).padStart(12,"0"),
    data:{...receipt,acquiredAtMs:100000-i},
  }));
  const result=await loadStoreUserPurchases(db,token,"123456");
  assert.equal(result.receipts.length,50);
  assert.equal(result.moreMayExist,true);
  assert.equal(result.hasNextPage,false);
  assert.equal(result.nextCursor,null);
  assert.ok(result.receipts.every(row=>!("operationId" in row)));
});

test("602 Owner can certify at most five selected operations without financial totals",async()=>{
  const db=ownerEvidenceDb();
  const result=await reviewStorePurchaseEvidenceBatchForOwner(
    db,token,"123456",[
      {operationId:evidenceOperationId,productId:"200001"},
      {operationId:"store_missing_operation_0002",productId:"200001"},
    ]);
  assert.equal(result.ok,true);
  assert.equal(result.scope,"selected_operations_only");
  assert.equal(result.inspected,2);
  assert.equal(result.verified,1);
  assert.equal(result.verifiedPurchases,1);
  assert.equal(result.verifiedRenewals,0);
  assert.equal(result.needsReview,1);
  assert.equal(result.incompleteEvidence,1);
  assert.equal(result.requiresRefundReview,0);
  assert.equal(result.conflictingEvidence,0);
  assert.equal(result.financialReportComplete,false);
  assert.equal(result.netRevenueCertified,false);
  assert.deepEqual(result.evidence[0],{
    operationId:evidenceOperationId,verified:true,
    kind:"purchase",certifiedAmountCoins:14000,
  });
  assert.equal(result.evidence[1].verified,false);
  assert.equal(result.evidence[1].code,"not_found");
  assert.equal(db.reads.length,11); // actor + target registry/user + 2x4
  assert.ok(!db.reads.some(x=>typeof x==="object"));
  const serial=JSON.stringify(result);
  for(const secret of ["NEVER_EXPOSE","closingBalance","openingBalance",
    "netCoins","totalRevenue","buyer_1"])
    assert.ok(!serial.includes(secret),secret);
});

test("602 selected-review permissions, duplicate IDs and request caps fail closed",async()=>{
  for(const user of [
    viewer,
    {...viewer,capabilities:["viewStorePurchases","viewStoreAudit"]},
  ]){
    const db=dbFor(user);
    await assert.rejects(
      ()=>reviewStorePurchaseEvidenceBatchForOwner(db,token,"123456",[
        {operationId:evidenceOperationId,productId:"200001"},
      ]),/forbidden/);
    assert.deepEqual(db.reads,["users/auditor_1"]);
  }
  const stale=ownerEvidenceDb();
  await assert.rejects(
    ()=>reviewStorePurchaseEvidenceBatchForOwner(stale,
      {...token,auth_time:1},"123456",[
        {operationId:evidenceOperationId,productId:"200001"},
      ]),/recent_auth_required/);
  const sample={operationId:evidenceOperationId,productId:"200001"};
  for(const selected of [
    [],Array(6).fill(sample),[sample,sample],
    [{operationId:"../other",productId:"200001"}],
    [{operationId:evidenceOperationId,productId:"../../hidden"}],
  ]){
    const db=ownerEvidenceDb();
    await assert.rejects(
      ()=>reviewStorePurchaseEvidenceBatchForOwner(db,token,"123456",selected),
      /invalid_store_review_selection|invalid_store_purchase_operation_id/);
    assert.deepEqual(db.reads,["users/auditor_1"]);
  }
});

test("602 refund pending in selected evidence stays nonreportable and read-only",async()=>{
  const db=ownerEvidenceDb();
  db.docs.get("store_purchase_receipts/buyer_1__"+evidenceOperationId)
    .refundStatus="requested";
  const result=await reviewStorePurchaseEvidenceBatchForOwner(
    db,token,"123456",[{operationId:evidenceOperationId,
      productId:"200001"}]);
  assert.equal(result.verified,0);
  assert.equal(result.needsReview,1);
  assert.equal(result.evidence[0].code,"requires_refund_review");
  assert.equal(result.requiresRefundReview,1);
  assert.equal(result.financialReportComplete,false);
});

test("602 Owner review rejects absent renewal expiry proof before any certified amount",async()=>{
  const db=ownerEvidenceDb();
  const key="buyer_1__"+evidenceOperationId;
  const op=db.docs.get("store_purchase_operations/"+key);
  const receipt=db.docs.get("store_purchase_receipts/"+key);
  const ledger=db.docs.get("financial_ledger/store_"+key);
  const audit=db.docs.get("admin_audit_logs/store_purchase_"+key);
  op.kind="renew";
  Object.assign(op.result,{
    renewal:true,durationDays:7,expiresAtMs:100000+14*86400000,
    previousExpiresAtMs:100000+7*86400000,
  });
  Object.assign(receipt,{
    renewal:true,durationDays:7,acquiredAtMs:100100,
    expiresAtMs:op.result.expiresAtMs,
    previousExpiresAtMs:op.result.previousExpiresAtMs,
  });
  ledger.renewal=true;
  audit.action="renewStoreItem";
  const good=await reviewStorePurchaseEvidenceBatchForOwner(
    db,token,"123456",[{operationId:evidenceOperationId,
      productId:"200001"}]);
  assert.equal(good.verified,1);
  assert.equal(good.verifiedRenewals,1);
  assert.equal(good.evidence[0].kind,"renew");
  delete op.result.previousExpiresAtMs;
  delete receipt.previousExpiresAtMs;
  const bad=await reviewStorePurchaseEvidenceBatchForOwner(
    db,token,"123456",[{operationId:evidenceOperationId,
      productId:"200001"}]);
  assert.equal(bad.verified,0);
  assert.equal(bad.conflictingEvidence,1);
  assert.equal(bad.evidence[0].code,"operation_mismatch");
  assert.equal(bad.evidence[0].certifiedAmountCoins,undefined);
});

test("602 staff cannot submit a guessed receipt cursor or invoke batch review",async()=>{
  const db=dbFor();
  const cursor=btoa(JSON.stringify({uid:"buyer_1",at:100000,
    id:"buyer_1__store_purchase_000000000001"}));
  await assert.rejects(
    ()=>loadStoreUserPurchases(db,token,"123456",cursor),/forbidden/);
  assert.deepEqual(db.reads,["users/auditor_1"]);
  const review=dbFor();
  await assert.rejects(
    ()=>reviewStorePurchaseEvidenceBatchForOwner(review,token,"123456",[
      {operationId:evidenceOperationId,productId:"200001"},
    ]),/forbidden/);
  assert.deepEqual(review.reads,["users/auditor_1"]);
});

test("603 Owner financial evidence page verifies exact matching receipts only",async()=>{
  const db=ownerEvidenceDb();
  const key=evidenceOperationId;
  const docId="buyer_1__"+key;
  const data={...db.docs.get("store_purchase_receipts/"+docId),
    nameAr:"إطار ملكي",category:"frames"};
  db.runQuery=async(path,params)=>{
    db.reads.push({path,params});
    return [{id:docId,data}];
  };
  const report=await loadStoreUserFinancialEvidencePage(
    db,token,"123456");
  assert.equal(report.scope,"one_buyer_one_page");
  assert.equal(report.inspected,1);
  assert.equal(report.verified,1);
  assert.equal(report.needsReview,0);
  assert.equal(report.verifiedPurchases,1);
  assert.equal(report.verifiedRenewals,0);
  assert.equal(report.verifiedPurchaseCoins,14000);
  assert.equal(report.verifiedRenewalCoins,0);
  assert.equal(report.refundReview,0);
  assert.equal(report.hasMore,false);
  assert.equal(report.nextCursor,null);
  assert.equal(report.financialReportComplete,false);
  assert.equal(report.netRevenueCertified,false);
  assert.equal(report.refundSettlementCertified,false);
  assert.equal(report.partialEvidenceOnly,true);
  assert.equal(report.evidence[0].operationId,key);
  assert.equal(JSON.stringify(report).includes("NEVER_EXPOSE"),false);
  const query=db.reads.find(x=>typeof x==="object");
  assert.equal(query.path,"store_purchase_receipts");
  assert.deepEqual(query.params.filters,[
    {field:"buyerUid",op:"==",value:"buyer_1"},
  ]);
  assert.deepEqual(query.params.orderBy,[
    {field:"acquiredAtMs",direction:"desc"},
    {field:"__name__",direction:"desc"},
  ]);
  assert.equal(query.params.limit,11);
  assert.equal(db.reads.length,8); // Owner, target registry/user, query + four docs.
});

test("603 refunded, corrupted and missing receipts cannot inflate verified Coins",async()=>{
  const db=ownerEvidenceDb();
  const key=evidenceOperationId;
  const path="store_purchase_receipts/buyer_1__"+key;
  const receipt=db.docs.get(path);
  const clean={...receipt};
  db.runQuery=async(pathName,params)=>{
    db.reads.push({path:pathName,params});
    return [
      {id:"buyer_1__"+key,data:{...receipt,refundStatus:"requested"}},
      {id:"buyer_1__store_malformed_0000000001",
        data:{...clean,operationId:"../bad"}},
      {id:"buyer_1__store_missing_op_0000001",
        data:{...clean,operationId:"store_missing_op_0000001"}},
    ];
  };
  const report=await loadStoreUserFinancialEvidencePage(
    db,token,"123456");
  assert.equal(report.verified,0);
  assert.equal(report.needsReview,3);
  assert.equal(report.verifiedPurchaseCoins,0);
  assert.equal(report.verifiedRenewalCoins,0);
  assert.equal(report.refundReview,1);
  assert.equal(report.evidence[0].code,"requires_refund_review");
  assert.equal(report.evidence[1].code,"invalid_receipt_identity");
  assert.equal(report.evidence[2].code,"not_found");
  assert.equal(report.financialReportComplete,false);
});

test("603 Owner finance report cursor, page cap and permissions stay isolated",async()=>{
  const db=ownerEvidenceDb();
  const key=evidenceOperationId;
  const row=db.docs.get("store_purchase_receipts/buyer_1__"+key);
  db.runQuery=async(path,params)=>{
    db.reads.push({path,params});
    return Array.from({length:11},(_,i)=>({
      id:"buyer_1__"+key,
      data:{...row,acquiredAtMs:100000-i},
    }));
  };
  const first=await loadStoreUserFinancialEvidencePage(
    db,token,"123456");
  assert.equal(first.inspected,10);
  assert.equal(first.hasMore,true);
  assert.equal(first.paginationBlocked,false);
  assert.ok(first.nextCursor);
  const next=await loadStoreUserFinancialEvidencePage(
    db,token,"123456",first.nextCursor);
  const query=db.reads.filter(x=>typeof x==="object");
  assert.equal(query.length,2);
  assert.equal(query[1].params.startAfter[0],99991);
  assert.equal(next.pageLimit,10);
  await assert.rejects(
    ()=>loadStoreUserFinancialEvidencePage(db,token,"123456",
      btoa(JSON.stringify({uid:"another",at:100000,
        id:"another__"+key}))),/invalid_store_receipt_cursor/);
  assert.equal(db.reads.filter(x=>typeof x==="object").length,2);
  const staff=dbFor(viewer);
  await assert.rejects(()=>loadStoreUserFinancialEvidencePage(
    staff,token,"123456"),/forbidden/);
  assert.deepEqual(staff.reads,["users/auditor_1"]);
  const stale=ownerEvidenceDb();
  await assert.rejects(()=>loadStoreUserFinancialEvidencePage(
    stale,{...token,auth_time:1},"123456"),/recent_auth_required/);
  assert.deepEqual(stale.reads,["users/auditor_1"]);
});

test("603 financial evidence page never drops malformed last receipt into a silent end",async()=>{
  const db=ownerEvidenceDb();
  db.runQuery=async()=>Array.from({length:11},(_,i)=>({
    id:i===9?null:"buyer_1__store_missing_op_0000001",
    data:{buyerUid:"buyer_1",operationId:"store_missing_op_0000001",
      productId:"200001",acquiredAtMs:100000-i},
  }));
  const report=await loadStoreUserFinancialEvidencePage(db,token,"123456");
  assert.equal(report.hasMore,true);
  assert.equal(report.nextCursor,null);
  assert.equal(report.paginationBlocked,true);
  assert.equal(report.financialReportComplete,false);
});

test("604 Owner reconciles independent operation, ledger and audit sources",async()=>{
  const docs={
    operations:"store_purchase_operations/buyer_1__"+evidenceOperationId,
    ledger:"financial_ledger/store_buyer_1__"+evidenceOperationId,
    audit:"admin_audit_logs/store_purchase_buyer_1__"+evidenceOperationId,
  };
  for(const source of ["operations","ledger","audit"]){
    const db=ownerEvidenceDb();
    const fullPath=docs[source];
    db.runQuery=async(path,params)=>{
      db.reads.push({path,params});
      assert.equal(path,fullPath.split("/")[0]);
      assert.equal(params.limit,11);
      assert.deepEqual(params.orderBy,
        [{field:"__name__",direction:"desc"}]);
      assert.equal(params.startAfter.length,0);
      assert.equal(params.filters[0].value,"buyer_1");
      if(source==="ledger")
        assert.deepEqual(params.filters[1],{
          field:"sourceType",op:"==",value:"storePurchase",
        });
      if(source==="audit")
        assert.deepEqual(params.filters[1],{
          field:"action",op:"in",
          value:["purchaseStoreItem","renewStoreItem"],
        });
      return [{id:fullPath.split("/")[1],
        data:{...db.docs.get(fullPath)}}];
    };
    const output=await loadStoreFinancialSourcePageForOwner(
      db,token,"123456",source);
    assert.equal(output.ok,true);
    assert.equal(output.scope,"one_buyer_source_page");
    assert.equal(output.source,source);
    assert.equal(output.searchedId,"123456");
    assert.equal(output.inspected,1);
    assert.equal(output.verified,1);
    assert.equal(output.needsReview,0);
    assert.equal(output.verifiedPurchaseCoins,14000);
    assert.equal(output.verifiedRenewalCoins,0);
    assert.equal(output.orphanOrConflicting,0);
    assert.equal(output.hasMore,false);
    assert.equal(output.financialReportComplete,false);
    assert.equal(output.netRevenueCertified,false);
    assert.equal(output.refundSettlementCertified,false);
    assert.deepEqual(output.evidence,[{
      operationId:evidenceOperationId,verified:true,
      kind:"purchase",certifiedAmountCoins:14000,
    }]);
    assert.equal(db.reads.length,8);
    const publicData=JSON.stringify(output);
    for(const secret of ["NEVER_EXPOSE","privateWallet","privateEmail",
      "openingBalance","closingBalance"])
      assert.equal(publicData.includes(secret),false);
  }
});

test("604 source-side orphan and independently refunded receipt cannot earn Coins",async()=>{
  for(const source of ["operations","ledger","audit"]){
    for(const mutator of [
      db=>db.docs.delete("store_purchase_receipts/buyer_1__"+evidenceOperationId),
      db=>{db.docs.get("store_purchase_receipts/buyer_1__"+
        evidenceOperationId).refundStatus="refunded";},
    ]){
      const db=ownerEvidenceDb();
      const suffix=source==="operations"?"buyer_1__":
        source==="ledger"?"store_buyer_1__":"store_purchase_buyer_1__";
      const path=(source==="operations"?"store_purchase_operations":
        source==="ledger"?"financial_ledger":"admin_audit_logs")+
        "/"+suffix+evidenceOperationId;
      const snapshot={...db.docs.get(path)};
      mutator(db);
      db.runQuery=async(path,params)=>[{id:suffix+evidenceOperationId,
        data:snapshot}];
      const report=await loadStoreFinancialSourcePageForOwner(
        db,token,"123456",source);
      assert.equal(report.verified,0);
      assert.equal(report.needsReview,1);
      assert.equal(report.verifiedPurchaseCoins,0);
      assert.equal(report.orphanOrConflicting,1);
      assert.ok(["incomplete_evidence","requires_refund_review"]
        .includes(report.evidence[0].code));
      assert.equal(report.financialReportComplete,false);
    }
  }
});

test("604 source pages fail closed on stale source state and malformed identity",async()=>{
  for(const source of ["operations","ledger","audit"]){
    const db=ownerEvidenceDb();
    const prefix=source==="operations"?"buyer_1__":
      source==="ledger"?"store_buyer_1__":"store_purchase_buyer_1__";
    const collection=source==="operations"?"store_purchase_operations":
      source==="ledger"?"financial_ledger":"admin_audit_logs";
    const data={...db.docs.get(collection+"/"+prefix+evidenceOperationId)};
    if(source==="operations")data.result={...data.result,priceCoins:777};
    if(source==="ledger")data.delta=-777;
    if(source==="audit")data.priceCoins=777;
    db.runQuery=async()=>[
      {id:prefix+evidenceOperationId,data},
      {id:"../bad",data},
      {id:prefix+evidenceOperationId,data},
    ];
    const report=await loadStoreFinancialSourcePageForOwner(
      db,token,"123456",source);
    assert.equal(report.verified,0);
    assert.equal(report.needsReview,3);
    assert.equal(report.verifiedPurchaseCoins,0);
    assert.equal(report.evidence[0].code,"conflicting_source_snapshot");
    assert.equal(report.evidence[1].code,"invalid_or_duplicate_source_key");
    assert.equal(report.evidence[2].code,"invalid_or_duplicate_source_key");
  }
});

test("604 Owner source cursor is bound to exact account and source",async()=>{
  const source="ledger",db=ownerEvidenceDb();
  const prefix="store_buyer_1__";
  const key=evidenceOperationId;
  const data=db.docs.get("financial_ledger/"+prefix+key);
  let page=0;
  db.runQuery=async(path,params)=>{
    db.reads.push({path,params});
    page++;
    if(page===1)return Array.from({length:11},(_,i)=>({
      id:prefix+key+"_"+String(i).padStart(2,"0"),
      data:{...data,sourceId:"buyer_1__"+key},
    }));
    return [];
  };
  const report=await loadStoreFinancialSourcePageForOwner(
    db,token,"123456",source);
  assert.equal(report.pageLimit,10);
  assert.equal(report.hasMore,true);
  assert.ok(report.nextCursor);
  const next=await loadStoreFinancialSourcePageForOwner(
    db,token,"123456",source,report.nextCursor);
  assert.equal(next.inspected,0);
  assert.deepEqual(db.reads.filter(x=>typeof x==="object")[1]
    .params.startAfter,[{
      referencePath:"financial_ledger/"+
        prefix+key+"_09",
    }]);
  await assert.rejects(()=>loadStoreFinancialSourcePageForOwner(
    db,token,"123456","audit",report.nextCursor),
    /invalid_store_financial_source_cursor/);
  await assert.rejects(()=>loadStoreFinancialSourcePageForOwner(
    db,token,"another_user","ledger",report.nextCursor),
    /not_found/);
  const staff=dbFor();
  await assert.rejects(()=>loadStoreFinancialSourcePageForOwner(
    staff,token,"123456","ledger"),/forbidden/);
  assert.deepEqual(staff.reads,["users/auditor_1"]);
  const stale=ownerEvidenceDb();
  await assert.rejects(()=>loadStoreFinancialSourcePageForOwner(
    stale,{...token,auth_time:1},"123456","ledger"),
    /recent_auth_required/);
  assert.deepEqual(stale.reads,["users/auditor_1"]);
});

test("604 malformed source page cannot falsely claim the next page was audited",async()=>{
  const db=ownerEvidenceDb();
  db.runQuery=async()=>Array.from({length:11},(_,i)=>({
    id:i===9?null:"buyer_1__"+evidenceOperationId+"_"+i,
    data:{buyerUid:"buyer_1"},
  }));
  const report=await loadStoreFinancialSourcePageForOwner(
    db,token,"123456","operations");
  assert.equal(report.hasMore,true);
  assert.equal(report.paginationBlocked,true);
  assert.equal(report.nextCursor,null);
  assert.equal(report.financialReportComplete,false);
});

test("605 one-buyer Store source coverage is Owner/recent-auth guarded",async()=>{
  const db=ownerEvidenceDb();
  let counts=0;
  db.readStoreFinancialCoverageCounts=async(uid)=>{
    counts++;
    assert.equal(uid,"buyer_1");
    return {ok:true,scope:"one_buyer_indexed_counts",
      counts:{receipts:1,operations:1,ledger:1,audit:1},
      countCap:501,cappedSources:[],
      cardinalitiesComparable:true,sourceCountsEqual:true,
      countMismatch:false,recordsIndividuallyReconciled:false,
      partialEvidenceOnly:true,financialReportComplete:false,
      netRevenueCertified:false,refundSettlementCertified:false};
  };
  const result=await loadStoreFinancialCoverageForOwner(db,token,"123456");
  assert.equal(result.ok,true);
  assert.equal(result.searchedId,"123456");
  assert.equal(result.countMismatch,false);
  assert.equal(result.recordsIndividuallyReconciled,false);
  assert.equal(result.financialReportComplete,false);
  assert.equal(result.netRevenueCertified,false);
  assert.equal(counts,1);
  assert.deepEqual(db.reads,[
    "users/auditor_1","public_ids/123456","users/buyer_1",
  ]);
  for(const actor of [viewer,{role:"user",accountStatus:"active"},
    {role:"admin",adminEnabled:true,capabilities:["viewStorePurchases"]}]){
    const staff=dbFor(actor);
    staff.readStoreFinancialCoverageCounts=async()=>{
      throw Error("delegated_source_counts_must_not_run");
    };
    await assert.rejects(()=>
      loadStoreFinancialCoverageForOwner(staff,token,"123456"),/forbidden/);
    assert.deepEqual(staff.reads,["users/auditor_1"]);
  }
  const stale=ownerEvidenceDb();
  stale.readStoreFinancialCoverageCounts=async()=>{
    throw Error("stale_source_counts_must_not_run");
  };
  await assert.rejects(()=>loadStoreFinancialCoverageForOwner(
    stale,{...token,auth_time:1},"123456"),/recent_auth_required/);
  assert.deepEqual(stale.reads,["users/auditor_1"]);
  assert.equal(db.commit instanceof Function,true);
  assert.equal(db.list instanceof Function,true);
});

test("606 all-buyer UTC daily finances require exact Owner and recent auth",async()=>{
  const yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10);
  const db=ownerEvidenceDb();
  db.runQuery=async(path,query)=>{
    db.reads.push({path,query});
    assert.equal(path,"store_purchase_operations");
    assert.equal(query.limit,11);
    assert.equal(query.filters.length,2);
    assert.deepEqual(query.orderBy,[
      {field:"createdAt",direction:"desc"},
      {field:"__name__",direction:"desc"},
    ]);
    return [];
  };
  const report=await loadStoreGlobalDailyPageForOwner(
    db,token,yesterday,"operations");
  assert.equal(report.ok,true);
  assert.equal(report.scope,"all_buyers_one_day_one_source_page");
  assert.equal(report.inspected,0);
  assert.equal(report.missingDateFieldsNotCovered,true);
  assert.equal(report.financialReportComplete,false);
  assert.equal(report.sourceCompletenessCertified,false);
  assert.deepEqual(db.reads.map(x=>typeof x==="string"?x:x.path),[
    "users/auditor_1",undefined,
  ]);
  for(const actor of [viewer,{role:"admin",adminEnabled:true,
    capabilities:["viewStorePurchases","viewStoreAudit"]}]){
    const notOwner=dbFor(actor);
    notOwner.runQuery=async()=>{throw Error("forbidden_must_not_query")};
    await assert.rejects(()=>loadStoreGlobalDailyPageForOwner(
      notOwner,token,yesterday,"operations"),/forbidden/);
    assert.deepEqual(notOwner.reads,["users/auditor_1"]);
  }
  const stale=ownerEvidenceDb();
  stale.runQuery=async()=>{throw Error("stale_must_not_query")};
  await assert.rejects(()=>loadStoreGlobalDailyPageForOwner(
    stale,{...token,auth_time:1},yesterday,"operations"),
    /recent_auth_required/);
  assert.deepEqual(stale.reads,["users/auditor_1"]);
});
