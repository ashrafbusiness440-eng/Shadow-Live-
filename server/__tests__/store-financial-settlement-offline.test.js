import assert from "node:assert/strict";
import {test} from "node:test";
import {
  inspectStoreFinancialSettlementOffline,
  compileStoreSelectedSettlementStatement,
} from "../../cloudflare-worker/src/store-financial-settlement-offline.js";

const buyerUid="buyer_1";
const operationId="store_purchase_operation_v1";
const productId="200001";
const opKey=buyerUid+"__"+operationId;
const paths={
  operation:"store_purchase_operations/"+opKey,
  receipt:"store_purchase_receipts/"+opKey,
  saleLedger:"financial_ledger/store_"+opKey,
  saleAudit:"admin_audit_logs/store_purchase_"+opKey,
  refundLedger:"financial_ledger/store_refund_"+opKey,
  refundAudit:"admin_audit_logs/store_refund_"+opKey,
};
function fixture(status="none"){
  const amount=14000;
  const records=new Map([
    [paths.operation,{buyerUid,productId,kind:"purchase",status:"completed",
      result:{operationId,productId,priceCoins:amount,
        durationDays:0,acquiredAtMs:100000,expiresAtMs:null,
        deliveryStatus:"delivered",renewal:false}}],
    [paths.receipt,{buyerUid,operationId,productId,priceCoins:amount,
      durationDays:0,acquiredAtMs:100000,expiresAtMs:null,
      deliveryStatus:"delivered",renewal:false,refundStatus:status}],
    [paths.saleLedger,{userId:buyerUid,asset:"coins",delta:-amount,
      sourceType:"storePurchase",reason:"store_item_purchase",
      sourceId:opKey,idempotencyKey:opKey,renewal:false,
      openingBalance:50000,closingBalance:36000}],
    [paths.saleAudit,{actorUid:buyerUid,targetType:"store_entitlement",
      targetId:"user_store_entitlements/"+buyerUid+"/items/"+productId,
      action:"purchaseStoreItem",operationId,priceCoins:amount}],
  ]);
  if(status==="refunded"){
    records.set(paths.refundLedger,{
      userId:buyerUid,asset:"coins",delta:amount,
      sourceType:"storePurchaseRefund",reason:"store_item_refund",
      sourceId:opKey,idempotencyKey:"store_refund_"+opKey,
      openingBalance:36000,closingBalance:50000,
    });
    records.set(paths.refundAudit,{
      actorUid:"verified_owner",buyerUid,
      action:"refundStorePurchase",
      targetType:"store_purchase_receipt",
      targetId:"store_purchase_receipts/"+opKey,
      operationId,refundedCoins:amount,ledgerId:"store_refund_"+opKey,
    });
  }
  const reads=[];
  const db={
    async get(path){
      reads.push(path);
      return {exists:records.has(path),data:records.get(path)};
    },
    async runQuery(){throw Error("must_not_scan");},
    async commit(){throw Error("must_not_write");},
    async beginTransaction(){throw Error("must_not_begin_transaction");},
  };
  return {db,records,reads};
}
const params={buyerUid,operationId,expectedProductId:productId};
const entry={operationId,productId};

test("valid sale, no refunds: gross=net and six exact immutable reads",async()=>{
  const {db,reads}=fixture("none");
  const proof=await inspectStoreFinancialSettlementOffline(db,params);
  assert.deepEqual(proof,{
    verified:true,kind:"purchase",refundStatus:"none",
    grossCoins:14000,refundedCoins:0,netCoins:14000,
  });
  assert.equal(reads.length,6);
  assert.deepEqual(new Set(reads),new Set(Object.values(paths)));
  const report=await compileStoreSelectedSettlementStatement(db,{
    buyerUid,operations:[entry],
  });
  assert.equal(report.inspected,1);
  assert.equal(report.verified,1);
  assert.equal(report.fullSelectionVerified,true);
  assert.equal(report.selectedGrossCoins,14000);
  assert.equal(report.selectedRefundedCoins,0);
  assert.equal(report.selectedNetCoins,14000);
  assert.equal(report.selectedPurchaseCoins,14000);
  assert.equal(report.selectedRenewalCoins,0);
  assert.equal(report.financialReportComplete,false);
  assert.equal(report.netRevenueCertified,false);
  assert.equal(report.refundSettlementCertified,false);
  assert.equal(report.financialWritesPerformed,false);
});

test("verified full Coin refund has an equal opposite ledger and Owner audit",async()=>{
  const {db,reads}=fixture("refunded");
  const result=await inspectStoreFinancialSettlementOffline(db,params);
  assert.deepEqual(result,{
    verified:true,kind:"purchase",refundStatus:"refunded",
    grossCoins:14000,refundedCoins:14000,netCoins:0,
  });
  assert.equal(reads.length,6);
  const report=await compileStoreSelectedSettlementStatement(db,{
    buyerUid,operations:[entry],
  });
  assert.equal(report.selectedGrossCoins,14000);
  assert.equal(report.selectedRefundedCoins,14000);
  assert.equal(report.selectedNetCoins,0);
});

test("refund/rejected/chargeback pending states cannot be treated as revenue",async()=>{
  for(const status of ["requested","rejected","chargeback","unknown",null]){
    const {db}=fixture(status);
    const row=await inspectStoreFinancialSettlementOffline(db,params);
    assert.equal(row.verified,false);
    assert.equal(row.code,"requires_refund_review");
    const report=await compileStoreSelectedSettlementStatement(db,{
      buyerUid,operations:[entry],
    });
    assert.equal(report.fullSelectionVerified,false);
    assert.equal("selectedNetCoins" in report,false);
    assert.equal("selectedGrossCoins" in report,false);
  }
});

test("refund evidence absent, duplicated or forged causes no net statement",async()=>{
  for(const kind of [
    "no_refund_audit","no_refund_ledger","wrong_amount",
    "wrong_balance","wrong_source","wrong_idempotency",
    "wrong_audit","wrong_audit_actor","wrong_audit_target",
    "wrong_buyer","wrong_audit_amount",
  ]){
    const {db,records}=fixture("refunded");
    const ledger=records.get(paths.refundLedger);
    const audit=records.get(paths.refundAudit);
    if(kind==="no_refund_audit")records.delete(paths.refundAudit);
    if(kind==="no_refund_ledger")records.delete(paths.refundLedger);
    if(kind==="wrong_amount")ledger.delta=14001;
    if(kind==="wrong_balance")ledger.closingBalance=49999;
    if(kind==="wrong_source")ledger.sourceType="storePurchase";
    if(kind==="wrong_idempotency")ledger.idempotencyKey="other";
    if(kind==="wrong_audit")audit.action="purchaseStoreItem";
    if(kind==="wrong_audit_actor")audit.actorUid=buyerUid;
    if(kind==="wrong_audit_target")audit.targetId="other_receipt";
    if(kind==="wrong_buyer")audit.buyerUid="different";
    if(kind==="wrong_audit_amount")audit.refundedCoins=14001;
    const report=await compileStoreSelectedSettlementStatement(db,{
      buyerUid,operations:[entry],
    });
    assert.equal(report.fullSelectionVerified,false,kind);
    assert.equal(report.needsReview,1,kind);
    assert.equal("selectedNetCoins" in report,false,kind);
    assert.equal(report.financialWritesPerformed,false,kind);
  }
});
test("orphan refund credit with receipt none cannot falsely count as sale",async()=>{
  for(const source of [paths.refundLedger,paths.refundAudit]){
    const {db,records}=fixture();
    records.set(source,{delta:14000});
    const result=await inspectStoreFinancialSettlementOffline(db,params);
    assert.deepEqual(result,{verified:false,code:"unexpected_refund_credit"});
  }
});

test("no partial selection reporting when one original source is altered",async()=>{
  for(const source of [paths.operation,paths.receipt,
    paths.saleLedger,paths.saleAudit]){
    const {db,records}=fixture();
    records.delete(source);
    const report=await compileStoreSelectedSettlementStatement(db,{
      buyerUid,operations:[entry],
    });
    assert.equal(report.fullSelectionVerified,false);
    assert.equal("selectedNetCoins" in report,false);
    assert.equal(report.verified,0);
  }
  const {db,records}=fixture();
  records.get(paths.saleLedger).closingBalance=99999;
  const report=await compileStoreSelectedSettlementStatement(db,{
    buyerUid,operations:[entry],
  });
  assert.equal(report.fullSelectionVerified,false);
  assert.equal(report.evidence[0].code,"ledger_mismatch");
});

test("invalid selection and duplicates rejected before any reads",async()=>{
  for(const entries of [
    [],Array.from({length:6},()=>entry),
    [entry,entry],[{operationId:"bad",productId}],
    [{operationId,productId:"invalid"}],null,
  ]){
    const {db,reads}=fixture();
    await assert.rejects(()=>compileStoreSelectedSettlementStatement(db,{
      buyerUid,operations:entries,
    }),/invalid_store_settlement_selection/);
    assert.equal(reads.length,0);
  }
});
