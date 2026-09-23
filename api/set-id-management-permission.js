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
  if(!actorSnap.exists||actor.adminEnabled!==true||actor.role!=="owner"){
   return out(res,403,{ok:false,code:"forbidden"});
  }

  const body=req.body||{};
  const targetUid=String(body.targetUid||"").trim();
  const enabled=body.enabled===true;
  const reason=String(body.reason||"").trim();
  const key=String(body.idempotencyKey||"");
  if(!targetUid||targetUid===decoded.uid||reason.length<3||reason.length>160||!/^[A-Za-z0-9_-]{12,160}$/.test(key)){
   return out(res,400,{ok:false,code:"invalid_request"});
  }

  phase="transaction";
  const result=await db.runTransaction(async tx=>{
   const opRef=db.collection("control_operations").doc(key);
   const targetRef=db.collection("users").doc(targetUid);
   const [op,target]=await Promise.all([tx.get(opRef),tx.get(targetRef)]);
   if(op.exists)return {ok:true,code:"duplicate",operationId:key,...(op.data()?.result||{})};
   if(!target.exists)throw Error("not_found");
   const data=target.data()||{};
   if(data.role==="owner")throw Error("owner_protected");

   const current=Array.isArray(data.capabilities)?data.capabilities.map(String):[];
   const next=enabled
    ? [...new Set([...current,"manageIds"])]
    : current.filter(value=>value!=="manageIds");
   const now=FieldValue.serverTimestamp();

   tx.update(targetRef,{
    capabilities:next,
    ...(enabled?{adminEnabled:true}:{}),
    updatedAt:now,
   });

   const auditRef=db.collection("admin_audit_logs").doc();
   tx.create(auditRef,{
    actorUid:decoded.uid,
    action:enabled?"grantManageIds":"revokeManageIds",
    targetType:"user",
    targetId:targetUid,
    reason,
    before:{manageIds:current.includes("manageIds")},
    after:{manageIds:enabled},
    operationId:key,
    createdAt:now,
   });

   const resultData={targetUid,enabled};
   tx.create(opRef,{
    action:"setIdManagementPermission",
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
  const code=["not_found","owner_protected"].includes(raw)?raw:"server_"+phase+"_failed";
  const status=raw==="not_found"?404:raw==="owner_protected"?409:500;
  return out(res,status,{ok:false,code});
 }
}
