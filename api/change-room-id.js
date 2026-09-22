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
   const w=Array.from(word);
   for(let end=1;end<=w.length&&tokens.size<maxTokens;end++)add(w.slice(0,end).join(""));
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
  const capabilities=Array.isArray(actor.capabilities)?actor.capabilities:[];
  const canManageIds=actor.adminEnabled===true&&(actor.role==="owner"||capabilities.includes("manageIds"));
  if(!actorSnap.exists||!canManageIds)return out(res,403,{ok:false,code:"forbidden"});

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
   const oldRef=db.collection("room_ids").doc(currentId);
   const newRef=db.collection("room_ids").doc(newId);
   const userCollisionRef=db.collection("public_ids").doc(newId);
   const [op,oldSnap,newSnap,userCollision]=await Promise.all([
    tx.get(opRef),tx.get(oldRef),tx.get(newRef),tx.get(userCollisionRef)
   ]);
   if(op.exists)return {ok:true,code:"duplicate",operationId:key,...(op.data()?.result||{})};
   if(!oldSnap.exists)throw Error("not_found");
   const roomId=String(oldSnap.data()?.roomId||"");
   if(!roomId)throw Error("old_id_retired");
   if(newSnap.exists||userCollision.exists)throw Error("id_taken");

   const roomRef=db.collection("rooms").doc(roomId);
   const roomSnap=await tx.get(roomRef);
   if(!roomSnap.exists)throw Error("not_found");
   const room=roomSnap.data()||{};
   if(String(room.publicId||"")!==currentId)throw Error("old_id_not_current");

   const title=room.name??room.title??"";
   const searchTokens=buildSearchTokens([title,newId]);
   const now=FieldValue.serverTimestamp();

   tx.update(roomRef,{
    publicId:newId,
    publicIdHistory:FieldValue.arrayUnion(currentId),
    publicIdUpdatedAt:now,
    publicIdUpdatedBy:decoded.uid,
    searchTokens,
    updatedAt:now,
   });
   tx.create(newRef,{roomId,createdAt:now,source:"adminOverride",createdBy:decoded.uid});
   tx.set(oldRef,{
    reserved:true,
    retiredFromRoomId:roomId,
    retiredAt:now,
    retiredBy:decoded.uid,
    currentPublicId:newId,
   });

   const auditRef=db.collection("admin_audit_logs").doc();
   tx.create(auditRef,{
    actorUid:decoded.uid,
    action:"changeRoomPublicId",
    targetType:"room",
    targetId:roomId,
    reason,
    before:{publicId:currentId},
    after:{publicId:newId},
    operationId:key,
    createdAt:now,
   });

   const resultData={roomId,before:currentId,after:newId};
   tx.create(opRef,{
    action:"changeRoomPublicId",
    actorUid:decoded.uid,
    targetId:roomId,
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
