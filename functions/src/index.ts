import {onRequest} from "firebase-functions/v2/https";
import {initializeApp} from "firebase-admin/app";
import {getAuth} from "firebase-admin/auth";
import {FieldValue,getFirestore} from "firebase-admin/firestore";

initializeApp();
const db=getFirestore();

type Actor={uid:string;role:string;enabled:boolean;capabilities:Set<string>};
const capabilityByAction:Record<string,string>={
 adjustBalance:"manageEconomy",
 approveWithdrawal:"manageWithdrawals",
 paySettlement:"manageSettlements",
 changeRole:"manageRoles",
 emergencyLock:"emergencyLock",
};
const sensitive=new Set(Object.keys(capabilityByAction));

async function actorFrom(req:any):Promise<Actor>{
 const header=String(req.headers.authorization??"");
 if(!header.startsWith("Bearer "))throw new Error("unauthenticated");
 const decoded=await getAuth().verifyIdToken(header.slice(7),true);
 const snap=await db.collection("users").doc(decoded.uid).get();
 if(!snap.exists)throw new Error("denied");
 const data=snap.data()??{};
 return {uid:decoded.uid,role:String(data.role??"user"),enabled:data.adminEnabled!==false,capabilities:new Set<string>(Array.isArray(data.capabilities)?data.capabilities:[])};
}
function can(actor:Actor,capability:string){return actor.enabled&&(actor.role==="owner"||actor.capabilities.has(capability));}
function requireCapability(actor:Actor,action:string){
 const cap=capabilityByAction[action]; if(!cap||!can(actor,cap))throw new Error("denied");
}
async function emergencyLocked(){
 const snap=await db.collection("system_config").doc("emergency_lock").get();
 return snap.exists&&snap.data()?.enabled===true;
}
async function adjustBalance(actor:Actor,body:any){
 const targetId=String(body.targetId??"").trim(),reason=String(body.reason??"").trim();
 const payload=body.payload??{},asset=String(payload.asset??""),key=String(payload.idempotencyKey??"").trim();
 const raw=Number(payload.delta);
 if(!targetId||reason.length<3||!["coins","diamonds"].includes(asset)||!Number.isFinite(raw)||raw===0||!key)throw new Error("invalid_request");
 if(asset==="coins"&&!Number.isInteger(raw))throw new Error("invalid_amount");
 const opRef=db.collection("control_operations").doc(key);
 const userRef=db.collection("users").doc(targetId);
 const ledgerRef=db.collection("financial_ledger").doc(key);
 const auditRef=db.collection("admin_audit_logs").doc();
 return db.runTransaction(async tx=>{
  const [op,user,lock]=await Promise.all([tx.get(opRef),tx.get(userRef),tx.get(db.collection("system_config").doc("emergency_lock"))]);
  if(op.exists)return {ok:true,code:"duplicate",operationId:key};
  if(lock.exists&&lock.data()?.enabled===true)throw new Error("emergency_locked");
  if(!user.exists)throw new Error("not_found");
  const before=Number(user.data()?.[asset]??0),after=before+raw;
  if(after<0)throw new Error("insufficient_balance");
  tx.update(userRef,{[asset]:after});
  tx.create(ledgerRef,{userId:targetId,asset,delta:raw,openingBalance:before,closingBalance:after,reason,sourceType:"adminAdjustment",sourceId:key,actorUid:actor.uid,idempotencyKey:key,createdAt:FieldValue.serverTimestamp()});
  tx.create(auditRef,{actorUid:actor.uid,action:"adjustBalance",targetType:"user",targetId,reason,before:{[asset]:before},after:{[asset]:after},operationId:key,createdAt:FieldValue.serverTimestamp()});
  tx.create(opRef,{action:"adjustBalance",actorUid:actor.uid,targetId,status:"completed",createdAt:FieldValue.serverTimestamp()});
  return {ok:true,code:"ok",operationId:key};
 });
}

export const controlApi=onRequest({region:"us-central1"},async(req,res)=>{
 try{
  if(req.method==="GET"&&req.path.endsWith("/v1/control/health")){
   res.json({ok:true,environment:process.env.CONTROL_ENV??"staging",version:"1",financialWritesEnabled:true,roleMutationsEnabled:false});
   return;
  }
  if(req.method!=="POST"||!req.path.endsWith("/v1/control/actions")){res.status(404).json({ok:false,code:"not_found"});return;}
  const actor=await actorFrom(req),action=String(req.body?.action??""),reason=String(req.body?.reason??"").trim();
  if(!actor.enabled){res.status(403).json({ok:false,code:"denied"});return;}
  if(reason.length<3){res.status(400).json({ok:false,code:"invalid_reason"});return;}
  requireCapability(actor,action);
  if(action==="adjustBalance"){res.json(await adjustBalance(actor,req.body));return;}
  if(sensitive.has(action)&&await emergencyLocked()){res.status(423).json({ok:false,code:"emergency_locked"});return;}
  res.status(501).json({ok:false,code:"trusted_backend_required",message:"Action handler is not implemented yet."});
 }catch(e:any){
  const code=String(e?.message??"denied");
  const status=code==="unauthenticated"?401:code==="denied"?403:code==="not_found"?404:code==="emergency_locked"?423:code==="insufficient_balance"?409:400;
  res.status(status).json({ok:false,code});
 }
});
