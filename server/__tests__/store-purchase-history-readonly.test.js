import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {
  canViewStorePurchases,projectStorePurchaseReceipt,loadStoreUserPurchases,
  verifyStorePurchaseEvidenceForOwner,reviewStorePurchaseEvidenceBatchForOwner,
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
  assert.equal(result.needsReview,1);
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
  assert.equal(result.financialReportComplete,false);
});
