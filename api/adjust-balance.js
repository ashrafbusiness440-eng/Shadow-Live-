import {getApps,initializeApp,cert} from "firebase-admin/app";
import {getAuth} from "firebase-admin/auth";
import {getFirestore,FieldValue} from "firebase-admin/firestore";
function parseServiceAccount(raw){
 let text=String(raw||"").trim();
 if(!text)throw Error("server_not_configured");
 if(text.startsWith("```"))text=text.replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/,"").trim();
 try{
  let parsed=JSON.parse(text);
  if(typeof parsed==="string")parsed=JSON.parse(parsed);
  return parsed;
 }catch(_){
  const read=(key)=>{
   const m=text.match(new RegExp('["\\\']'+key+'["\\\']\\s*:\\s*["\\\']([^"\\\']*)["\\\']','m'));
   return m?m[1]:null;
  };
  const projectId=read("project_id"),clientEmail=read("client_email"),rawKey=read("private_key");
  if(!projectId||!clientEmail||!rawKey)throw Error("invalid_service_account_json");
  const privateKey=rawKey.replace(/\\\\n/g,"\n");
  return {projectId,clientEmail,privateKey};
 }
}
function init(){
 if(!getApps().length){
  const sa=parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT);
  initializeApp({credential:cert(sa),projectId:sa.project_id||sa.projectId});
 }
}
const out=(r,s,b)=>r.status(s).json(b);
export default async function handler(req,res){
 if(req.method==="GET"){
  try{
   init();
   await getFirestore().collection("users").limit(1).get();
   return out(res,200,{ok:true,service:"shadow-control-api",firebaseAdmin:true,firestore:true});
  }catch(e){
   console.error("adjust-balance health",e?.message||e);
   return out(res,500,{ok:false,service:"shadow-control-api",code:"backend_firebase_init_failed"});
  }
 }
 if(req.method!=="POST")return out(res,405,{ok:false,code:"method_not_allowed"});
 let phase="init";
 try{
  init();phase="verify_token";const h=req.headers.authorization||"";if(!h.startsWith("Bearer "))return out(res,401,{ok:false,code:"unauthorized"});
  const decoded=await getAuth().verifyIdToken(h.slice(7));phase="load_actor";const db=getFirestore(),actorSnap=await db.collection("users").doc(decoded.uid).get(),actor=actorSnap.data()||{};
  if(!actorSnap.exists||actor.adminEnabled!==true||actor.role!=="owner")return out(res,403,{ok:false,code:"forbidden"});
  const b=req.body||{},targetId=String(b.targetId||""),asset=String(b.asset||""),reason=String(b.reason||"").trim(),key=String(b.idempotencyKey||""),delta=Number(b.delta);
  if(!targetId||!["coins","diamonds"].includes(asset)||!Number.isFinite(delta)||delta===0||Math.abs(delta)>1000000000||reason.length<3||!/^[A-Za-z0-9_-]{12,160}$/.test(key))return out(res,400,{ok:false,code:"invalid_request"});
  phase="transaction";
  const result=await db.runTransaction(async tx=>{
   const opRef=db.collection("control_operations").doc(key),userRef=db.collection("users").doc(targetId),ledgerRef=db.collection("financial_ledger").doc(key),auditRef=db.collection("admin_audit_logs").doc();
   const [op,user,lock]=await Promise.all([tx.get(opRef),tx.get(userRef),tx.get(db.collection("system_config").doc("emergency_lock"))]);
   if(op.exists)return {ok:true,code:"duplicate",operationId:key};if(lock.exists&&lock.data()?.enabled===true)throw Error("emergency_locked");if(!user.exists)throw Error("not_found");
   const before=Number(user.data()?.[asset]||0),after=before+delta;if(after<0)throw Error("insufficient_balance");
   tx.update(userRef,{[asset]:after});tx.create(ledgerRef,{userId:targetId,asset,delta,openingBalance:before,closingBalance:after,reason,sourceType:"adminAdjustment",sourceId:key,actorUid:decoded.uid,idempotencyKey:key,createdAt:FieldValue.serverTimestamp()});
   tx.create(auditRef,{actorUid:decoded.uid,action:"adjustBalance",targetType:"user",targetId,reason,before:{[asset]:before},after:{[asset]:after},operationId:key,createdAt:FieldValue.serverTimestamp()});
   tx.create(opRef,{action:"adjustBalance",actorUid:decoded.uid,targetId,status:"completed",createdAt:FieldValue.serverTimestamp()});return {ok:true,code:"ok",operationId:key,before,after};
  });return out(res,200,result);
 }catch(e){const raw=e?.message||"server_error";console.error("adjust-balance",phase,raw);const known=["not_found","emergency_locked","insufficient_balance"];const code=known.includes(raw)?raw:`server_${phase}_failed`;return out(res,["not_found"].includes(raw)?404:["emergency_locked","insufficient_balance"].includes(raw)?409:500,{ok:false,code});}
}