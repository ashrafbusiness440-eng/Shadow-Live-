import { sign } from "node:crypto";

let sa=JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT||"{}");
if(typeof sa==="string")sa=JSON.parse(sa);
const projectId=sa.project_id;
const clientEmail=sa.client_email;
const privateKey=String(sa.private_key||"").replace(/\\n/g,"\n");
if(!projectId||!clientEmail||!privateKey)throw Error("invalid service account");

function b64url(value){
  return Buffer.from(value).toString("base64").replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");
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
  const unsigned=header+"."+payload;
  const signature=sign("RSA-SHA256",Buffer.from(unsigned),privateKey);
  const assertion=unsigned+"."+b64url(signature);
  const res=await fetch("https://oauth2.googleapis.com/token",{
    method:"POST",
    headers:{"content-type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams({grant_type:"urn:ietf:params:oauth-bearer",assertion}),
  });
  let body=await res.json().catch(()=>({}));
  if(!res.ok||!body.access_token){
    const retry=await fetch("https://oauth2.googleapis.com/token",{
      method:"POST",
      headers:{"content-type":"application/x-www-form-urlencoded"},
      body:new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion}),
    });
    body=await retry.json().catch(()=>({}));
    if(!retry.ok||!body.access_token)throw Error("google oauth failed");
  }
  return body.access_token;
}

const accessToken=await googleAccessToken();
const root="https://firestore.googleapis.com/v1/projects/"+projectId+"/databases/(default)/documents";
const prefix="__cf_p6_";

async function listPhase6Users(){
  let pageToken="";
  const found=[];
  do{
    const url=new URL(root+"/users");
    url.searchParams.set("pageSize","300");
    url.searchParams.set("mask.fieldPaths","displayName");
    if(pageToken)url.searchParams.set("pageToken",pageToken);
    const res=await fetch(url,{headers:{authorization:"Bearer "+accessToken}});
    const body=await res.json().catch(()=>({}));
    if(!res.ok)throw Error("list users failed "+res.status+" "+JSON.stringify(body));
    for(const doc of body.documents||[]){
      const uid=String(doc.name||"").split("/").pop()||"";
      if(uid.startsWith(prefix))found.push(uid);
    }
    pageToken=String(body.nextPageToken||"");
  }while(pageToken);
  return [...new Set(found)].sort();
}

async function del(path){
  const res=await fetch(root+"/"+path,{method:"DELETE",headers:{authorization:"Bearer "+accessToken}});
  if(!res.ok&&res.status!==404)throw Error("delete "+path+" failed "+res.status+" "+await res.text());
}

const uids=await listPhase6Users();
console.log("Phase6 stale test users found:",uids.length,uids.join(", "));
const relatedCollections=["public_profiles","gift_user_stats","reward_inventory","wallet_private"];
const errors=[];
for(const uid of uids){
  for(const collection of relatedCollections){
    try{await del(collection+"/"+uid);}catch(error){errors.push(String(error?.message||error));}
  }
  try{await del("users/"+uid);console.log("DELETED users/"+uid);}
  catch(error){errors.push(String(error?.message||error));}
}
if(errors.length)throw Error("cleanup errors: "+errors.join(" | "));
console.log("PHASE6 TEST USER CLEANUP PASSED — removed",uids.length,"user documents");
