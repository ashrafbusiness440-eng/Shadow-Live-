import {createHash} from "node:crypto";
import {getApps,initializeApp,cert} from "firebase-admin/app";
import {getAuth} from "firebase-admin/auth";
import {getFirestore,FieldValue} from "firebase-admin/firestore";

const OWNER="ashrafbusiness440-eng";
const REPO="Shadow-Live-";
const DEFAULT_BRANCH="feature/shadow-control-foundation";
const MAX_BYTES=2500000;
const ALLOWED_DIRS=new Set([
 "assets/images","assets/images/avatars","assets/images/coins","assets/images/badges","assets/images/vip",
 "assets/images/levels","assets/images/roles","assets/images/frames","assets/images/gifts","assets/images/rooms",
 "assets/images/backgrounds","assets/images/banners","assets/images/games","assets/images/store","assets/images/misc"
]);
const ALLOWED_EXTS=new Set(["png","jpg","jpeg","webp","gif"]);

function parseServiceAccount(raw){
 const text=String(raw||"").trim();if(!text)throw Error("server_not_configured");
 let sa=JSON.parse(text);if(typeof sa==="string")sa=JSON.parse(sa);
 const projectId=sa.project_id||sa.projectId,clientEmail=sa.client_email||sa.clientEmail;
 const privateKey=String(sa.private_key||sa.privateKey||"").replace(/\\n/g,"\n");
 if(!projectId||!clientEmail||!privateKey)throw Error("invalid_service_account_json");
 return {projectId,clientEmail,privateKey};
}
function init(){
 if(!getApps().length){const sa=parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT);initializeApp({credential:cert(sa),projectId:sa.projectId});}
}
const out=(res,status,body)=>res.status(status).json(body);
function normalizeDirectory(value){
 let text=String(value||"").trim().replace(/\\/g,"/");
 while(text.endsWith("/"))text=text.slice(0,-1);
 return text;
}
function validFileName(name){
 const value=String(name||"").trim();
 if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(value))return false;
 const ext=value.includes(".")?value.split(".").pop().toLowerCase():"";
 return ALLOWED_EXTS.has(ext);
}
function validKey(key){return /^[a-z0-9][a-z0-9._-]{2,119}$/.test(String(key||"").trim());}
function gitBlobSha(bytes){
 const header=Buffer.from(`blob ${bytes.length}\0`);
 return createHash("sha1").update(Buffer.concat([header,bytes])).digest("hex");
}
function encodePath(path){return path.split("/").map(encodeURIComponent).join("/");}
async function verifyOwner(req){
 init();
 const auth=req.headers.authorization||"";
 if(!auth.startsWith("Bearer "))throw Error("unauthorized");
 const decoded=await getAuth().verifyIdToken(auth.slice(7));
 const authAge=Math.floor(Date.now()/1000)-Number(decoded.auth_time||0);
 if(!Number.isFinite(authAge)||authAge>1800)throw Error("recent_auth_required");
 const db=getFirestore();
 const snap=await db.collection("users").doc(decoded.uid).get();
 const actor=snap.data()||{};
 if(!snap.exists||actor.role!=="owner"||actor.adminEnabled!==true)throw Error("forbidden");
 return {decoded,db,actor};
}
async function github(url,options={}){
 const token=String(process.env.GITHUB_ASSET_TOKEN||"").trim();
 if(!token)throw Error("github_not_configured");
 const response=await fetch(url,{
  ...options,
  headers:{
   accept:"application/vnd.github+json",
   authorization:`Bearer ${token}`,
   "x-github-api-version":"2022-11-28",
   ...(options.headers||{})
  }
 });
 if(response.status===404)return {status:404,body:null};
 const text=await response.text();
 let body={};try{body=text?JSON.parse(text):{};}catch{body={message:text};}
 if(!response.ok)throw Error(`github_${response.status}`);
 return {status:response.status,body};
}

export default async function handler(req,res){
 let phase="init";
 try{
  if(req.method!=="GET"&&req.method!=="POST")return out(res,405,{ok:false,code:"method_not_allowed"});
  phase="auth";
  const {decoded,db}=await verifyOwner(req);

  if(req.method==="GET"){
   phase="list";
   const snap=await db.collection("app_asset_registry").orderBy("updatedAt","desc").limit(100).get();
   const assets=snap.docs.map(doc=>({assetKey:doc.id,...doc.data(),updatedAt:doc.data()?.updatedAt?.toDate?.()?.toISOString?.()||null}));
   return out(res,200,{ok:true,assets});
  }

  const body=req.body||{};
  const assetKey=String(body.assetKey||"").trim();
  const directory=normalizeDirectory(body.directory);
  const fileName=String(body.fileName||"").trim();
  const mimeType=String(body.mimeType||"").trim();
  const mode=body.mode==="bundled"?"bundled":"remote";
  const reason=String(body.reason||"").trim();
  const idempotencyKey=String(body.idempotencyKey||"").trim();
  if(!validKey(assetKey)||!ALLOWED_DIRS.has(directory)||!validFileName(fileName)||!mimeType.startsWith("image/")||reason.length<3||reason.length>180||!/^[A-Za-z0-9_-]{12,180}$/.test(idempotencyKey)){
   return out(res,400,{ok:false,code:"invalid_request"});
  }

  let base64=String(body.contentBase64||"").trim();
  const comma=base64.indexOf(",");if(base64.startsWith("data:")&&comma>=0)base64=base64.slice(comma+1);
  let bytes;try{bytes=Buffer.from(base64,"base64");}catch{return out(res,400,{ok:false,code:"invalid_request"});}
  if(!bytes.length||bytes.length>MAX_BYTES)return out(res,400,{ok:false,code:"invalid_request"});

  const fullPath=`${directory}/${fileName}`;
  const branch=String(process.env.GITHUB_ASSET_BRANCH||DEFAULT_BRANCH).trim()||DEFAULT_BRANCH;
  const repo=String(process.env.GITHUB_ASSET_REPO||`${OWNER}/${REPO}`).trim();
  const encoded=encodePath(fullPath);
  const contentsUrl=`https://api.github.com/repos/${repo}/contents/${encoded}`;

  phase="idempotency";
  const opRef=db.collection("control_operations").doc(idempotencyKey);
  const op=await opRef.get();
  if(op.exists)return out(res,200,{ok:true,code:"duplicate",...(op.data()?.result||{})});

  phase="github_lookup";
  const existing=await github(`${contentsUrl}?ref=${encodeURIComponent(branch)}`);
  const existingSha=existing.status===404?null:String(existing.body?.sha||"");
  const nextBlobSha=gitBlobSha(bytes);
  const replaced=Boolean(existingSha);
  let commitSha=null,contentSha=nextBlobSha,downloadUrl=null;

  if(existingSha===nextBlobSha){
   downloadUrl=existing.body?.download_url||null;
  }else{
   phase="github_write";
   const payload={
    message:`Asset ${replaced?"replace":"add"}: ${assetKey} (${fullPath})`,
    content:bytes.toString("base64"),
    branch,
    ...(existingSha?{sha:existingSha}:{})
   };
   const write=await github(contentsUrl,{
    method:"PUT",
    headers:{"content-type":"application/json"},
    body:JSON.stringify(payload)
   });
   commitSha=String(write.body?.commit?.sha||"");
   contentSha=String(write.body?.content?.sha||nextBlobSha);
   downloadUrl=write.body?.content?.download_url||null;
  }

  const cacheUrl=downloadUrl?`${downloadUrl}${downloadUrl.includes("?")?"&":"?"}v=${contentSha}`:null;
  phase="registry";
  const registryRef=db.collection("app_asset_registry").doc(assetKey);
  const previous=await registryRef.get();
  const before=previous.exists?{
   fullPath:previous.data()?.fullPath||null,
   contentSha:previous.data()?.contentSha||null,
   mode:previous.data()?.mode||null
  }:null;
  const now=FieldValue.serverTimestamp();
  const registryData={
   assetKey,directory,fileName,fullPath,mimeType,mode,byteSize:bytes.length,
   contentSha,commitSha:commitSha||null,rawUrl:cacheUrl,published:true,replaced,
   updatedBy:decoded.uid,updatedAt:now,
   ...(previous.exists?{}:{createdBy:decoded.uid,createdAt:now})
  };
  await registryRef.set(registryData,{merge:true});
  const result={assetKey,fullPath,mode,byteSize:bytes.length,replaced,contentSha,commitSha,rawUrl:cacheUrl};

  const batch=db.batch();
  const auditRef=db.collection("admin_audit_logs").doc();
  batch.set(auditRef,{
   actorUid:decoded.uid,action:"upsertAppAsset",targetType:"app_asset",targetId:assetKey,
   reason,before,after:{fullPath,contentSha,mode,byteSize:bytes.length,replaced},
   operationId:idempotencyKey,createdAt:now
  });
  batch.set(opRef,{
   action:"upsertAppAsset",actorUid:decoded.uid,targetId:assetKey,status:"completed",result,createdAt:now
  });
  await batch.commit();

  return out(res,200,{ok:true,code:"ok",...result});
 }catch(e){
  const raw=e?.message||"server_error";
  const known=["unauthorized","recent_auth_required","forbidden","github_not_configured"];
  const code=known.includes(raw)?raw:`server_${phase}_failed`;
  const status=raw==="unauthorized"||raw==="recent_auth_required"?401:raw==="forbidden"?403:raw==="github_not_configured"?503:500;
  return out(res,status,{ok:false,code});
 }
}
