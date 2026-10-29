import assert from "node:assert/strict";
import {test} from "node:test";
import {commitStorePurchaseOffline}
  from "../../cloudflare-worker/src/store-purchase-transaction.js";

// Optimistic serializable model: a commit aborts if any read record changed.
// Unlike a single-threaded fake DB, this tests competing checkout requests
// and the production engine's ABORTED retry path without spending real Coins.
function serializableFixture({coins=40000}={}){
  const catalogItems=["200001","200002"].map((id,index)=>({
    id,nameAr:index?"إطار ثاني":"إطار أول",
    category:"frames",priceCoins:25000,durationDays:7,
    rarity:"normal",minVipLevel:1,enabled:true,
    sortOrder:index+1,assetKey:`store.item.${id}.icon`,
  }));
  const records=new Map([
    ["users/buyer_1",{coins,accountStatus:"active",role:"user",
      wealthPoints:0,effectiveVipLevel:2}],
    ["system_config/store_catalog",{
      purchasingEnabled:true,revision:1,items:catalogItems,
    }],
    ["app_asset_registry/store.item.200001.icon",{
      published:true,rawUrl:"https://example.com/one.webp",
    }],
    ["app_asset_registry/store.item.200002.icon",{
      published:true,rawUrl:"https://example.com/two.webp",
    }],
  ]);
  const versions=new Map([...records.keys()].map(key=>[key,1]));
  const writesByCommit=[];
  let commits=0,aborts=0;
  const copy=value=>value===undefined?undefined:structuredClone(value);
  const db={
    async beginTransaction(){return {reads:new Map(),open:true}},
    async rollback(tx){tx.open=false},
    async get(path,tx){
      if(tx && !tx.reads.has(path))
        tx.reads.set(path,versions.get(path)??0);
      return {exists:records.has(path),data:copy(records.get(path))};
    },
    writeUpdate(path,data){return {kind:"update",path,data}},
    writeCreate(path,data){return {kind:"create",path,data}},
    async commit(tx,writes){
      // Allow competing requests to reach the commit step.
      await Promise.resolve();
      for(const [path,readVersion] of tx.reads){
        if((versions.get(path)??0)!==readVersion){
          aborts++;
          const error=new Error("ABORTED: conflicting Firestore transaction");
          error.status=409;throw error;
        }
      }
      for(const write of writes){
        if(write.kind==="create" && records.has(write.path)){
          aborts++;
          const error=new Error("ALREADY_EXISTS");
          error.status=409;throw error;
        }
      }
      for(const write of writes){
        const old=records.get(write.path);
        records.set(write.path,write.kind==="update"
          ?{...copy(old),...copy(write.data)}:copy(write.data));
        versions.set(write.path,(versions.get(write.path)??0)+1);
      }
      writesByCommit.push(writes.map(write=>write.path));
      tx.open=false;
      commits++;
    },
  };
  return {
    db,records,writesByCommit,
    commits:()=>commits,aborts:()=>aborts,
    documentsWithPrefix:prefix=>[...records.keys()]
      .filter(path=>path.startsWith(prefix)),
  };
}
const token={sub:"buyer_1",iat:Math.floor(Date.now()/1000)};
const quote=(productId,operationId)=>({
  action:"purchase",productId,operationId,
  expectedPriceCoins:25000,expectedDurationDays:7,
});
const assertOneFinancialCommit=(state,opId)=>{
  assert.equal(state.commits(),1);
  assert.equal(state.records.get("users/buyer_1").coins,15000);
  assert.equal(state.documentsWithPrefix("financial_ledger/store_").length,1);
  assert.equal(state.documentsWithPrefix("store_purchase_receipts/").length,1);
  assert.equal(state.documentsWithPrefix("store_purchase_operations/").length,1);
  assert.equal(state.documentsWithPrefix("user_store_entitlements/").length,1);
  const ledger=state.records.get("financial_ledger/store_buyer_1__"+opId);
  const receipt=state.records.get("store_purchase_receipts/buyer_1__"+opId);
  assert.equal(ledger.delta,-25000);
  assert.equal(ledger.openingBalance,40000);
  assert.equal(ledger.closingBalance,15000);
  assert.equal(receipt.priceCoins,25000);
  assert.equal(receipt.refundStatus,"none");
  assert.equal(state.writesByCommit[0].length,6);
};

test("two simultaneous purchases of the same item cannot double-debit or double-issue",async()=>{
  const state=serializableFixture();
  const [first,second]=await Promise.allSettled([
    commitStorePurchaseOffline(state.db,token,
      quote("200001","store_race_operation_0001"),null,100000),
    commitStorePurchaseOffline(state.db,token,
      quote("200001","store_race_operation_0002"),null,100000),
  ]);
  const outcomes=[first,second];
  assert.equal(outcomes.filter(x=>x.status==="fulfilled").length,1);
  assert.equal(outcomes.filter(x=>x.status==="rejected").length,1);
  assert.match(outcomes.find(x=>x.status==="rejected").reason.message,
    /store_item_already_owned/);
  const winning=outcomes.find(x=>x.status==="fulfilled").value.operationId;
  assertOneFinancialCommit(state,winning);
  assert.equal(state.records.get(
    "user_store_entitlements/buyer_1/items/200001").status,"active");
});

test("two concurrent purchases of different items cannot overspend wallet",async()=>{
  const state=serializableFixture();
  const outcomes=await Promise.allSettled([
    commitStorePurchaseOffline(state.db,token,
      quote("200001","store_race_other_0001"),null,100000),
    commitStorePurchaseOffline(state.db,token,
      quote("200002","store_race_other_0002"),null,100000),
  ]);
  assert.equal(outcomes.filter(x=>x.status==="fulfilled").length,1);
  assert.match(outcomes.find(x=>x.status==="rejected").reason.message,
    /insufficient_balance/);
  assertOneFinancialCommit(state,
    outcomes.find(x=>x.status==="fulfilled").value.operationId);
});

test("two concurrent retries with the same operationId commit once and replay receipt",async()=>{
  const state=serializableFixture();
  const key="store_race_replay_0001";
  const outcomes=await Promise.all([
    commitStorePurchaseOffline(state.db,token,quote("200001",key),null,100000),
    commitStorePurchaseOffline(state.db,token,quote("200001",key),null,100000),
  ]);
  assert.equal(outcomes.length,2);
  assert.equal(outcomes.filter(x=>x.duplicate===true).length,1);
  assert.equal(outcomes[0].operationId,key);
  assert.equal(outcomes[1].operationId,key);
  assertOneFinancialCommit(state,key);
});

test("a stale price quote in a concurrent request cannot charge the wallet",async()=>{
  const state=serializableFixture();
  const accepted=quote("200001","store_race_quote_0001");
  const rejected={...quote("200002","store_race_quote_0002"),
    expectedPriceCoins:1};
  const outcomes=await Promise.allSettled([
    commitStorePurchaseOffline(state.db,token,accepted,null,100000),
    commitStorePurchaseOffline(state.db,token,rejected,null,100000),
  ]);
  assert.equal(outcomes.filter(x=>x.status==="fulfilled").length,1);
  assert.match(outcomes.find(x=>x.status==="rejected").reason.message,
    /store_purchase_quote_changed/);
  assertOneFinancialCommit(state,accepted.operationId);
});
