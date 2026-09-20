import {getApps,initializeApp,cert} from "firebase-admin/app";
import {getAuth} from "firebase-admin/auth";
import {getFirestore,FieldValue} from "firebase-admin/firestore";
function init(){if(!getApps().length){const raw=process.env.FIREBASE_SERVICE_ACCOUNT;if(!raw)throw Error("server_not_configured");initializeApp({credential:cert(JSON.parse(raw))});}}
const out=(r,s,b)=>r.status(s).json(b);
export default async function handler(req,res){
 if(req.method==="GET")return out(res,200,{ok:true,service:"shadow-control-api"});
 if(req.method!=="POST")return out(res,405,{ok:false,code:"method_not_allowed"});
 try{
  init();const h=req.headers.authorization||"";if(!h.startsWith("Bearer "))return out(res,401,{ok:false,code:"unauthorized"});
  const decoded=await getAuth().verifyIdToken(h.slice(7)),db=getFirestore(),actorSnap=await db.collection("users").doc(decoded.uid).get(),actor=actorSnap.data()||{};
  if(!actorSnap.exists||actor.adminEnabled!==true||actor.role!=="owner")return out(res,403,{ok:false,code:"forbidden"});
  const b=req.body||{},targetId=String(b.targetId||""),asset=String(b.asset||""),reason=String(b.reason||"").trim(),key=String(b.idempotencyKey||""),delta=Number(b.delta);
  if(!targetId||!["coins","diamonds"].includes(asset)||!Number.isFinite(delta)||delta===0||Math.abs(delta)>1000000000||reason.length<3||!/^[A-Za-z0-9_-]{12,160}$/.test(key))return out(res,400,{ok:false,code:"invalid_request"});
  const result=await db.runTransaction(async tx=>{
   const opRef=db.collection("control_operations").doc(key),userRef=db.collection("users").doc(targetId),ledgerRef=db.collection("financial_ledger").doc(key),auditRef=db.collection("admin_audit_logs").doc();
   const [op,user,lock]=await Promise.all([tx.get(opRef),tx.get(userRef),tx.get(db.collection("system_config").doc("emergency_lock"))]);
   if(op.exists)return {ok:true,code:"duplicate",operationId:key};if(lock.exists&&lock.data()?.enabled===true)throw Error("emergency_locked");if(!user.exists)throw Error("not_found");
   const before=Number(user.data()?.[asset]||0),after=before+delta;if(after<0)throw Error("insufficient_balance");
   tx.update(userRef,{[asset]:after});tx.create(ledgerRef,{userId:targetId,asset,delta,openingBalance:before,closingBalance:after,reason,sourceType:"adminAdjustment",sourceId:key,actorUid:decoded.uid,idempotencyKey:key,createdAt:FieldValue.serverTimestamp()});
   tx.create(auditRef,{actorUid:decoded.uid,action:"adjustBalance",targetType:"user",targetId,reason,before:{[asset]:before},after:{[asset]:after},operationId:key,createdAt:FieldValue.serverTimestamp()});
   tx.create(opRef,{action:"adjustBalance",actorUid:decoded.uid,targetId,status:"completed",createdAt:FieldValue.serverTimestamp()});return {ok:true,code:"ok",operationId:key,before,after};
  });return out(res,200,result);
 }catch(e){const code=e?.message||"server_error";return out(res,["not_found"].includes(code)?404:["emergency_locked","insufficient_balance"].includes(code)?409:500,{ok:false,code});}
}