// Read-only, bounded, one-buyer Store source cardinality diagnostics.
// IMPORTANT: counts are independent, not a join and not revenue proof.
// No global scans, historical backfill, wallet writes or refund settlement.
export const STORE_COVERAGE_COUNT_CAP=501;
export const STORE_COVERAGE_SOURCES=Object.freeze([
  "receipts","operations","ledger","audit",
]);
const defs=Object.freeze({
  receipts:{collection:"store_purchase_receipts",
    fields:uid=>[
      {field:"buyerUid",operator:"EQUAL",value:{stringValue:uid}},
    ]},
  operations:{collection:"store_purchase_operations",
    fields:uid=>[
      {field:"buyerUid",operator:"EQUAL",value:{stringValue:uid}},
    ]},
  ledger:{collection:"financial_ledger",
    fields:uid=>[
      {field:"userId",operator:"EQUAL",value:{stringValue:uid}},
      {field:"sourceType",operator:"EQUAL",
        value:{stringValue:"storePurchase"}},
    ]},
  audit:{collection:"admin_audit_logs",
    fields:uid=>[
      {field:"actorUid",operator:"EQUAL",value:{stringValue:uid}},
      {field:"action",operator:"IN",
        value:{arrayValue:{values:[
          {stringValue:"purchaseStoreItem"},
          {stringValue:"renewStoreItem"},
        ]}}},
    ]},
});
const uidPattern=/^[A-Za-z0-9_-]{1,128}$/;
export function storeFinancialCountRequest(source,buyerUid){
  if(typeof buyerUid!=="string"||!uidPattern.test(buyerUid))
    throw Error("invalid_store_financial_buyer");
  if(!Object.hasOwn(defs,source))
    throw Error("invalid_store_financial_source");
  const spec=defs[source];
  const filters=spec.fields(buyerUid).map(row=>({
    fieldFilter:{
      field:{fieldPath:row.field},op:row.operator,value:row.value,
    },
  }));
  return {
    structuredAggregationQuery:{
      structuredQuery:{
        from:[{collectionId:spec.collection}],
        where:filters.length===1?filters[0]:
          {compositeFilter:{op:"AND",filters}},
        // Indexed, one-buyer scope. Never count arbitrarily many entries
        // in a Worker request, even if one user has exceptional history.
        limit:STORE_COVERAGE_COUNT_CAP,
      },
      aggregations:[{
        alias:"matched",count:{upTo:String(STORE_COVERAGE_COUNT_CAP)},
      }],
    },
  };
}
export function parseStoreFinancialCountResponse(source,response){
  if(!STORE_COVERAGE_SOURCES.includes(source))
    throw Error("invalid_store_financial_source");
  if(!Array.isArray(response))throw Error("invalid_store_source_count");
  const found=response.filter(row=>row?.result?.aggregateFields?.matched);
  if(found.length!==1)throw Error("invalid_store_source_count");
  const field=found[0].result.aggregateFields.matched;
  if(!field||typeof field!=="object"||
    !Object.hasOwn(field,"integerValue"))
    throw Error("invalid_store_source_count");
  const raw=String(field.integerValue);
  if(!/^(0|[1-9][0-9]*)$/.test(raw))
    throw Error("invalid_store_source_count");
  const count=Number(raw);
  if(!Number.isSafeInteger(count)||count<0||
      count>STORE_COVERAGE_COUNT_CAP)
    throw Error("invalid_store_source_count");
  return {count,capped:count===STORE_COVERAGE_COUNT_CAP};
}
export function assembleStoreFinancialCoverage(sourceRows){
  if(!sourceRows||typeof sourceRows!=="object"||
      Array.isArray(sourceRows))
    throw Error("invalid_store_source_count");
  const counts={};
  const cappedSources=[];
  for(const source of STORE_COVERAGE_SOURCES){
    const row=sourceRows[source];
    if(!row||!Number.isSafeInteger(row.count)||row.count<0||
        row.count>STORE_COVERAGE_COUNT_CAP||
        row.capped!==(row.count===STORE_COVERAGE_COUNT_CAP))
      throw Error("invalid_store_source_count");
    counts[source]=row.count;
    if(row.capped)cappedSources.push(source);
  }
  const values=Object.values(counts);
  const cardinalitiesComparable=cappedSources.length===0;
  const sourceCountsEqual=cardinalitiesComparable&&
    values.every(value=>value===values[0]);
  const countMismatch=cardinalitiesComparable&&!sourceCountsEqual;
  return {
    ok:true,scope:"one_buyer_indexed_counts",counts,
    countCap:STORE_COVERAGE_COUNT_CAP,cappedSources,
    cardinalitiesComparable,sourceCountsEqual,countMismatch,
    // Even four equal counts can conceal swapped/missing ID pairs,
    // post-read writes, legacy fields, and unlinked refunds.
    // No historical completeness or monetary sum is certified.
    recordsIndividuallyReconciled:false,
    partialEvidenceOnly:true,financialReportComplete:false,
    netRevenueCertified:false,refundSettlementCertified:false,
  };
}
