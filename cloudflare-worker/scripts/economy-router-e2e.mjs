import fs from "node:fs";
import { sign } from "node:crypto";
import { firestoreE2eFetch, sleep } from "./firestore-e2e-retry.mjs";

const workerBase="https://shadow-live.ashraf-business-440.workers.dev";
let sa=JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT||"{}");
if(typeof sa==="string")sa=JSON.parse(sa);
const projectId=sa.project_id;
const clientEmail=sa.client_email;
const privateKey=String(sa.private_key||"").replace(/\\n/g,"\n");
if(!projectId||!clientEmail||!privateKey)throw new Error("invalid service account");

const firebaseOptions=fs.readFileSync("lib/firebase_options.dart","utf8");
const apiKey=firebaseOptions.match(/apiKey:\s*'([^']+)'/)?.[1];
if(!apiKey)throw new Error("Firebase API key missing");

const runId=String(process.env.GITHUB_RUN_ID||Date.now());
const ownerUid=`__cf_economy_owner_${runId}`;
const userUid=`__cf_economy_user_${runId}`;

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
async function googleAccessToken(){
  const now=Math.floor(Date.now()/1000);
  const header=b64url(JSON.stringify({alg:"RS256",typ:"JWT"}));
  const payload=b64url(JSON.stringify({
    iss:clientEmail,
    scope:"https://www.googleapis.com/auth/datastore",
    aud:"https://oauth2.googleapis.com/token",
    iat:now,exp:now+3600,
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
const docRoot=`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
async function fsSet(path,fields){
  const res=await firestoreE2eFetch(`${docRoot}/${path}`,{
    method:"PATCH",
    headers:{authorization:`Bearer ${accessToken}`,"content-type":"application/json"},
    body:JSON.stringify({fields:encodeFields(fields)}),
  });
  if(!res.ok)throw new Error(`fsSet failed ${path}: ${res.status}`);
}
async function fsDelete(path){
  const res=await firestoreE2eFetch(`${docRoot}/${path}`,{method:"DELETE",headers:{authorization:`Bearer ${accessToken}`}});
  if(!res.ok&&res.status!==404)throw new Error(`fsDelete failed ${path}: ${res.status}`);
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
async function directApi(endpoint,idToken,body={}){
  const res=await fetch(`${workerBase}/api/${endpoint}`,{
    method:"POST",
    headers:{
      ...(idToken?{authorization:`Bearer ${idToken}`}:{}),
      "content-type":"application/json",
      origin:"https://ashrafbusiness440-eng.github.io",
    },
    body:JSON.stringify(body),
  });
  const data=await res.json().catch(()=>({}));
  return {res,body:data};
}
async function api(route,idToken,body={},method="POST",extraQuery=""){
  const query="route="+encodeURIComponent(route)+(extraQuery?"&"+extraQuery:"");
  const res=await fetch(`${workerBase}/api/economy-router?${query}`,{
    method,
    headers:{
      ...(idToken?{authorization:`Bearer ${idToken}`}:{}),
      ...(method==="POST"?{"content-type":"application/json"}:{}),
      origin:"https://ashrafbusiness440-eng.github.io",
    },
    ...(method==="POST"?{body:JSON.stringify(body)}:{}),
  });
  const data=await res.json().catch(()=>({}));
  return {res,body:data};
}
function expectOk(label,out,check=()=>true){
  if(!out.res.ok||out.body?.ok!==true||!check(out.body)){
    throw new Error(`${label} failed: ${out.res.status} ${JSON.stringify(out.body)}`);
  }
  console.log(`PASS ${label}`);
}

let ownerToken=null,userToken=null;
try{
  await fsSet(`users/${ownerUid}`,{
    displayName:"Cloudflare Economy Owner",
    username:"cf_economy_owner",
    role:"owner",
    adminEnabled:true,
    capabilities:["manageEconomy","manageGames","adjustBalances","manageSettlements"],
    coins:100000,
    diamonds:0,
    createdAt:new Date(),
  });
  await fsSet(`users/${userUid}`,{
    displayName:"Cloudflare Economy User",
    username:"cf_economy_user",
    role:"user",
    adminEnabled:false,
    capabilities:[],
    coins:100000,
    diamonds:0,
    createdAt:new Date(),
  });
  ownerToken=await firebaseIdToken(ownerUid);
  userToken=await firebaseIdToken(userUid);
  await sleep(750);

  const unknown=await api("not-a-route",ownerToken,{action:"state"});
  if(unknown.res.status!==404||unknown.body.code!=="route_not_found"){
    throw new Error(`router 404 failed: ${unknown.res.status} ${JSON.stringify(unknown.body)}`);
  }
  console.log("PASS router unknown-route guard");

  expectOk(
    "game-runtime catalog read under auth lookup pressure",
    await api("game-runtime",userToken,{action:"catalog"}),
    (b)=>Array.isArray(b.items)&&b.items.some((item)=>item.gameId==="greedy_cat"),
  );
  expectOk(
    "game-runtime greedy state read under auth lookup pressure",
    await api("game-runtime",userToken,{action:"state",gameId:"greedy_cat"}),
    (b)=>b.gameId==="greedy_cat"&&b.round&&typeof b.serverNowMs==="number",
  );

  const noAuth=await api("economy-control",null,{action:"state"});
  if(noAuth.res.status!==401||noAuth.body.code!=="unauthorized"){
    throw new Error(`economy auth guard failed: ${noAuth.res.status} ${JSON.stringify(noAuth.body)}`);
  }
  console.log("PASS economy auth guard");

  expectOk("economy-control state",await api("economy-control",ownerToken,{action:"state"}),(b)=>typeof b.emergencyLock==="object");
  expectOk("gift-catalog state",await api("gift-catalog",ownerToken,{action:"state"}),(b)=>typeof b.exists==="boolean"&&Object.prototype.hasOwnProperty.call(b,"config"));
  expectOk("gift-economy-config state",await api("gift-economy-config",ownerToken,{action:"state"}),(b)=>b.config&&typeof b.config==="object");
  expectOk("recharge-config state",await api("recharge-config",ownerToken,{action:"state"}),(b)=>typeof b.exists==="boolean"&&Object.prototype.hasOwnProperty.call(b,"config"));
  expectOk("room-rocket-config state",await api("room-rocket-config",ownerToken,{action:"state"}),(b)=>b.config&&typeof b.config==="object");
  expectOk("reward-inventory list",await api("reward-inventory",userToken,{action:"list"}),(b)=>Array.isArray(b.items));
  expectOk("game-runtime catalog",await api("game-runtime",userToken,{action:"catalog"}),(b)=>Array.isArray(b.items));
  expectOk("game-control state",await api("game-control",ownerToken,{action:"state"}),(b)=>Array.isArray(b.variants));
  expectOk("economy-control direct alias",await directApi("economy-control",ownerToken,{action:"state"}),(b)=>typeof b.emergencyLock==="object");
  expectOk("game-runtime direct alias",await directApi("game-runtime",userToken,{action:"catalog"}),(b)=>Array.isArray(b.items));

  const rocket=await api("room-rocket",userToken,{action:"enter",explosionId:"!"});
  if(rocket.res.status!==400||rocket.body.code!=="invalid_explosion_id"){
    throw new Error(`room-rocket validation failed: ${rocket.res.status} ${JSON.stringify(rocket.body)}`);
  }
  console.log("PASS room-rocket runtime validation");

  const forbidden=await api("game-control",userToken,{action:"state"});
  if(forbidden.res.status!==403||forbidden.body.code!=="forbidden"){
    throw new Error(`game-control permission guard failed: ${forbidden.res.status} ${JSON.stringify(forbidden.body)}`);
  }
  console.log("PASS game-control permission guard");

  console.log("ALL CLOUDFLARE ECONOMY ROUTER PHASE-5 E2E CHECKS PASSED");
}finally{
  for(const path of [`users/${ownerUid}`,`users/${userUid}`]){
    try{await fsDelete(path);}catch{}
  }
  if(ownerToken)await deleteAuthUser(ownerToken);
  if(userToken)await deleteAuthUser(userToken);
}
