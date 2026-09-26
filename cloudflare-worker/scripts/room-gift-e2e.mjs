import fs from "node:fs";
import { sign } from "node:crypto";
import { normalizeRoomRocketConfig } from "../src/room-rocket.js";

const allowProductionDurableObjectE2E =
  process.env.ALLOW_PRODUCTION_DURABLE_OBJECT_E2E === "1";
if (!allowProductionDurableObjectE2E) {
  console.log("SKIP automatic Production DO Room Gift coverage");
  process.exit(0);
}

const workerBase = "https://shadow-live.ashraf-business-440.workers.dev";
let sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
if (typeof sa === "string") sa = JSON.parse(sa);
const projectId = sa.project_id;
const clientEmail = sa.client_email;
const privateKey = String(sa.private_key || "").replace(/\\n/g, "\n");
if (!projectId || !clientEmail || !privateKey) throw new Error("invalid service account");

const firebaseOptions = fs.readFileSync("lib/firebase_options.dart", "utf8");
const apiKey = firebaseOptions.match(/apiKey:\s*'([^']+)'/)?.[1];
if (!apiKey) throw new Error("Firebase API key missing");

const runId = String(process.env.GITHUB_RUN_ID || Date.now());
const senderUid = `__cf_roomgift_sender_${runId}`;
const receiverUid = `__cf_roomgift_receiver_${runId}`;
const roomId = `cf_roomgift_room_${runId}`;
const key = `cfroomgift_${runId}_${Date.now()}`;

function b64url(value) {
  return Buffer.from(value).toString("base64")
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function encodeValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "number") return Number.isInteger(value)
    ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } };
  if (typeof value === "object") {
    return { mapValue: { fields: Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, encodeValue(v)]),
    ) } };
  }
  return { stringValue: String(value) };
}
function decodeValue(value) {
  if (!value) return null;
  if ("nullValue" in value) return null;
  if ("booleanValue" in value) return value.booleanValue;
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("timestampValue" in value) return value.timestampValue;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(decodeValue);
  if ("mapValue" in value) return decodeFields(value.mapValue.fields || {});
  return null;
}
function decodeFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, decodeValue(v)]));
}
function encodeFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, encodeValue(v)]));
}
function utcPeriodKeys(date = new Date()) {
  const day = date.toISOString().slice(0,10);
  const month = day.slice(0,7);
  const d = new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate()));
  const weekday=d.getUTCDay()||7;
  d.setUTCDate(d.getUTCDate()+4-weekday);
  const yearStart=new Date(Date.UTC(d.getUTCFullYear(),0,1));
  const week=Math.ceil((((d-yearStart)/86400000)+1)/7);
  return {day,week:d.getUTCFullYear().toString()+"-W"+week.toString().padStart(2,"0"),month};
}

async function googleAccessToken() {
  const now=Math.floor(Date.now()/1000);
  const header=b64url(JSON.stringify({alg:"RS256",typ:"JWT"}));
  const payload=b64url(JSON.stringify({
    iss:clientEmail,
    scope:"https://www.googleapis.com/auth/datastore",
    aud:"https://oauth2.googleapis.com/token",
    iat:now,
    exp:now+3600,
  }));
  const unsigned=`${header}.${payload}`;
  const signature=sign("RSA-SHA256",Buffer.from(unsigned),privateKey);
  const assertion=`${unsigned}.${b64url(signature)}`;
  const res=await fetch("https://oauth2.googleapis.com/token",{
    method:"POST",
    headers:{"content-type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams({
      grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const body=await res.json();
  if(!res.ok||!body.access_token)throw new Error("google oauth failed");
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
  const unsigned=`${header}.${payload}`;
  const signature=sign("RSA-SHA256",Buffer.from(unsigned),privateKey);
  return `${unsigned}.${b64url(signature)}`;
}
async function firebaseIdToken(uid){
  const res=await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(apiKey)}`,
    {
      method:"POST",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({token:customToken(uid),returnSecureToken:true}),
    },
  );
  const body=await res.json();
  if(!res.ok||!body.idToken)throw new Error(`token exchange failed ${res.status}`);
  return body.idToken;
}

const accessToken=await googleAccessToken();
const firestoreRoot=`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)`;
const docRoot=`${firestoreRoot}/documents`;

async function fsSet(path,fields){
  const res=await fetch(`${docRoot}/${path}`,{
    method:"PATCH",
    headers:{authorization:`Bearer ${accessToken}`,"content-type":"application/json"},
    body:JSON.stringify({fields:encodeFields(fields)}),
  });
  if(!res.ok)throw new Error(`fsSet failed ${path}: ${res.status}`);
}
async function fsGet(path){
  const res=await fetch(`${docRoot}/${path}`,{headers:{authorization:`Bearer ${accessToken}`}});
  if(res.status===404)return null;
  const body=await res.json();
  if(!res.ok)throw new Error(`fsGet failed ${path}: ${res.status}`);
  return {data:decodeFields(body.fields||{})};
}
async function fsDelete(path){
  const res=await fetch(`${docRoot}/${path}`,{
    method:"DELETE",
    headers:{authorization:`Bearer ${accessToken}`},
  });
  if(!res.ok&&res.status!==404)throw new Error(`fsDelete failed ${path}: ${res.status}`);
}
async function api(idToken,extra){
  const res=await fetch(`${workerBase}/api/room-gift`,{
    method:"POST",
    headers:{
      authorization:`Bearer ${idToken}`,
      "content-type":"application/json",
      origin:"https://ashrafbusiness440-eng.github.io",
    },
    body:JSON.stringify(extra),
  });
  const body=await res.json().catch(()=>({}));
  return {res,body};
}
async function apiWhenReady(idToken,extra){
  for(let i=0;i<20;i++){
    const out=await api(idToken,extra);
    if(out.res.status!==404||out.body.code!=="route_not_found")return out;
    await new Promise(resolve=>setTimeout(resolve,1500));
  }
  throw new Error("room-gift route did not become active");
}
async function realtimePost(path,idToken,body){
  const res=await fetch(`${workerBase}${path}`,{
    method:"POST",
    headers:{
      authorization:`Bearer ${idToken}`,
      "content-type":"application/json",
      origin:"https://ashrafbusiness440-eng.github.io",
    },
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
      reject(new Error("room realtime websocket open timeout"));
    },timeoutMs);
    const onOpen=()=>{cleanup();resolve();};
    const onError=()=>{cleanup();reject(new Error("room realtime websocket open failed"));};
    const cleanup=()=>{
      clearTimeout(timer);
      socket.removeEventListener("open",onOpen);
      socket.removeEventListener("error",onError);
    };
    socket.addEventListener("open",onOpen);
    socket.addEventListener("error",onError);
  });
}
function waitForRealtimeEvent(socket,predicate,timeoutMs=10000){
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{
      cleanup();
      reject(new Error("room realtime event timeout"));
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
      reject(new Error("room realtime websocket closed before ready"));
    };
    const onError=()=>{
      cleanup();
      reject(new Error("room realtime websocket error before ready"));
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
async function openRoomRealtime(roomId,idToken){
  if(typeof WebSocket!=="function")throw new Error("node websocket unavailable");
  const ticket=await realtimePost(
    "/api/room-realtime",
    idToken,
    {action:"ticket",roomId},
  );
  if(!ticket.res.ok||ticket.body?.ok!==true||!ticket.body.socketPath){
    throw new Error(
      `room realtime ticket failed: ${ticket.res.status} ${JSON.stringify(ticket.body)}`,
    );
  }
  const url=new URL(ticket.body.socketPath,workerBase);
  url.protocol=url.protocol==="https:"?"wss:":"ws:";
  const socket=new WebSocket(url.toString());
  const ready=waitForRealtimeEvent(
    socket,
    (event)=>event?.type==="server.ready"&&event?.payload?.roomId===roomId,
  );
  await waitForSocketOpen(socket);
  await ready;
  return socket;
}
async function deleteAuthUser(idToken){
  await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${encodeURIComponent(apiKey)}`,
    {
      method:"POST",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({idToken}),
    },
  ).catch(()=>{});
}

const periods=utcPeriodKeys();
let senderToken=null;
let receiverToken=null;
let senderSocket=null;
let receiverSocket=null;
let messageId=null;
let selectedGift=null;
const cleanup=new Set([
  `users/${senderUid}`,
  `users/${receiverUid}`,
  `rooms/${roomId}`,
  `room_rocket_state/${roomId}`,
  `gift_operations/${key}`,
  `gift_transactions/${key}`,
  `financial_ledger/gift_${key}`,
  `financial_ledger/gift_earnings_${key}`,
  `rooms/${roomId}/support_daily/${periods.day}`,
  `rooms/${roomId}/support_weekly/${periods.week}`,
  `rooms/${roomId}/support_monthly/${periods.month}`,
  `rooms/${roomId}/support_daily/${periods.day}/users/${senderUid}`,
  `rooms/${roomId}/support_weekly/${periods.week}/users/${senderUid}`,
  `rooms/${roomId}/support_monthly/${periods.month}/users/${senderUid}`,
  `gift_user_stats/${receiverUid}/daily/${periods.day}`,
  `gift_user_stats/${receiverUid}/weekly/${periods.week}`,
  `gift_user_stats/${receiverUid}/monthly/${periods.month}`,
]);

try{
  const [catalogDoc,rocketConfigDoc]=await Promise.all([
    fsGet("system_config/gift_catalog"),
    fsGet("system_config/room_rocket"),
  ]);
  const fallback=[
    {id:"rose",nameAr:"وردة",priceCoins:100,enabled:true,assetKey:"gifts.placeholder.default"},
    {id:"coffee",nameAr:"قهوة",priceCoins:300,enabled:true,assetKey:"gifts.placeholder.default"},
  ];
  const rawCatalog=Array.isArray(catalogDoc?.data?.gifts)&&catalogDoc.data.gifts.length
    ?catalogDoc.data.gifts
    :fallback;
  const enabled=rawCatalog
    .filter(item=>item?.enabled!==false&&Number.isSafeInteger(Number(item?.priceCoins))&&Number(item.priceCoins)>0)
    .sort((a,b)=>Number(a.priceCoins)-Number(b.priceCoins));
  selectedGift=enabled[0];
  if(!selectedGift)throw new Error("no enabled gift for room E2E");

  const rocketPolicy=normalizeRoomRocketConfig(rocketConfigDoc?.data||{});
  let maxIndex=0;
  for(let i=1;i<rocketPolicy.levels.length;i++){
    if(rocketPolicy.levels[i].thresholdCoins>rocketPolicy.levels[maxIndex].thresholdCoins)maxIndex=i;
  }
  const threshold=rocketPolicy.levels[maxIndex].thresholdCoins;
  const totalCost=Number(selectedGift.priceCoins);
  if(totalCost>=threshold){
    throw new Error(`cheapest gift ${totalCost} would trigger shared rocket queue threshold ${threshold}`);
  }

  const senderOpening=Math.max(100000000,totalCost*10);
  const nowMs=Date.now();
  await fsSet(`users/${senderUid}`,{
    displayName:"Cloudflare Room Gift Sender",
    role:"user",
    coins:senderOpening,
    diamonds:0,
    createdAt:new Date(),
  });
  await fsSet(`users/${receiverUid}`,{
    displayName:"Cloudflare Room Gift Receiver",
    role:"user",
    coins:0,
    diamonds:0,
    agencyId:"",
    pendingGiftEarningCoins:0,
    giftRevenueMonth:periods.month,
    giftRevenueMonthCoins:0,
    giftHostActivityMonth:periods.month,
    giftHostQualifiedDays:0,
    createdAt:new Date(),
  });
  await fsSet(`rooms/${roomId}`,{
    name:"Cloudflare Room Gift E2E",
    publicId:"99112233",
    ownerUid:receiverUid,
    isActive:true,
    totalSupport:0,
    dailySupport:0,
    weeklySupport:0,
    monthlySupport:0,
    createdAt:new Date(),
  });
  await fsSet(`room_rocket_state/${roomId}`,{
    cycleNumber:1,
    levelIndex:maxIndex,
    currentLevel:maxIndex+1,
    progressCoins:0,
    levelThresholdCoins:threshold,
    levelContributors:{},
    queueAvailableAtMs:0,
    explosionSequence:0,
  });

  [senderToken,receiverToken]=await Promise.all([
    firebaseIdToken(senderUid),
    firebaseIdToken(receiverUid),
  ]);
  [senderSocket,receiverSocket]=await Promise.all([
    openRoomRealtime(roomId,senderToken),
    openRoomRealtime(roomId,receiverToken),
  ]);
  console.log("PASS sender + receiver realtime room presence");

  const sent=await apiWhenReady(senderToken,{
    roomId,
    receiverId:receiverUid,
    giftId:String(selectedGift.id),
    quantity:1,
    idempotencyKey:key,
  });
  if(!sent.res.ok||sent.body.ok!==true||!sent.body.messageId){
    throw new Error(`room gift failed: ${sent.res.status} ${JSON.stringify(sent.body)}`);
  }
  if(Array.isArray(sent.body.rocketExplosionIds)&&sent.body.rocketExplosionIds.length){
    throw new Error("room gift E2E unexpectedly triggered rocket explosion");
  }
  messageId=sent.body.messageId;
  cleanup.add(`rooms/${roomId}/messages/${messageId}`);
  cleanup.add(`public_gift_showcases/${receiverUid}/items/${String(selectedGift.id)}`);

  const [senderAfter,roomAfter,rocketAfter,txDoc,ledgerDoc,msgDoc]=await Promise.all([
    fsGet(`users/${senderUid}`),
    fsGet(`rooms/${roomId}`),
    fsGet(`room_rocket_state/${roomId}`),
    fsGet(`gift_transactions/${key}`),
    fsGet(`financial_ledger/gift_${key}`),
    fsGet(`rooms/${roomId}/messages/${messageId}`),
  ]);

  if(senderAfter?.data?.coins!==senderOpening-totalCost){
    throw new Error("sender room-gift debit mismatch");
  }
  if(roomAfter?.data?.totalSupport!==totalCost||
     roomAfter?.data?.dailySupport!==totalCost||
     roomAfter?.data?.weeklySupport!==totalCost||
     roomAfter?.data?.monthlySupport!==totalCost){
    throw new Error(`room support mismatch: ${JSON.stringify(roomAfter?.data)}`);
  }
  if(rocketAfter?.data?.progressCoins!==totalCost){
    throw new Error(`rocket progress mismatch: ${rocketAfter?.data?.progressCoins}`);
  }
  if(!txDoc||txDoc.data.contextType!=="room"||txDoc.data.totalCost!==totalCost){
    throw new Error("room gift transaction mismatch");
  }
  if(!ledgerDoc||ledgerDoc.data.delta!==-totalCost){
    throw new Error("room gift ledger mismatch");
  }
  if(!msgDoc||msgDoc.data.type!=="gift"||msgDoc.data.giftId!==String(selectedGift.id)){
    throw new Error("room gift message mismatch");
  }
  console.log("PASS room gift accounting + support + rocket progress");

  const duplicate=await api(senderToken,{
    roomId,
    receiverId:receiverUid,
    giftId:String(selectedGift.id),
    quantity:1,
    idempotencyKey:key,
  });
  if(!duplicate.res.ok||duplicate.body.code!=="duplicate"){
    throw new Error(`room gift idempotency failed: ${duplicate.res.status} ${JSON.stringify(duplicate.body)}`);
  }
  const senderAfterDup=await fsGet(`users/${senderUid}`);
  const roomAfterDup=await fsGet(`rooms/${roomId}`);
  if(senderAfterDup?.data?.coins!==senderOpening-totalCost||
     roomAfterDup?.data?.totalSupport!==totalCost){
    throw new Error("duplicate room gift mutated balances or support");
  }
  console.log("PASS room gift idempotency");
  console.log("ALL CLOUDFLARE ROOM GIFT E2E CHECKS PASSED");
}finally{
  for(const socket of [senderSocket,receiverSocket]){
    if(!socket)continue;
    try{socket.close(1000,"room_gift_e2e_done");}catch{}
  }
  for(const path of [...cleanup].reverse()){
    try{await fsDelete(path);}catch(error){
      console.warn(`cleanup warning ${path}: ${error.message}`);
    }
  }
  if(senderToken)await deleteAuthUser(senderToken);
  if(receiverToken)await deleteAuthUser(receiverToken);
}
