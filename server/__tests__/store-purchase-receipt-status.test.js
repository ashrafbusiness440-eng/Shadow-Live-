import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import {lookupOwnStorePurchaseReceipt,storePurchaseReceiptStatus}
  from "../../cloudflare-worker/src/store-purchase-receipt-status.js";

const uid="buyer_1",productId="200001",operationId="store_purchase_recovery_001";
const token={sub:uid,iat:Math.floor(Date.now()/1000)};
const body={action:"status",productId,operationId};
const key=uid+"__"+operationId;
const result={operationId,productId,priceCoins:25000,
  durationDays:7,acquiredAtMs:100000,expiresAtMs:100000+7*86400000,
  deliveryStatus:"delivered"};
function setup(){
  const docs=new Map([
    ["users/"+uid,{accountStatus:"active"}],
    ["store_purchase_operations/"+key,{
      buyerUid:uid,productId,status:"completed",result,
      privateActor:"DO_NOT_LEAK",
    }],
    ["store_purchase_receipts/"+key,{
      buyerUid:uid,operationId,productId,
      priceCoins:25000,durationDays:7,
      acquiredAtMs:100000,expiresAtMs:100000+7*86400000,
      deliveryStatus:"delivered",privateLedger:"DO_NOT_LEAK",
    }],
  ]);
  const reads=[];
  const db={
    async get(path){reads.push(path);
      return {exists:docs.has(path),data:docs.get(path)};
    },
    async commit(){throw Error("READ_ONLY_MUST_NOT_COMMIT");},
    writeUpdate(){throw Error("READ_ONLY_MUST_NOT_WRITE");},
    writeCreate(){throw Error("READ_ONLY_MUST_NOT_CREATE");},
    async list(){throw Error("NO_COLLECTION_SCAN");},
  };
  return {db,docs,reads};
}

test("buyer can recover exact durable receipt with no balance, UID or audit data",async()=>{
  const {db,reads}=setup();
  const view=await lookupOwnStorePurchaseReceipt(db,token,body);
  assert.deepEqual(view,{
    ok:true,found:true,operationId,productId,priceCoins:25000,
    durationDays:7,acquiredAtMs:100000,
    expiresAtMs:100000+7*86400000,
    deliveryStatus:"delivered",duplicate:true,
  });
  assert.deepEqual(reads,[
    "users/"+uid,"store_purchase_operations/"+key,
    "store_purchase_receipts/"+key,
  ]);
  assert.ok(!JSON.stringify(view).includes("buyer_1"));
  assert.ok(!JSON.stringify(view).includes("DO_NOT_LEAK"));
});

test("no operation is reported as not found, never assumed delivered",async()=>{
  const {db,docs}=setup();
  docs.delete("store_purchase_operations/"+key);
  docs.delete("store_purchase_receipts/"+key);
  assert.deepEqual(await lookupOwnStorePurchaseReceipt(db,token,body),
    {ok:true,found:false});
});

test("receipt recovery fails closed for partial, forged or conflicting records",async()=>{
  for(const mutate of [
    docs=>docs.delete("store_purchase_receipts/"+key),
    docs=>{docs.get("store_purchase_operations/"+key).result={...result,
      priceCoins:10};},
    docs=>{docs.get("store_purchase_receipts/"+key).deliveryStatus="failed";},
    docs=>{docs.get("store_purchase_operations/"+key).buyerUid="victim";},
    docs=>{docs.get("store_purchase_receipts/"+key).buyerUid="victim";},
    docs=>{docs.get("store_purchase_operations/"+key).status="pending";},
  ]){
    const {db,docs}=setup();
    mutate(docs);
    await assert.rejects(()=>lookupOwnStorePurchaseReceipt(db,token,body),
      /store_purchase_receipt_inconsistent|store_purchase_receipt_mismatch/);
  }
  const {db}=setup();
  await assert.rejects(()=>lookupOwnStorePurchaseReceipt(db,token,{
    ...body,productId:"200002",
  }),/store_purchase_receipt_mismatch/);
});

test("receipt lookup enforces verified buyer session and refuses deleting accounts",async()=>{
  for(const state of [
    {accountStatus:"deleting"},
    {deletionRequestedAt:1},{authDeleted:true},{deletionProcessing:true},
    {deletedAt:1},
  ]){
    const {db,docs,reads}=setup();
    Object.assign(docs.get("users/"+uid),state);
    await assert.rejects(()=>lookupOwnStorePurchaseReceipt(db,token,body),
      /unauthorized|store_buyer_not_eligible/);
    assert.deepEqual(reads,["users/"+uid]);
  }
  const {db,reads}=setup();
  await assert.rejects(()=>lookupOwnStorePurchaseReceipt(db,{
    ...token,sub:"victim",
  },body),/unauthorized/);
  assert.deepEqual(reads,["users/victim"]);
});

test("the recovery API does not depend on purchase release and performs no writes",async()=>{
  const response=await storePurchaseReceiptStatus(new Request(
    "https://example.com/api/store-purchase-status",{method:"GET"}),{});
  assert.equal(response.status,405);
  const handler=readFileSync(new URL(
    "../../cloudflare-worker/src/store-purchase-receipt-status.js",
    import.meta.url),"utf8");
  const routes=readFileSync(new URL(
    "../../cloudflare-worker/src/index.js",import.meta.url),"utf8");
  assert.match(routes,/url\.pathname === "\/api\/store-purchase-status"/);
  assert.match(handler,/store_purchase_operations\//);
  assert.match(handler,/store_purchase_receipts\//);
  assert.doesNotMatch(handler,/STORE_PURCHASE_ISSUANCE_ENABLED|db\.commit\(|db\.writeUpdate\(|db\.list\(/);
});
