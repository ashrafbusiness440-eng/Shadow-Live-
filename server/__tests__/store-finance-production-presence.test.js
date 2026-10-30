import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import {
  STORE_FINANCE_PROBES,
  storeFinancePresenceProbePlan,
  parseStoreFinanceProbeResult,
  parseStoreCatalogGate,
  evaluateStoreFinanceHistoricalPresence,
  probeStoreFinanceProduction,
} from "../../scripts/store_finance_production_presence.mjs";

const sha="383fbdf005ad1d60186776cd8a819c317e9d74a1";
const sources=STORE_FINANCE_PROBES;
const empty=Object.fromEntries(sources.map(source=>[source,false]));
test("four historical Store sources are date-independent and one-document capped",()=>{
  assert.deepEqual(sources,[
    "store_purchase_receipts","store_purchase_operations",
    "financial_ledger","admin_audit_logs",
  ]);
  const plan=storeFinancePresenceProbePlan("shadow-live");
  for(const source of sources){
    assert.ok(plan[source].url.includes("firestore.googleapis.com"));
    assert.ok(plan[source].url.includes("/documents"));
    assert.equal(plan[source].options.method,
      source.includes("receipts")||source.includes("operations")
        ?"GET":"POST");
    if(plan[source].options.method==="GET"){
      assert.ok(plan[source].url.includes("pageSize=1"));
      assert.ok(plan[source].url.includes("mask.fieldPaths="));
    }else{
      const query=JSON.parse(plan[source].options.body).structuredQuery;
      assert.equal(query.limit,1);
      assert.equal(query.from[0].collectionId,source);
      const filter=query.where.fieldFilter;
      assert.ok(["sourceType","action"].includes(filter.field.fieldPath));
      assert.ok(["EQUAL","IN"].includes(filter.op));
    }
  }
  assert.equal(plan.catalog.options.method,"GET");
  assert.throws(()=>storeFinancePresenceProbePlan("other-project"),
    /wrong_store_finance_project/);
});

test("date-less legacy receipt/operation still shows as present",()=>{
  assert.equal(parseStoreFinanceProbeResult(
    "store_purchase_receipts",200,{
      documents:[{name:"projects/shadow-live/databases/(default)/documents/store_purchase_receipts/legacy"}],
    }),true);
  assert.equal(parseStoreFinanceProbeResult(
    "store_purchase_operations",200,{
      documents:[{name:"legacy_without_createdAt"}],
    }),true);
  assert.equal(parseStoreFinanceProbeResult(
    "store_purchase_receipts",200,{}),false);
  assert.equal(parseStoreFinanceProbeResult(
    "financial_ledger",200,[{readTime:"2026-10-30T01:00:00Z"}]),false);
  assert.equal(parseStoreFinanceProbeResult(
    "financial_ledger",200,[{document:{name:"ledger_doc"}}]),true);
  assert.equal(parseStoreFinanceProbeResult(
    "admin_audit_logs",200,[]),false);
  for(const [source,status,payload] of [
    ["store_purchase_receipts",403,{}],
    ["store_purchase_receipts",200,{documents:"bad"}],
    ["financial_ledger",500,[]],
    ["financial_ledger",200,{}],
    ["admin_audit_logs",200,[{unexpected:"no readTime"}]],
  ])assert.throws(()=>parseStoreFinanceProbeResult(
    source,status,payload),/store_presence_api_unavailable|invalid_store_presence_reply/);
});

test("only absent receipts/operations/Store ledger/audit with catalog closed pass",()=>{
  const zero=evaluateStoreFinanceHistoricalPresence(
    empty,{catalogPresent:true,purchasingEnabled:false},sha);
  assert.equal(zero.zeroCanonicalStoreFinancialSources,true);
  assert.equal(zero.canonicalStoreRowsPresent,false);
  assert.equal(zero.catalogPurchaseGateOff,true);
  assert.equal(zero.historicalLedgerBackfillCertified,false);
  assert.equal(zero.financialReportComplete,false);
  assert.equal(zero.netRevenueCertified,false);
  assert.equal(zero.refundSettlementCertified,false);
  for(const source of sources){
    const withRecord={...empty,[source]:true};
    const fail=evaluateStoreFinanceHistoricalPresence(
      withRecord,{purchasingEnabled:false},sha);
    assert.equal(fail.zeroCanonicalStoreFinancialSources,false);
    assert.deepEqual(fail.nonemptySources,[source]);
  }
  assert.equal(evaluateStoreFinanceHistoricalPresence(
    empty,{purchasingEnabled:true},sha).zeroCanonicalStoreFinancialSources,
  false);
  assert.throws(()=>evaluateStoreFinanceHistoricalPresence(
    {...empty,admin_audit_logs:null},{purchasingEnabled:false},sha),
    /invalid_store_presence_results/);
});

test("catalog purchase switch is fail-closed even when missing field or document",()=>{
  assert.deepEqual(parseStoreCatalogGate(404,null),{
    catalogPresent:false,purchasingEnabled:false,
  });
  assert.deepEqual(parseStoreCatalogGate(200,{
    name:"projects/shadow-live/databases/(default)/documents/system_config/store_catalog",
    fields:{purchasingEnabled:{booleanValue:false}},
  }),{catalogPresent:true,purchasingEnabled:false});
  assert.deepEqual(parseStoreCatalogGate(200,{
    name:"doc",fields:{purchasingEnabled:{booleanValue:true}},
  }),{catalogPresent:true,purchasingEnabled:true});
  assert.throws(()=>parseStoreCatalogGate(403,{}),
    /invalid_store_catalog_probe/);
  assert.throws(()=>parseStoreCatalogGate(200,{
    name:"doc",fields:{purchasingEnabled:{stringValue:"false"}},
  }),/invalid_store_catalog_probe/);
});

test("end-to-end production probing is 5 sequential bounded reads and no writes",async()=>{
  const plan=storeFinancePresenceProbePlan("shadow-live");
  const calls=[];
  const mock=async(url,options)=>{
    calls.push({url,method:options.method,body:options.body});
    let payload;
    if(url===plan.catalog.url)payload={
      name:"catalog_doc",fields:{purchasingEnabled:{booleanValue:false}},
    };
    else if(url.includes(":runQuery"))payload=[{readTime:"2026-10-30T01:00:00Z"}];
    else payload={};
    return {status:200,async json(){return payload;}};
  };
  const result=await probeStoreFinanceProduction({
    projectId:"shadow-live",accessToken:"fake",headSha:sha,fetcher:mock,
  });
  assert.equal(result.zeroCanonicalStoreFinancialSources,true);
  assert.equal(calls.length,5);
  assert.deepEqual(calls.map(c=>c.method),[
    "GET","GET","POST","POST","GET",
  ]);
  assert.ok(calls.every(c=>c.method!=="PUT"&&c.method!=="DELETE"&&
    c.method!=="PATCH"));
  assert.equal(JSON.stringify(result).includes("account_"),false);
  const bad=async()=>({status:429,async json(){return {error:"quota"};}});
  await assert.rejects(()=>probeStoreFinanceProduction({
    projectId:"shadow-live",accessToken:"fake",headSha:sha,fetcher:bad,
  }),/store_presence_api_unavailable/);
});

test("production accepted only on main, with no client or public API pathway",()=>{
  const workflow=readFileSync(
    ".github/workflows/store-finance-production-acceptance.yml","utf8");
  const script=readFileSync(
    "scripts/store_finance_production_presence.mjs","utf8");
  assert.match(workflow,/branches: \[main\]/);
  assert.match(workflow,/FIREBASE_SERVICE_ACCOUNT: \$\{\{ secrets.FIREBASE_SERVICE_ACCOUNT \}\}/);
  assert.match(script,/GITHUB_REF!==\"refs\/heads\/main\"/);
  assert.match(script,/GITHUB_EVENT_NAME!==\"push\"/);
  assert.match(script,/perSourceReadLimit:1/);
  assert.doesNotMatch(script,/writeUpdate\(|writeCreate\(|writeDelete\(/);
});
