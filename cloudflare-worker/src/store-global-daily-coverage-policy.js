// Store finance: one complete UTC date across ALL buyers, four independent
// Firestore index-only capped COUNT queries. No document scans or writes.
// This is an anomaly finder, NEVER a money or completeness certificate.
import {storeGlobalDayBounds}
  from "./store-global-daily-financial-review.js";

export const STORE_GLOBAL_DAY_COUNT_CAP=501;
export const STORE_GLOBAL_DAY_SOURCES=Object.freeze([
  "receipts","operations","ledger","audit",
]);
const specs=Object.freeze({
  receipts:{collection:"store_purchase_receipts",field:"acquiredAtMs"},
  operations:{collection:"store_purchase_operations",field:"createdAt"},
  ledger:{collection:"financial_ledger",field:"createdAt"},
  audit:{collection:"admin_audit_logs",field:"createdAt"},
});
function and(...filters){
  return {compositeFilter:{op:"AND",filters}};
}
function field(fieldPath,op,value){
  return {fieldFilter:{field:{fieldPath},op,value}};
}
export function storeGlobalDailyCountRequest(
  source,day,nowMs=Date.now()){
  if(!Object.hasOwn(specs,source))
    throw Error("invalid_store_global_source");
  const {start,end}=storeGlobalDayBounds(day,nowMs);
  const spec=specs[source];
  const receipt=source==="receipts";
  const low=receipt?{integerValue:String(start)}:
    {timestampValue:new Date(start).toISOString()};
  const high=receipt?{integerValue:String(end)}:
    {timestampValue:new Date(end).toISOString()};
  const filters=[
    field(spec.field,"GREATER_THAN_OR_EQUAL",low),
    field(spec.field,"LESS_THAN",high),
    ...(source==="ledger"
      ?[field("sourceType","EQUAL",{stringValue:"storePurchase"})]:[]),
    ...(source==="audit"
      ?[field("action","IN",{arrayValue:{values:[
        {stringValue:"purchaseStoreItem"},
        {stringValue:"renewStoreItem"},
      ]}})]:[]),
  ];
  return {
    structuredAggregationQuery:{
      structuredQuery:{
        from:[{collectionId:spec.collection}],
        where:and(...filters),
        // Cap the number of indexed entries read. 501 means >=501,
        // not an authoritative total or a reason to scan deeper.
        limit:STORE_GLOBAL_DAY_COUNT_CAP,
      },
      aggregations:[{
        alias:"matched",count:{upTo:String(STORE_GLOBAL_DAY_COUNT_CAP)},
      }],
    },
  };
}
export function parseStoreGlobalDailyCount(source,rows){
  if(!Object.hasOwn(specs,source))
    throw Error("invalid_store_global_source");
  if(!Array.isArray(rows)||rows.length!==1)
    throw Error("invalid_store_global_count");
  const raw=rows[0]?.result?.aggregateFields?.matched?.integerValue;
  if(typeof raw!=="string"||!/^(0|[1-9][0-9]*)$/.test(raw))
    throw Error("invalid_store_global_count");
  const count=Number(raw);
  if(!Number.isSafeInteger(count)||count>STORE_GLOBAL_DAY_COUNT_CAP)
    throw Error("invalid_store_global_count");
  return {count,capped:count===STORE_GLOBAL_DAY_COUNT_CAP};
}
export function assembleStoreGlobalDailyCoverage(
  day,records,nowMs=Date.now()){
  storeGlobalDayBounds(day,nowMs);
  if(!records||typeof records!=="object"||Array.isArray(records))
    throw Error("invalid_store_global_count");
  const counts={};
  const cappedSources=[];
  for(const source of STORE_GLOBAL_DAY_SOURCES){
    const row=records[source];
    if(!row||!Number.isSafeInteger(row.count)||row.count<0||
        row.count>STORE_GLOBAL_DAY_COUNT_CAP||
        row.capped!==(row.count===STORE_GLOBAL_DAY_COUNT_CAP))
      throw Error("invalid_store_global_count");
    counts[source]=row.count;
    if(row.capped)cappedSources.push(source);
  }
  const comparable=cappedSources.length===0;
  const values=Object.values(counts);
  const countsEqual=comparable&&values.every(n=>n===values[0]);
  return {
    ok:true,scope:"all_buyers_one_utc_day_indexed_counts",
    day,counts,countCap:STORE_GLOBAL_DAY_COUNT_CAP,
    cappedSources,cardinalitiesComparable:comparable,
    sourceCountsEqual:countsEqual,countMismatch:comparable&&!countsEqual,
    // Matching counts can conceal identity swaps, independent date gaps,
    // late backfills, date-less historic records and refund settlements.
    historicalRowsWithoutDateNotCovered:true,
    sourceCompletenessCertified:false,
    recordsIndividuallyReconciled:false,
    legacyBackfillCertified:false,partialEvidenceOnly:true,
    financialReportComplete:false,netRevenueCertified:false,
    refundSettlementCertified:false,
  };
}
