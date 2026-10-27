// Read-only production readiness proof for the gift catalog ranking index.
// Does not create gifts, modify ledgers, grant currency or read user identities.
import {googleAccessTokenFromServiceAccount,parseServiceAccount} from "../src/google-auth.js";
import {giftTotalsAggregationRequest,parseGiftTotalsAggregationResponse} from "../src/gift-totals-aggregation-policy.js";

const raw=process.env.FIREBASE_SERVICE_ACCOUNT || "";
const projectId=parseServiceAccount(raw).projectId;
const token=await googleAccessTokenFromServiceAccount(raw,"https://www.googleapis.com/auth/cloud-platform");
const headers={authorization:"Bearer "+token};
const group="gift_transactions";
const parent="projects/"+projectId+"/databases/(default)/collectionGroups/"+group;
const root="https://firestore.googleapis.com/v1/projects/"+encodeURIComponent(projectId)+"/databases/(default)";
const expected=["giftId","quantity","totalCost","paidCost"];
const sleep=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));
function matching(index){
  if(index.queryScope!=="COLLECTION")return false;
  const fields=(index.fields||[]).filter(f=>f.fieldPath!=="__name__");
  return fields.length===expected.length && fields.every(
    (f,i)=>f.fieldPath===expected[i] && f.order==="ASCENDING"
  );
}
async function state(){
  let next="",seen=0;
  do{
    const url=new URL("https://firestore.googleapis.com/v1/"+parent+"/indexes");
    if(next)url.searchParams.set("pageToken",next);
    const response=await fetch(url,{headers});
    if(!response.ok)throw Error("gift_ranking_index_list_http_"+response.status);
    const json=await response.json();
    const match=(json.indexes||[]).find(matching);
    if(match)return String(match.state||"UNKNOWN");
    next=String(json.nextPageToken||"");
    if(++seen>15)throw Error("gift_ranking_index_pagination_limit");
  }while(next);
  return "MISSING";
}
let lastState="UNKNOWN";
for(let attempt=1;attempt<=12;attempt++){
  lastState=await state();
  console.log("Gift ranking index state: "+lastState+" ("+attempt+"/12)");
  if(lastState==="READY")break;
  if(lastState==="NEEDS_REPAIR"||lastState==="MISSING"||lastState==="ERROR") {
    throw Error("gift_ranking_index_not_ready_"+lastState);
  }
  if(attempt<12)await sleep(15000);
}
if(lastState!=="READY")throw Error("gift_ranking_index_still_building_"+lastState);

// Query one deliberately nonexistent ID. This proves real COUNT/SUM query
// availability without scanning/loading historical customer gift entries.
const probeId="zz_ci_gift_index_readiness_987654321";
const response=await fetch(root+"/documents:runAggregationQuery",{
  method:"POST",
  headers:{...headers,"content-type":"application/json"},
  body:JSON.stringify(giftTotalsAggregationRequest(null,probeId)),
});
if(!response.ok){
  const code=response.status;
  const failure=await response.json().catch(()=>({}));
  const upstreamStatus=String(failure?.error?.status||"UNKNOWN")
    .replace(/[^A-Z_]/g,"").slice(0,80);
  const upstreamMessage=String(failure?.error?.message||"")
    .replace(/https?:\\/\\/\\S+/g,"[index_link]")
    .replace(/Bearer\\s+[^\\s]+/g,"Bearer [redacted]")
    .slice(0,450);
  console.error("Gift index aggregate rejection:",JSON.stringify({
    httpCode:code,upstreamStatus,message:upstreamMessage,
  }));
  // Count-only comparison isolates basic collection filtering from multi-field sums.
  const countOnly={structuredAggregationQuery:{
    structuredQuery:giftTotalsAggregationRequest(null,probeId).structuredAggregationQuery.structuredQuery,
    aggregations:[{alias:"receipts",count:{}}],
  }};
  const diagnosis=await fetch(root+"/documents:runAggregationQuery",{
    method:"POST",
    headers:{...headers,"content-type":"application/json"},
    body:JSON.stringify(countOnly),
  });
  const diagnosisBody=await diagnosis.json().catch(()=>({}));
  console.error("Count-only index diagnosis:",JSON.stringify({
    httpCode:diagnosis.status,
    upstreamStatus:String(diagnosisBody?.error?.status||"OK").slice(0,80),
    message:String(diagnosisBody?.error?.message||"")
      .replace(/https?:\\/\\/\\S+/g,"[index_link]").slice(0,300),
  }));
  throw Error("gift_ranking_index_aggregation_http_"+code);
}
const rawResult=await response.text();
let entries;
try{
  const data=JSON.parse(rawResult);
  entries=Array.isArray(data)?data:[data];
}catch{
  entries=rawResult.split(/\r?\n/).filter(Boolean).map(JSON.parse);
}
const result=parseGiftTotalsAggregationResponse(entries);
if(result.receipts!==0||result.gifts!==0||result.faceCoins!==0||
  result.paidCoins!==0)throw Error("gift_ranking_index_probe_not_empty");
console.log("PASS: gift_transactions per-gift COUNT/SUM index READY and production query returned zero without reading ledger documents.");
