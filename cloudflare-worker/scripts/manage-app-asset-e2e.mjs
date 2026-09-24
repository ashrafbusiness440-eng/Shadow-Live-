import fs from "node:fs";
import { sign } from "node:crypto";

const workerBase = "https://shadow-live.ashraf-business-440.workers.dev";
let sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
if (typeof sa === "string") sa = JSON.parse(sa);
const projectId = sa.project_id;
const clientEmail = sa.client_email;
const privateKey = String(sa.private_key || "").replace(/\\n/g, "\n");
const githubToken = String(process.env.GITHUB_ASSET_TOKEN || "").trim();
if (!projectId || !clientEmail || !privateKey) throw new Error("invalid service account");
if (!githubToken) throw new Error("GITHUB_ASSET_TOKEN missing");

const firebaseOptions = fs.readFileSync("lib/firebase_options.dart", "utf8");
const apiKey = firebaseOptions.match(/apiKey:\s*'([^']+)'/)?.[1];
if (!apiKey) throw new Error("Firebase API key missing");

const runId = String(process.env.GITHUB_RUN_ID || Date.now());
const ownerUid = `__cf_asset_owner_${runId}`;
const userUid = `__cf_asset_user_${runId}`;
const assetKey = `misc.cf_asset_e2e_${runId}`;
const fileName = `cf_asset_e2e_${runId}.png`;
const fullPath = `assets/images/misc/${fileName}`;
const operationKey = `cfasset_${runId}_${Date.now()}`;
const pngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=";

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
async function googleAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg:"RS256",typ:"JWT" }));
  const payload = b64url(JSON.stringify({
    iss:clientEmail,
    scope:"https://www.googleapis.com/auth/datastore",
    aud:"https://oauth2.googleapis.com/token",
    iat:now,
    exp:now+3600,
  }));
  const unsigned = `${header}.${payload}`;
  const signature = sign("RSA-SHA256",Buffer.from(unsigned),privateKey);
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
  if(!res.ok||!body.access_token)throw new Error("google oauth failed");
  return body.access_token;
}
function customToken(uid) {
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
async function auditDocs(){
  const res=await fetch(`${firestoreRoot}/documents:runQuery`,{
    method:"POST",
    headers:{authorization:`Bearer ${accessToken}`,"content-type":"application/json"},
    body:JSON.stringify({
      structuredQuery:{
        from:[{collectionId:"admin_audit_logs"}],
        where:{fieldFilter:{
          field:{fieldPath:"operationId"},
          op:"EQUAL",
          value:{stringValue:operationKey},
        }},
        limit:10,
      },
    }),
  });
  const body=await res.json();
  if(!res.ok)return [];
  return body.map(row=>row.document?.name).filter(Boolean)
    .map(name=>name.split("/documents/")[1]);
}
async function api(idToken,method,payload=null){
  const res=await fetch(`${workerBase}/api/manage-app-asset`,{
    method,
    headers:{
      ...(idToken?{authorization:`Bearer ${idToken}`}:{}),
      ...(payload?{"content-type":"application/json"}:{}),
      origin:"https://ashrafbusiness440-eng.github.io",
    },
    ...(payload?{body:JSON.stringify(payload)}:{}),
  });
  const body=await res.json().catch(()=>({}));
  return {res,body};
}
async function github(path,options={}){
  const res=await fetch(`https://api.github.com/repos/ashrafbusiness440-eng/Shadow-Live-/contents/${path}`,{
    ...options,
    headers:{
      accept:"application/vnd.github+json",
      authorization:`Bearer ${githubToken}`,
      "x-github-api-version":"2022-11-28",
      ...(options.headers||{}),
    },
  });
  const body=await res.json().catch(()=>({}));
  return {res,body};
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

let ownerToken=null;
let userToken=null;
let githubSha=null;
let probeSha=null;
const probePath=`assets/images/misc/cf_token_probe_${runId}.txt`;
try{
  const repoCheck=await fetch("https://api.github.com/repos/ashrafbusiness440-eng/Shadow-Live-",{
    headers:{
      accept:"application/vnd.github+json",
      authorization:`Bearer ${githubToken}`,
      "x-github-api-version":"2022-11-28",
    },
  });
  const repoCheckBody=await repoCheck.json().catch(()=>({}));
  if(!repoCheck.ok){
    throw new Error(`GitHub token repo access failed: ${repoCheck.status} ${repoCheckBody?.message||""}`);
  }
  console.log("PASS GitHub token repository access");

  const probeWrite=await github(probePath,{
    method:"PUT",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({
      message:"Cloudflare asset token permission probe",
      content:Buffer.from("shadow-live-asset-token-probe").toString("base64"),
      branch:"main",
    }),
  });
  if(!probeWrite.res.ok||!probeWrite.body?.content?.sha){
    throw new Error(`GitHub token direct write probe failed: ${probeWrite.res.status} ${probeWrite.body?.message||JSON.stringify(probeWrite.body)}`);
  }
  probeSha=String(probeWrite.body.content.sha);
  console.log("PASS GitHub token direct write probe");

  const probeDelete=await github(probePath,{
    method:"DELETE",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({
      message:"Cleanup Cloudflare asset token permission probe",
      sha:probeSha,
      branch:"main",
    }),
  });
  if(!probeDelete.res.ok){
    throw new Error(`GitHub token direct delete probe failed: ${probeDelete.res.status} ${probeDelete.body?.message||JSON.stringify(probeDelete.body)}`);
  }
  probeSha=null;
  console.log("PASS GitHub token direct delete probe");
  await fsSet(`users/${ownerUid}`,{
    displayName:"Cloudflare Asset Owner",
    role:"owner",
    adminEnabled:true,
    createdAt:new Date(),
  });
  await fsSet(`users/${userUid}`,{
    displayName:"Cloudflare Asset User",
    role:"user",
    adminEnabled:false,
    createdAt:new Date(),
  });
  ownerToken=await firebaseIdToken(ownerUid);
  userToken=await firebaseIdToken(userUid);

  const noAuth=await api(null,"GET");
  if(noAuth.res.status!==401||noAuth.body.code!=="unauthorized"){
    throw new Error(`unauthorized guard failed: ${noAuth.res.status} ${JSON.stringify(noAuth.body)}`);
  }
  console.log("PASS asset unauthorized guard");

  const forbidden=await api(userToken,"GET");
  if(forbidden.res.status!==403||forbidden.body.code!=="forbidden"){
    throw new Error(`owner guard failed: ${forbidden.res.status} ${JSON.stringify(forbidden.body)}`);
  }
  console.log("PASS asset owner-only guard");

  const list=await api(ownerToken,"GET");
  if(!list.res.ok||list.body.ok!==true||!Array.isArray(list.body.assets)){
    throw new Error(`asset list failed: ${list.res.status} ${JSON.stringify(list.body)}`);
  }
  console.log(`PASS asset registry list (${list.body.assets.length})`);

  const payload={
    assetKey,
    directory:"assets/images/misc",
    fileName,
    mimeType:"image/png",
    contentBase64:pngBase64,
    mode:"remote",
    reason:"Cloudflare manage-app-asset E2E",
    idempotencyKey:operationKey,
  };
  const upload=await api(ownerToken,"POST",payload);
  if(!upload.res.ok||upload.body.ok!==true||upload.body.fullPath!==fullPath||!upload.body.contentSha){
    throw new Error(`asset upload failed: ${upload.res.status} ${JSON.stringify(upload.body)}`);
  }
  console.log("PASS asset GitHub upload");

  const registry=await fsGet(`app_asset_registry/${assetKey}`);
  if(!registry||registry.data?.fullPath!==fullPath||registry.data?.published!==true){
    throw new Error("asset registry mismatch");
  }
  if(!registry.data?.rawUrl||!String(registry.data.rawUrl).includes(fileName)){
    throw new Error("asset rawUrl missing");
  }
  console.log("PASS asset registry write");

  const repoFile=await github(fullPath);
  if(!repoFile.res.ok||!repoFile.body?.sha){
    throw new Error(`GitHub asset not found after upload: ${repoFile.res.status}`);
  }
  githubSha=String(repoFile.body.sha);
  console.log("PASS asset exists in GitHub");

  const duplicate=await api(ownerToken,"POST",payload);
  if(!duplicate.res.ok||duplicate.body.code!=="duplicate"||duplicate.body.contentSha!==upload.body.contentSha){
    throw new Error(`asset idempotency failed: ${duplicate.res.status} ${JSON.stringify(duplicate.body)}`);
  }
  console.log("PASS asset idempotency");

  console.log("ALL CLOUDFLARE MANAGE APP ASSET E2E CHECKS PASSED");
}finally{
  try{
    if(probeSha){
      await github(probePath,{
        method:"DELETE",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({
          message:"Cleanup Cloudflare asset token permission probe",
          sha:probeSha,
          branch:"main",
        }),
      });
    }
  }catch(error){console.warn(`GitHub probe cleanup warning: ${error.message}`);}

  try{
    if(!githubSha){
      const current=await github(fullPath);
      if(current.res.ok&&current.body?.sha)githubSha=String(current.body.sha);
    }
    if(githubSha){
      await github(fullPath,{
        method:"DELETE",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({
          message:`E2E cleanup: remove ${fullPath}`,
          sha:githubSha,
          branch:"main",
        }),
      });
    }
  }catch(error){console.warn(`GitHub cleanup warning: ${error.message}`);}

  try{
    for(const path of await auditDocs())await fsDelete(path);
  }catch{}
  for(const path of [
    `control_operations/${operationKey}`,
    `app_asset_registry/${assetKey}`,
    `users/${ownerUid}`,
    `users/${userUid}`,
  ]){
    try{await fsDelete(path);}catch{}
  }
  if(ownerToken)await deleteAuthUser(ownerToken);
  if(userToken)await deleteAuthUser(userToken);
}
