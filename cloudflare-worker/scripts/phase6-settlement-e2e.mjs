import fs from "node:fs";
import { sign } from "node:crypto";

const base="https://shadow-live.ashraf-business-440.workers.dev";
let sa=JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT||"{}");
if(typeof sa==="string")sa=JSON.parse(sa);
const projectId=sa.project_id;
const clientEmail=sa.client_email;
const privateKey=String(sa.private_key||"").replace(/\\n/g,"\n");
if(!projectId||!clientEmail||!privateKey)throw Error("invalid service account");

const firebaseOptions=fs.readFileSync("lib/firebase_options.dart","utf8");
const apiKey=firebaseOptions.match(/apiKey:\s*'([^']+)'/)?.[1];
if(!apiKey)throw Error("Firebase API key missing");

const runId=String(process.env.GITHUB_RUN_ID||Date.now());
const ownerUid="__cf_p6_owner_"+runId;
const playerUid="__cf_p6_player_"+runId;
const hostUid="__cf_p6_host_"+runId;
const agencyId="__cf_p6_agency_"+runId;
const manualKey="phase6manual_"+runId;
const cronKey="phase6cron_"+runId;
const manualOpId=playerUid+"__"+manualKey;
const cronOpId=playerUid+"__"+cronKey;
const manualRound="phase6_manual_round_"+runId;
const cronRound="phase6_cron_round_"+runId;
const accrualId="phase6_settlement_"+runId;
const month="2026-09";
const cycleKey="2026-09-C2";

function b64url(value){
  return Buffer.from(value).toString("base64").replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");
}
function encodeValue(value){
  if(value===null||value===undefined)return {nullValue:null};
  if(value instanceof Date)return {timestampValue:value.toISOString()};
  if(typeof value==="boolean")return {booleanValue:value};
  if(typeof value==="string")return {stringValue:value};
  if(typeof value==="number")return Number.isInteger(value)?{integerValue:String(value)}:{doubleValue:value};
  if(Array.isArray(value))return {arrayValue:{values:value.map(encodeValue)}};
  if(typeof value==="object")return {mapValue:{fields:Object.fromEntries(Object.entries(value).map(([k,v])=>[k,encodeValue(v)]))}};
  return {stringValue:String(value)};
}
function encodeFields(fields={}){
  return Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,encodeValue(v)]));
}
function decodeValue(v){
  if(!v||typeof v!=="object")return null;
  if("stringValue"in v)return v.stringValue;
  if("integerValue"in v)return Number(v.integerValue);
  if("doubleValue"in v)return Number(v.doubleValue);
  if("booleanValue"in v)return v.booleanValue;
  if("timestampValue"in v)return v.timestampValue;
  if("nullValue"in v)return null;
  if("arrayValue"in v)return (v.arrayValue.values||[]).map(decodeValue);
  if("mapValue"in v)return Object.fromEntries(Object.entries(v.mapValue.fields||{}).map(([k,x])=>[k,decodeValue(x)]));
  return null;
}
function decodeFields(fields={}){return Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,decodeValue(v)]));}

async function googleAccessToken(){
  const now=Math.floor(Date.now()/1000);
  const header=b64url(JSON.stringify({alg:"RS256",typ:"JWT"}));
  const payload=b64url(JSON.stringify({
    iss:clientEmail,
    scope:"https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/identitytoolkit",
    aud:"https://oauth2.googleapis.com/token",
    iat:now,exp:now+3600,
  }));
  const unsigned=header+"."+payload;
  const signature=sign("RSA-SHA256",Buffer.from(unsigned),privateKey);
  const assertion=unsigned+"."+b64url(signature);
  const res=await fetch("https://oauth2.googleapis.com/token",{
    method:"POST",
    headers:{"content-type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion}),
  });
  const body=await res.json();
  if(!res.ok||!body.access_token)throw Error("google oauth failed");
  return body.access_token;
}
function customToken(uid){
  const now=Math.floor(Date.now()/1000);
  const header=b64url(JSON.stringify({alg:"RS256",typ:"JWT"}));
  const payload=b64url(JSON.stringify({
    iss:clientEmail,sub:clientEmail,
    aud:"https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit",
    iat:now,exp:now+3600,uid,
  }));
  const unsigned=header+"."+payload;
  const signature=sign("RSA-SHA256",Buffer.from(unsigned),privateKey);
  return unsigned+"."+b64url(signature);
}
async function firebaseIdToken(uid){
  const res=await fetch("https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key="+encodeURIComponent(apiKey),{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({token:customToken(uid),returnSecureToken:true}),
  });
  const body=await res.json();
  if(!res.ok||!body.idToken)throw Error("token exchange failed "+res.status);
  return body.idToken;
}

const accessToken=await googleAccessToken();
const root="https://firestore.googleapis.com/v1/projects/"+projectId+"/databases/(default)/documents";
async function fsSet(path,fields){
  const res=await fetch(root+"/"+path,{
    method:"PATCH",
    headers:{authorization:"Bearer "+accessToken,"content-type":"application/json"},
    body:JSON.stringify({fields:encodeFields(fields)}),
  });
  if(!res.ok)throw Error("fsSet "+path+" "+res.status+" "+await res.text());
}
async function fsGet(path){
  const res=await fetch(root+"/"+path,{headers:{authorization:"Bearer "+accessToken}});
  if(res.status===404)return null;
  const body=await res.json();
  if(!res.ok)throw Error("fsGet "+path+" "+res.status);
  return decodeFields(body.fields||{});
}
async function fsDelete(path){
  const res=await fetch(root+"/"+path,{method:"DELETE",headers:{authorization:"Bearer "+accessToken}});
  if(!res.ok&&res.status!==404)throw Error("fsDelete "+path+" "+res.status);
}
async function deleteAuth(idToken){
  if(!idToken)return;
  await fetch("https://identitytoolkit.googleapis.com/v1/accounts:delete?key="+encodeURIComponent(apiKey),{
    method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({idToken}),
  }).catch(()=>{});
}
async function post(path,token,body){
  const res=await fetch(base+path,{
    method:"POST",
    headers:{authorization:"Bearer "+token,"content-type":"application/json",origin:"https://ashrafbusiness440-eng.github.io"},
    body:JSON.stringify(body),
  });
  const data=await res.json().catch(()=>({}));
  return {res,body:data};
}
function ok(label,out){
  if(!out.res.ok||out.body?.ok!==true)throw Error(label+" failed "+out.res.status+" "+JSON.stringify(out.body));
  console.log("PASS "+label);
  return out.body;
}
async function waitForCron(){
  for(let i=0;i<18;i++){
    const op=await fsGet("game_operations/"+cronOpId);
    if(op?.status==="settled")return op;
    await new Promise(r=>setTimeout(r,5000));
  }
  throw Error("Cloudflare cron did not settle due game operation");
}

let ownerToken=null,playerToken=null;
const cleanup=[
  "game_operations/"+manualOpId,
  "game_operations/"+cronOpId,
  "game_rounds/"+manualRound,
  "game_rounds/"+cronRound,
  "financial_ledger/game_credit__"+manualOpId,
  "financial_ledger/game_credit__"+cronOpId,
  "game_user_history/"+playerUid+"/items/"+manualOpId,
  "game_user_history/"+playerUid+"/items/"+cronOpId,
  "agency_settlement_accruals/"+accrualId,
  "agency_settlements/"+accrualId,
  "financial_ledger/agency_settlement_"+accrualId,
  "agency_support_stats/"+agencyId+"/monthly/"+month,
  "users/"+ownerUid,
  "users/"+playerUid,
  "users/"+hostUid,
];
for(let d=16;d<=24;d++)cleanup.push("host_mic_activity/"+hostUid+"/days/"+month+"-"+String(d).padStart(2,"0"));

try{
  await fsSet("users/"+ownerUid,{displayName:"Phase6 Owner",role:"owner",adminEnabled:true,capabilities:["manageEconomy","manageGames","manageSettlements"],coins:0,diamonds:0});
  await fsSet("users/"+playerUid,{displayName:"Phase6 Player",role:"user",adminEnabled:false,coins:10000,diamonds:0});
  await fsSet("users/"+hostUid,{
    displayName:"Phase6 Host",role:"user",adminEnabled:false,coins:0,diamonds:0,
    agencyId,
    giftRevenueMonth:month,
    giftRevenueMonthCoins:10000000,
    pendingGiftEarningCoins:0,
    pendingAgencyGiftEarningCoins:6000000,
    giftDiamondsLifetime:0,
  });
  await fsSet("agency_support_stats/"+agencyId+"/monthly/"+month,{activeHostIds:[hostUid,"h2","h3","h4","h5"]});
  for(let d=16;d<=24;d++){
    const day=month+"-"+String(d).padStart(2,"0");
    await fsSet("host_mic_activity/"+hostUid+"/days/"+day,{day,qualified:true,seconds:7200});
  }
  await fsSet("agency_settlement_accruals/"+accrualId,{
    agencyId,hostUid,cycleKey,month,status:"pending",supportCoins:10000000,hostGrossEarningCoins:6000000,
  });

  ownerToken=await firebaseIdToken(ownerUid);
  playerToken=await firebaseIdToken(playerUid);

  const agency=ok("agency cycle settlement",await post("/api/economy-control",ownerToken,{action:"settleAgencyCycle",accrualId}));
  if(agency.alreadySettled!==false||agency.settlement?.status!=="settled"||Number(agency.settlement?.hostDiamonds||0)<=0){
    throw Error("agency settlement result invalid "+JSON.stringify(agency));
  }
  const hostAfter=await fsGet("users/"+hostUid);
  if(Number(hostAfter?.diamonds||0)<=0)throw Error("agency settlement did not credit host diamonds");
  const agencyLedger=await fsGet("financial_ledger/agency_settlement_"+accrualId);
  if(!agencyLedger||agencyLedger.sourceType!=="agency_settlement")throw Error("agency settlement ledger missing");
  console.log("PASS agency settlement wallet + ledger");

  const agencyDuplicate=ok("agency settlement idempotency",await post("/api/economy-control",ownerToken,{action:"settleAgencyCycle",accrualId}));
  if(agencyDuplicate.alreadySettled!==true)throw Error("agency settlement duplicate guard failed");

  const now=Date.now();
  await fsSet("game_operations/"+manualOpId,{
    operationId:manualOpId,idempotencyKey:manualKey,userId:playerUid,roomId:"phase6_room",
    gameId:"greedy_cat",mode:"",roundId:manualRound,roundNumber:1,dayKey:"2026-09-24",
    status:"pending",totalStakeCoins:200,payoutCoins:5000,outcomeId:"pepper5",
    selections:[{choiceId:"pepper5",amountCoins:200}],betEvents:[{choiceId:"pepper5",amountCoins:200}],
    reels:[],closesAtMs:now-1000,balanceAfter:10000,
  });
  const settled=ok("manual game settlement",await post("/api/game-runtime",playerToken,{action:"settleOperation",idempotencyKey:manualKey}));
  if(settled.status!=="settled"||Number(settled.payoutCoins||0)!==5000)throw Error("manual settlement payload invalid");
  const playerAfterManual=await fsGet("users/"+playerUid);
  if(Number(playerAfterManual?.coins)!==15000)throw Error("manual game settlement wallet mismatch");
  const gameLedger=await fsGet("financial_ledger/game_credit__"+manualOpId);
  if(!gameLedger||Number(gameLedger.delta)!==5000)throw Error("manual game ledger missing");
  console.log("PASS manual game wallet + ledger");

  const duplicate=ok("manual game settlement idempotency",await post("/api/game-runtime",playerToken,{action:"settleOperation",idempotencyKey:manualKey}));
  if(duplicate.code!=="duplicate")throw Error("manual game duplicate guard failed");
  const playerAfterDuplicate=await fsGet("users/"+playerUid);
  if(Number(playerAfterDuplicate?.coins)!==15000)throw Error("duplicate settlement credited twice");

  await fsSet("game_operations/"+cronOpId,{
    operationId:cronOpId,idempotencyKey:cronKey,userId:playerUid,roomId:"phase6_room",
    gameId:"witch",mode:"normal",roundId:cronRound,roundNumber:1,dayKey:"2026-09-24",
    status:"pending",totalStakeCoins:100,payoutCoins:7000,outcomeId:"moon",
    selections:[{choiceId:"moon",amountCoins:100}],betEvents:[{choiceId:"moon",amountCoins:100}],
    reels:[],closesAtMs:Date.now()-1000,balanceAfter:15000,
  });
  const cronSettled=await waitForCron();
  if(cronSettled.status!=="settled")throw Error("cron settlement status mismatch");
  if(cronSettled.settlementWorker!=="cloudflare_cron"){
    throw Error("settlement was not performed by Cloudflare Cron: "+JSON.stringify(cronSettled));
  }
  const playerAfterCron=await fsGet("users/"+playerUid);
  if(Number(playerAfterCron?.coins)!==22000)throw Error("cron settlement wallet mismatch");
  const cronLedger=await fsGet("financial_ledger/game_credit__"+cronOpId);
  if(!cronLedger||Number(cronLedger.delta)!==7000)throw Error("cron ledger missing");
  console.log("PASS Cloudflare Cron game settlement + wallet + ledger");

  const catalog=ok("game runtime catalog after settlement",await post("/api/game-runtime",playerToken,{action:"catalog"}));
  if(!Array.isArray(catalog.items)||catalog.items.length<3)throw Error("game catalog invalid");

  console.log("ALL CLOUDFLARE PHASE-6 SETTLEMENT E2E CHECKS PASSED");
}finally{
  for(const p of cleanup.reverse()){
    try{await fsDelete(p);}catch{}
  }
  await deleteAuth(ownerToken);
  await deleteAuth(playerToken);
}
