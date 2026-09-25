// GAME_RNG_SECRET verification rerun
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
const roomId="phase6_room_"+runId;
const slotKey="phase6slot_"+runId;
const slotOpId=playerUid+"__"+slotKey;
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
  const res=await fetch("https://identitytoolkit.googleapis.com/v1/accounts:delete?key="+encodeURIComponent(apiKey),{
    method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({idToken}),
  });
  if(!res.ok)throw Error("deleteAuth failed "+res.status+" "+await res.text());
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
function waitForSocketOpen(socket,timeoutMs=10000){
  if(socket.readyState===WebSocket.OPEN)return Promise.resolve();
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{
      cleanup();
      reject(Error("room realtime websocket open timeout"));
    },timeoutMs);
    const onOpen=()=>{cleanup();resolve();};
    const onError=()=>{cleanup();reject(Error("room realtime websocket open failed"));};
    const cleanup=()=>{
      clearTimeout(timer);
      socket.removeEventListener("open",onOpen);
      socket.removeEventListener("error",onError);
    };
    socket.addEventListener("open",onOpen);
    socket.addEventListener("error",onError);
  });
}
function waitForRealtimeEvent(socket,predicate,timeoutMs=35000){
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{
      cleanup();
      reject(Error("room realtime event timeout"));
    },timeoutMs);
    const onMessage=(event)=>{
      let data=null;
      try{data=JSON.parse(String(event?.data||""));}catch{return;}
      if(!predicate(data))return;
      cleanup();
      resolve(data);
    };
    const onClose=()=>{
      cleanup();
      reject(Error("room realtime websocket closed before expected event"));
    };
    const onError=()=>{
      cleanup();
      reject(Error("room realtime websocket error before expected event"));
    };
    const cleanup=()=>{
      clearTimeout(timer);
      socket.removeEventListener("message",onMessage);
      socket.removeEventListener("close",onClose);
      socket.removeEventListener("error",onError);
    };
    socket.addEventListener("message",onMessage);
    socket.addEventListener("close",onClose);
    socket.addEventListener("error",onError);
  });
}
async function openRoomRealtime(roomId,token){
  if(typeof WebSocket!=="function")throw Error("node websocket unavailable");
  const ticket=ok(
    "room realtime ticket",
    await post("/api/room-realtime",token,{action:"ticket",roomId}),
  );
  if(!ticket.socketPath)throw Error("room realtime socketPath missing");
  const url=new URL(ticket.socketPath,base);
  url.protocol=url.protocol==="https:"?"wss:":"ws:";
  const socket=new WebSocket(url.toString());
  const ready=waitForRealtimeEvent(
    socket,
    (event)=>event?.type==="server.ready"&&event?.payload?.roomId===roomId,
    10000,
  );
  await waitForSocketOpen(socket,10000);
  await ready;
  return socket;
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
  const marker=await fsGet("system_runtime/game_settlement_cron");
  throw Error("Cloudflare cron did not settle due game operation; marker="+JSON.stringify(marker));
}

let ownerToken=null,playerToken=null;
let realtimeSocket=null,realtimeKeepalive=null;
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
  "rooms/"+roomId,
  "game_operations/"+slotOpId,
  "financial_ledger/game_debit__"+slotOpId,
  "financial_ledger/game_credit__"+slotOpId,
  "game_user_history/"+playerUid+"/items/"+slotOpId,
  "users/"+ownerUid,
  "users/"+playerUid,
  "users/"+hostUid,
];
for(let d=16;d<=24;d++)cleanup.push("host_mic_activity/"+hostUid+"/days/"+month+"-"+String(d).padStart(2,"0"));

try{
  await fsSet("users/"+ownerUid,{displayName:"Phase6 Owner",role:"owner",adminEnabled:true,capabilities:[],coins:0,diamonds:0});
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

  await fsSet("rooms/"+roomId,{
    name:"Phase6 E2E Room",
    isActive:true,
    ownerId:playerUid,
  });
  realtimeSocket=await openRoomRealtime(roomId,playerToken);
  realtimeKeepalive=setInterval(()=>{
    try{
      if(realtimeSocket?.readyState===WebSocket.OPEN)realtimeSocket.send("ping");
    }catch{}
  },15000);

  const gamePush=waitForRealtimeEvent(
    realtimeSocket,
    (event)=>String(event?.type||"").startsWith("game.")&&
      event?.payload?.roomId===roomId&&
      event?.payload?.gameId==="greedy_cat",
    35000,
  );
  const realtimeState=ok(
    "greedy realtime state registration",
    await post("/api/game-runtime",playerToken,{
      action:"state",
      gameId:"greedy_cat",
      roomId,
    }),
  );
  if(realtimeState.gameId!=="greedy_cat"||!realtimeState.round){
    throw Error("greedy realtime state payload invalid");
  }
  const pushedGameEvent=await gamePush;
  if(![
    "game.round_started",
    "game.betting_closed",
    "game.result",
    "game.next_round",
  ].includes(pushedGameEvent.type)){
    throw Error("unexpected pushed game event "+String(pushedGameEvent.type||""));
  }
  console.log("PASS room websocket game event "+pushedGameEvent.type);

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
  const slot=catalog.items.find((item)=>item.gameId==="slot");
  if(!slot||!Array.isArray(slot.bets)||!slot.bets.length)throw Error("slot catalog missing");
  const slotBet=Number(slot.bets[0]);
  if(realtimeSocket?.readyState!==WebSocket.OPEN){
    throw Error("room realtime websocket not open before slot bet");
  }

  const beforeSlot=Number((await fsGet("users/"+playerUid))?.coins||0);
  const slotResult=ok("real slot bet through Cloudflare",await post("/api/game-runtime",playerToken,{
    action:"placeBet",
    gameId:"slot",
    roomId,
    idempotencyKey:slotKey,
    bets:[{amountCoins:slotBet}],
  }));
  if(slotResult.status!=="settled"||slotResult.operationId!==slotOpId)throw Error("slot operation not settled");
  if(!Array.isArray(slotResult.reels)||slotResult.reels.length!==3)throw Error("slot reels missing");
  const slotOp=await fsGet("game_operations/"+slotOpId);
  if(!slotOp||slotOp.status!=="settled")throw Error("slot operation missing");
  if(slotOp.roundId)cleanup.push("game_rounds/"+slotOp.roundId);
  const slotUser=await fsGet("users/"+playerUid);
  if(Number(slotUser?.coins)!==Number(slotResult.balanceAfter))throw Error("slot wallet mismatch");
  const slotDebit=await fsGet("financial_ledger/game_debit__"+slotOpId);
  if(!slotDebit||Number(slotDebit.delta)!==-slotBet)throw Error("slot debit ledger missing");
  if(Number(slotResult.payoutCoins||0)>0){
    const slotCredit=await fsGet("financial_ledger/game_credit__"+slotOpId);
    if(!slotCredit||Number(slotCredit.delta)!==Number(slotResult.payoutCoins))throw Error("slot credit ledger missing");
  }
  const afterSlot=Number(slotUser?.coins||0);
  const slotDuplicate=ok("real slot bet idempotency",await post("/api/game-runtime",playerToken,{
    action:"placeBet",
    gameId:"slot",
    roomId,
    idempotencyKey:slotKey,
    bets:[{amountCoins:slotBet}],
  }));
  if(slotDuplicate.code!=="duplicate")throw Error("slot duplicate guard failed");
  if(Number((await fsGet("users/"+playerUid))?.coins)!==afterSlot)throw Error("slot duplicate changed wallet");
  console.log("PASS real slot wallet + ledger + RNG + idempotency");

  console.log("ALL CLOUDFLARE PHASE-6 SETTLEMENT AND GAME E2E CHECKS PASSED");
}finally{
  if(realtimeKeepalive)clearInterval(realtimeKeepalive);
  if(realtimeSocket){
    try{realtimeSocket.close(1000,"phase6_e2e_done");}catch{}
    await new Promise(r=>setTimeout(r,200));
  }
  const cleanupErrors=[];
  for(const p of cleanup.reverse()){
    try{await fsDelete(p);}
    catch(error){cleanupErrors.push(String(error?.message||error));}
  }
  for(const token of [ownerToken,playerToken]){
    try{await deleteAuth(token);}
    catch(error){cleanupErrors.push(String(error?.message||error));}
  }
  if(cleanupErrors.length){
    throw Error("Phase6 E2E cleanup failed: "+cleanupErrors.join(" | "));
  }
}
