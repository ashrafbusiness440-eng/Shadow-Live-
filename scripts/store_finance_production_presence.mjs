// Production Store historical presence acceptance: 4 narrow probes + 1
// catalog GET. Never exports financial rows or user identifiers; no writes.
// Distinguishes "no canonical historical store operations" from
// "complete/certified all-time financial report" (NOT established).
import {sign} from "node:crypto";
import {pathToFileURL} from "node:url";

export const STORE_FINANCE_PROBES=Object.freeze([
  "store_purchase_receipts","store_purchase_operations",
  "financial_ledger","admin_audit_logs",
]);
const rootFor=projectId=>
  `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents`;
function listProbe(root,collection){
  return root+"/"+collection+"?pageSize=1&mask.fieldPaths=_store_audit_read_only_probe_";
}
function queryProbe(root,collection,field,op,value){
  return {
    url:root+":runQuery",
    options:{
      method:"POST",
      body:JSON.stringify({structuredQuery:{
        from:[{collectionId:collection}],
        where:{fieldFilter:{
          field:{fieldPath:field},op,value,
        }},
        limit:1,
      }}),
    },
  };
}
export function storeFinancePresenceProbePlan(projectId){
  if(projectId!=="shadow-live")throw Error("wrong_store_finance_project");
  const root=rootFor(projectId);
  return Object.freeze({
    store_purchase_receipts:{
      url:listProbe(root,"store_purchase_receipts"),options:{method:"GET"},
    },
    store_purchase_operations:{
      url:listProbe(root,"store_purchase_operations"),options:{method:"GET"},
    },
    financial_ledger:queryProbe(root,"financial_ledger",
      "sourceType","EQUAL",{stringValue:"storePurchase"}),
    admin_audit_logs:queryProbe(root,"admin_audit_logs",
      "action","IN",{arrayValue:{values:[
        {stringValue:"purchaseStoreItem"},
        {stringValue:"renewStoreItem"},
      ]}}),
    catalog:{
      url:root+"/system_config/store_catalog"+
        "?mask.fieldPaths=purchasingEnabled",
      options:{method:"GET"},
    },
  });
}
export function parseStoreFinanceProbeResult(source,status,payload){
  if(!STORE_FINANCE_PROBES.includes(source))
    throw Error("invalid_store_presence_source");
  if(status!==200)throw Error("store_presence_api_unavailable");
  const list=source==="store_purchase_receipts"||
    source==="store_purchase_operations";
  if(list){
    if(!payload||typeof payload!=="object"||Array.isArray(payload)||
      (payload.documents!==undefined&&!Array.isArray(payload.documents))||
      (payload.nextPageToken!==undefined&&
        typeof payload.nextPageToken!=="string")||
      (payload.documents||[]).length>1)
      throw Error("invalid_store_presence_reply");
    if((payload.documents||[]).some(x=>!x||typeof x.name!=="string"))
      throw Error("invalid_store_presence_reply");
    return (payload.documents||[]).length>0 ||
      Boolean(payload.nextPageToken);
  }
  if(!Array.isArray(payload)||payload.length>2||
    payload.some(row=>!row||typeof row!=="object"||
      (!row.document && !row.readTime && !row.skippedResults)))
    throw Error("invalid_store_presence_reply");
  return payload.some(row=>Boolean(row.document));
}
export function parseStoreCatalogGate(status,payload){
  if(status===404){
    // A missing config cannot enable a purchase: the transaction requires
    // purchasingEnabled === true. It does not imply valid report data.
    return {catalogPresent:false,purchasingEnabled:false};
  }
  if(status!==200||!payload||typeof payload!=="object"||
    typeof payload.name!=="string"||
    (payload.fields!==undefined&&
      (!payload.fields||typeof payload.fields!=="object"||
       Array.isArray(payload.fields))))
    throw Error("invalid_store_catalog_probe");
  const enabled=payload.fields?.purchasingEnabled?.booleanValue;
  if(enabled!==undefined&&typeof enabled!=="boolean")
    throw Error("invalid_store_catalog_probe");
  return {catalogPresent:true,purchasingEnabled:enabled===true};
}
export function evaluateStoreFinanceHistoricalPresence(
  records,catalog,sourceSha){
  if(!records||typeof records!=="object"||Array.isArray(records)||
    !catalog||typeof catalog.purchasingEnabled!=="boolean"||
    typeof sourceSha!=="string"||!/^[a-f0-9]{40}$/.test(sourceSha))
    throw Error("invalid_store_presence_results");
  const flags={};
  for(const source of STORE_FINANCE_PROBES){
    if(typeof records[source]!=="boolean")
      throw Error("invalid_store_presence_results");
    flags[source]=records[source];
  }
  const sourcesWithRows=STORE_FINANCE_PROBES.filter(source=>flags[source]);
  return Object.freeze({
    auditedSources:STORE_FINANCE_PROBES,
    probeIsDateIndependent:true,
    perSourceReadLimit:1,
    canonicalStoreRowsPresent:sourcesWithRows.length>0,
    nonemptySources:sourcesWithRows,
    // Even complete absence is not a certificate of refunds or net Coins.
    catalogPurchaseGateOff:!catalog.purchasingEnabled,
    zeroCanonicalStoreFinancialSources:
      sourcesWithRows.length===0&&!catalog.purchasingEnabled,
    baselineSourceSha:sourceSha,
    historicalLedgerBackfillCertified:false,
    refundSettlementCertified:false,
    financialReportComplete:false,
    netRevenueCertified:false,
    // No all-time numbers are computed or claimed.
  });
}
function base64url(value){
  return Buffer.from(value).toString("base64")
    .replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");
}
export async function productionToken(serviceAccount,fetcher=fetch){
  if(!serviceAccount||serviceAccount.project_id!=="shadow-live"||
    typeof serviceAccount.client_email!=="string"||
    typeof serviceAccount.private_key!=="string")
    throw Error("invalid_store_finance_credentials");
  const now=Math.floor(Date.now()/1000);
  const unsigned=base64url(JSON.stringify({alg:"RS256",typ:"JWT"}))+
    "."+base64url(JSON.stringify({
      iss:serviceAccount.client_email,
      scope:"https://www.googleapis.com/auth/datastore",
      aud:"https://oauth2.googleapis.com/token",
      iat:now,exp:now+900,
    }));
  const assertion=unsigned+"."+base64url(sign("RSA-SHA256",
    Buffer.from(unsigned),
    serviceAccount.private_key.replace(/\\n/g,"\n")));
  const res=await fetcher("https://oauth2.googleapis.com/token",{
    method:"POST",
    headers:{"content-type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams({
      grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    signal:AbortSignal.timeout(10000),
  });
  if(!res.ok)throw Error("store_finance_oauth_failed");
  const body=await res.json();
  if(typeof body?.access_token!=="string"||!body.access_token)
    throw Error("store_finance_oauth_failed");
  return body.access_token;
}
export async function probeStoreFinanceProduction(
  {projectId,accessToken,headSha,fetcher=fetch}){
  const plan=storeFinancePresenceProbePlan(projectId);
  if(typeof accessToken!=="string"||!accessToken)
    throw Error("invalid_store_finance_token");
  const records={};
  const request=async({url,options})=>{
    const response=await fetcher(url,{
      ...options,
      headers:{
        authorization:"Bearer "+accessToken,
        ...(options.method==="POST"?{"content-type":"application/json"}:{}),
      },
      signal:AbortSignal.timeout(10000),
    });
    // Never log payloads or headers: returned documents may contain PII.
    const body=await response.json().catch(()=>(null));
    return {status:response.status,body};
  };
  // Sequential to bound rate and avoid stressing the production database.
  for(const source of STORE_FINANCE_PROBES){
    const {status,body}=await request(plan[source]);
    records[source]=parseStoreFinanceProbeResult(source,status,body);
  }
  const {status,body}=await request(plan.catalog);
  const catalog=parseStoreCatalogGate(status,body);
  return evaluateStoreFinanceHistoricalPresence(records,catalog,headSha);
}
async function main(){
  // The program must only run on the repository's production main push,
  // not a PR or arbitrary branch with a production secret.
  if(process.env.GITHUB_REF!=="refs/heads/main"||
     process.env.GITHUB_EVENT_NAME!=="push"||
     !/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA||""))
    throw Error("store_finance_production_ref_denied");
  let account;
  try{account=JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT||"{}");
    if(typeof account==="string")account=JSON.parse(account);
  }catch(_){throw Error("invalid_store_finance_credentials");}
  const token=await productionToken(account);
  const report=await probeStoreFinanceProduction({
    projectId:account.project_id,accessToken:token,
    headSha:process.env.GITHUB_SHA,
  });
  // Only source collection names and boolean result; no financial docs,
  // counts, user ID, coins, secrets or operation IDs are logged.
  console.log("Store production historical presence:",JSON.stringify(report));
  if(!report.zeroCanonicalStoreFinancialSources)
    throw Error("store_finance_historical_evidence_requires_review");
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  main().catch(error=>{
    console.error("Store historical acceptance blocked:",
      error?.message||"store_finance_verification_failed");
    process.exitCode=1;
  });
}
