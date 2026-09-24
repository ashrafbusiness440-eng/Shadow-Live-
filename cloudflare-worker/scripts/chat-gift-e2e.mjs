import fs from "node:fs";
import { sign } from "node:crypto";
import { resolveRevenuePolicy } from "../src/economy-policy.js";

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
const senderUid = `__cf_gift_sender_${runId}`;
const receiverUid = `__cf_gift_receiver_${runId}`;
const conversationId = `cf_gift_conv_${runId}`;
const key = `cfgift_${runId}_${Date.now()}`;

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
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const weekday = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return {
    day,
    week: d.getUTCFullYear().toString() + "-W" + week.toString().padStart(2,"0"),
    month,
  };
}

async function googleAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg:"RS256", typ:"JWT" }));
  const payload = b64url(JSON.stringify({
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${payload}`;
  const signature = sign("RSA-SHA256", Buffer.from(unsigned), privateKey);
  const assertion = `${unsigned}.${b64url(signature)}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method:"POST",
    headers:{"content-type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams({
      grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const body = await res.json();
  if (!res.ok || !body.access_token) throw new Error("google oauth failed");
  return body.access_token;
}
function customToken(uid) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({alg:"RS256",typ:"JWT"}));
  const payload = b64url(JSON.stringify({
    iss:clientEmail,
    sub:clientEmail,
    aud:"https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit",
    iat:now,
    exp:now+3600,
    uid,
  }));
  const unsigned=`${header}.${payload}`;
  const signature=sign("RSA-SHA256",Buffer.from(unsigned),privateKey);
  return `${unsigned}.${b64url(signature)}`;
}
async function firebaseIdToken(uid) {
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
  const res=await fetch(`${workerBase}/api/chat-actions`,{
    method:"POST",
    headers:{
      authorization:`Bearer ${idToken}`,
      "content-type":"application/json",
      origin:"https://ashrafbusiness440-eng.github.io",
    },
    body:JSON.stringify({action:"sendGift",...extra}),
  });
  const body=await res.json().catch(()=>({}));
  return {res,body};
}
async function apiWhenMigrated(idToken,extra){
  for(let i=0;i<20;i++){
    const out=await api(idToken,extra);
    if(!(out.res.status===400&&out.body.code==="action_not_migrated"))return out;
    await new Promise(resolve=>setTimeout(resolve,1500));
  }
  throw new Error("sendGift migration did not become active");
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

const fallback=[
  {id:"rose",nameAr:"وردة",priceCoins:100,enabled:true,assetKey:"gifts.placeholder.default"},
  {id:"coffee",nameAr:"قهوة",priceCoins:300,enabled:true,assetKey:"gifts.placeholder.default"},
];

let senderToken=null;
let messageId=null;
let selectedGift=null;
const periods=utcPeriodKeys();
const cleanup=new Set([
  `users/${senderUid}`,
  `users/${receiverUid}`,
  `conversations/${conversationId}`,
  `gift_operations/${key}`,
  `gift_transactions/${key}`,
  `financial_ledger/gift_${key}`,
  `financial_ledger/gift_earnings_${key}`,
]);

try{
  const catalogDoc=await fsGet("system_config/gift_catalog");
  const economyDoc=await fsGet("system_config/gift_economy");
  const rawCatalog=Array.isArray(catalogDoc?.data?.gifts)&&catalogDoc.data.gifts.length
    ?catalogDoc.data.gifts
    :fallback;
  selectedGift=rawCatalog.find(item=>item?.enabled!==false&&Number.isSafeInteger(Number(item?.priceCoins))&&Number(item.priceCoins)>0);
  if(!selectedGift)throw new Error("no enabled gift available for E2E");

  const quantity=1;
  const totalCost=Number(selectedGift.priceCoins)*quantity;
  const senderOpening=Math.max(100000000,totalCost*10);
  const economy=economyDoc?.data||{};
  const receiverData={
    role:"user",
    agencyId:"",
    diamonds:0,
    pendingGiftEarningCoins:0,
    giftRevenueMonth:periods.month,
    giftRevenueMonthCoins:0,
    giftHostActivityMonth:periods.month,
    giftHostQualifiedDays:0,
  };
  const expectedRevenue=resolveRevenuePolicy(
    economy,
    receiverData,
    totalCost,
    "",
    periods.month,
    0,
  );
  const policyEnabled=economy.enabled!==false;
  const earningsEnabled=policyEnabled&&expectedRevenue.hostShareBps>0;
  const expectedRecipientShare=earningsEnabled
    ?Math.floor(totalCost*expectedRevenue.hostShareBps/10000)
    :0;
  const expectedDiamonds=earningsEnabled
    ?Math.floor(expectedRecipientShare/10000)
    :0;
  const expectedPending=earningsEnabled
    ?expectedRecipientShare%10000
    :0;

  await fsSet(`users/${senderUid}`,{
    displayName:"Cloudflare Gift Sender",
    role:"user",
    coins:senderOpening,
    diamonds:0,
    createdAt:new Date(),
  });
  await fsSet(`users/${receiverUid}`,{
    displayName:"Cloudflare Gift Receiver",
    ...receiverData,
    coins:0,
    createdAt:new Date(),
  });
  await fsSet(`conversations/${conversationId}`,{
    participants:[senderUid,receiverUid].sort(),
    unreadCounts:{[senderUid]:0,[receiverUid]:0},
    createdAt:new Date(),
    updatedAt:new Date(),
  });

  senderToken=await firebaseIdToken(senderUid);

  const sent=await apiWhenMigrated(senderToken,{
    receiverId:receiverUid,
    giftId:String(selectedGift.id),
    quantity,
    conversationId,
    idempotencyKey:key,
  });
  if(!sent.res.ok||sent.body.ok!==true||!sent.body.messageId){
    throw new Error(`chat gift failed: ${sent.res.status} ${JSON.stringify(sent.body)}`);
  }
  messageId=sent.body.messageId;
  cleanup.add(`conversations/${conversationId}/messages/${messageId}`);
  cleanup.add(`gift_user_stats/${receiverUid}/daily/${periods.day}`);
  cleanup.add(`gift_user_stats/${receiverUid}/weekly/${periods.week}`);
  cleanup.add(`gift_user_stats/${receiverUid}/monthly/${periods.month}`);
  cleanup.add(`public_gift_showcases/${receiverUid}/items/${String(selectedGift.id)}`);

  const [senderAfter,receiverAfter,txDoc,ledgerDoc,msgDoc]=await Promise.all([
    fsGet(`users/${senderUid}`),
    fsGet(`users/${receiverUid}`),
    fsGet(`gift_transactions/${key}`),
    fsGet(`financial_ledger/gift_${key}`),
    fsGet(`conversations/${conversationId}/messages/${messageId}`),
  ]);

  if(senderAfter?.data?.coins!==senderOpening-totalCost){
    throw new Error(`sender debit mismatch: ${senderAfter?.data?.coins}`);
  }
  if(!txDoc||txDoc.data.totalCost!==totalCost||txDoc.data.contextType!=="chat"){
    throw new Error("gift transaction mismatch");
  }
  if(!ledgerDoc||ledgerDoc.data.delta!==-totalCost){
    throw new Error("gift debit ledger mismatch");
  }
  if(!msgDoc||msgDoc.data.giftId!==String(selectedGift.id)){
    throw new Error("gift message mismatch");
  }
  if(sent.body.recipientShareCoins!==expectedRecipientShare||
     sent.body.diamondsEarned!==expectedDiamonds){
    throw new Error(`revenue policy mismatch: ${JSON.stringify(sent.body)}`);
  }
  if(earningsEnabled&&receiverAfter?.data?.pendingGiftEarningCoins!==expectedPending){
    throw new Error("receiver pending earnings mismatch");
  }
  if(earningsEnabled&&receiverAfter?.data?.diamonds!==expectedDiamonds){
    throw new Error("receiver diamonds mismatch");
  }
  console.log("PASS chat gift accounting");

  const duplicate=await api(senderToken,{
    receiverId:receiverUid,
    giftId:String(selectedGift.id),
    quantity,
    conversationId,
    idempotencyKey:key,
  });
  if(!duplicate.res.ok||duplicate.body.code!=="duplicate"){
    throw new Error(`gift idempotency failed: ${duplicate.res.status} ${JSON.stringify(duplicate.body)}`);
  }
  const senderAfterDup=await fsGet(`users/${senderUid}`);
  if(senderAfterDup?.data?.coins!==senderOpening-totalCost){
    throw new Error("duplicate gift mutated sender balance");
  }
  console.log("PASS chat gift idempotency");
  console.log("ALL CLOUDFLARE CHAT GIFT E2E CHECKS PASSED");
}finally{
  for(const path of [...cleanup].reverse()){
    try{await fsDelete(path);}catch(error){
      console.warn(`cleanup warning ${path}: ${error.message}`);
    }
  }
  if(senderToken)await deleteAuthUser(senderToken);
}
