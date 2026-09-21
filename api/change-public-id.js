import {getApps,initializeApp,cert} from "firebase-admin/app";
import {getAuth} from "firebase-admin/auth";
import {getFirestore,FieldValue} from "firebase-admin/firestore";

function parseServiceAccount(raw){
 const text=String(raw||"").trim();
 if(!text)throw Error("server_not_configured");
 let sa=JSON.parse(text);if(typeof sa==="string")sa=JSON.parse(sa);
 const projectId=sa.project_id||sa.projectId,clientEmail=sa.client_email||sa.clientEmail;
 const privateKey=String(sa.private_key||sa.privateKey||"").replace(/\\n/g,"\n");
 if(!projectId||!clientEmail||!privateKey)throw Error("invalid_service_account_json");
 return {projectId,clientEmail,privateKey};
}
function init(){
 if(!getApps().length){
  const sa=parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT);
  initializeApp({credential:cert(sa),projectId:sa.projectId});
 }
}
const out=(res,status,body)=>res.status(status).json(body);

function normalizeId(value){
 let text=String(value||"").trim();
 const arabic="٠١٢٣٤٥٦٧٨٩",persian="۰۱۲۳۴۵۶۷۸۹";
 for(let i=0;i<10;i++)text=text.split(arabic[i]).join(String(i)).split(persian[i]).join(String(i));
 return text;
}
function normalizeSearchText(value){
 let text=String(value??"").toLowerCase();
 const arabic="٠١٢٣٤٥٦٧٨٩",persian="۰۱۲۳۴۵۶۷۸۹";
 for(let i=0;i<10;i++)text=text.split(arabic[i]).join(String(i)).split(persian[i]).join(String(i));
 return text
  .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g,"")
  .replace(/ـ/g,"")
  .replace(/[أإآٱ]/g,"ا")
  .replace(/ى/g,"ي")
  .replace(/\s+/g," ")
  .trim();
}
function buildSearchTokens(values,maxSubstringLength=8,maxTokens=512){
 const tokens=new Set();
 const add=(token)=>{if(token&&tokens.size<maxTokens)tokens.add(token);};
 for(const value of values){
  if(tokens.size>=maxTokens)break;
  const normalized=normalizeSearchText(value);if(!normalized)continue;
  add(normalized);const chars=Array.from(normalized);
  for(let end=1;end<=chars.length&&tokens.size<maxTokens;end++)add(chars.slice(0,end).join(""));
  for(const word of normalized.split(" ")){
   const w=Array.from(word);for(let end=1;end<=w.length&&tokens.size<maxTokens;end++)add(w.slice(0,end).join(""));
   if(tokens.size>=maxTokens)break;
  }
  for(let start=0;start<chars.length&&tokens.size<maxTokens;start++){
   const maxEnd=Math.min(chars.length,start+maxSubstringLength);
   for(let end=start+1;end<=maxEnd&&tokens.size<maxTokens;end++)add(chars.slice(start,end).join("").trim());
  }
 }
 return [...tokens];
}

export default async function handler(req,res){
 if(req.method!=="POST")return out(res,405,{ok:false,code:"method_not_allowed"});
 let phase="init";
 try{
  init();
  phase="verify_token";
  const auth=req.headers.authorization||"";
  if(!auth.startsWith("Bearer "))return out(res,401,{ok:false,code:"unauthorized"});
  const decoded=await getAuth().verifyIdToken(auth.slice(7));
  const authAge=Math.floor(Date.now()/1000)-Number(decoded.auth_time||0);
  if(!Number.isFinite(authAge)||authAge>1800)return out(res,401,{ok:false,code:"recent_auth_required"});

  phase="load_actor";
  const db=getFirestore();
  const actorSnap=await db.collection("users").doc(decoded.uid).get();
  const actor=actorSnap.data()||{};
  if(!actorSnap.exists||actor.adminEnabled!==true||actor.role!=="owner")return out(res,403,{ok:false,code:"forbidden"});

  const body=req.body||{};
  const currentId=normalizeId(body.currentId),newId=normalizeId(body.newId);
  const reason=String(body.reason||"").trim();
  const key=String(body.idempotencyKey||"");
  if(!/^\d{3,12}$/.test(currentId)||!/^\d{3,12}$/.test(newId)||currentId===newId||reason.length<3||reason.length>160||!/^[A-Za-z0-9_-]{12,160}$/.test(key)){
   return out(res,400,{ok:false,code:"invalid_request"});
  }

  phase="transaction";
  const result=await db.runTransaction(async tx=>{
   const opRef=db.collection("control_operations").doc(key);
   const oldRef=db.collection("public_ids").doc(currentId);
   const newRef=db.collection("public_ids").doc(newId);
   const [op,oldSnap,newSnap]=await Promise.all([tx.get(opRef),tx.get(oldRef),tx.get(newRef)]);
   if(op.exists)return {ok:true,code:"duplicate",operationId:key,...(op.data()?.result||{})};
   if(!oldSnap.exists)throw Error("not_found");
   const targetUid=String(oldSnap.data()?.uid||"");
   if(!targetUid)throw Error("old_id_retired");
   if(newSnap.exists)throw Error("id_taken");

   const userRef=db.collection("users").doc(targetUid);
   const publicRef=db.collection("public_profiles").doc(targetUid);
   const [userSnap,publicSnap]=await Promise.all([tx.get(userRef),tx.get(publicRef)]);
   if(!userSnap.exists)throw Error("not_found");
   const user=userSnap.data()||{};
   if(String(user.publicId||"")!==currentId)throw Error("old_id_not_current");

   const profile=publicSnap.data()||{};
   const displayName=profile.displayName??user.displayName??user.name??"";
   const username=profile.username??user.username??"";
   const searchTokens=buildSearchTokens([displayName,username,newId]);
   const now=FieldValue.serverTimestamp();

   tx.update(userRef,{
    publicId:newId,
    publicIdHistory:FieldValue.arrayUnion(currentId),
    publicIdUpdatedAt:now,
    publicIdUpdatedBy:decoded.uid,
    updatedAt:now,
   });
   tx.set(publicRef,{publicId:newId,searchTokens,updatedAt:now},{merge:true});
   tx.create(newRef,{uid:targetUid,createdAt:now,source:"adminOverride",createdBy:decoded.uid});
   tx.set(oldRef,{
    reserved:true,
    retiredFromUid:targetUid,
    retiredAt:now,
    retiredBy:decoded.uid,
    currentPublicId:newId,
   });

   const auditRef=db.collection("admin_audit_logs").doc();
   tx.create(auditRef,{
    actorUid:decoded.uid,
    action:"changePublicId",
    targetType:"user",
    targetId:targetUid,
    targetUid,
    reason,
    before:{publicId:currentId},
    after:{publicId:newId},
    operationId:key,
    createdAt:now,
   });

   const resultData={targetUid,before:currentId,after:newId};
   tx.create(opRef,{
    action:"changePublicId",
    actorUid:decoded.uid,
    targetId:targetUid,
    status:"completed",
    result:resultData,
    createdAt:now,
   });
   return {ok:true,code:"ok",operationId:key,...resultData};
  });
  return out(res,200,result);
 }catch(e){
  const raw=e?.message||"server_error";
  const conflict=["old_id_retired","old_id_not_current","id_taken"];
  const code=["not_found",...conflict].includes(raw)?raw:"server_"+phase+"_failed";
  const status=raw==="not_found"?404:conflict.includes(raw)?409:500;
  return out(res,status,{ok:false,code});
 }
}
