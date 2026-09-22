import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

function clean(value){return String(value??"").trim();}
function parseServiceAccount(raw){
  const text=clean(raw); if(!text) throw Error("server_not_configured");
  let sa=JSON.parse(text); if(typeof sa==="string") sa=JSON.parse(sa);
  const projectId=sa.project_id||sa.projectId;
  const clientEmail=sa.client_email||sa.clientEmail;
  const privateKey=String(sa.private_key||sa.privateKey||"").replace(/\\n/g,"\n");
  if(!projectId||!clientEmail||!privateKey) throw Error("invalid_service_account_json");
  return {projectId,clientEmail,privateKey};
}
function initFirebase(){
  if(!getApps().length){
    const sa=parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT);
    initializeApp({credential:cert(sa),projectId:sa.projectId});
  }
}
function cors(req,res){
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Headers","authorization, content-type");
  res.setHeader("Access-Control-Allow-Methods","POST,OPTIONS");
  if(req.method==="OPTIONS"){res.status(204).end();return true;}
  return false;
}
const out=(res,status,body)=>res.status(status).json(body);

async function actor(req){
  const authorization=clean(req.headers.authorization);
  if(!authorization.startsWith("Bearer ")) throw Error("unauthorized");
  const decoded=await getAuth().verifyIdToken(authorization.slice(7));
  const db=getFirestore();
  const snap=await db.collection("users").doc(decoded.uid).get();
  if(!snap.exists) throw Error("forbidden");
  const user=snap.data()||{};
  const caps=Array.isArray(user.capabilities)?user.capabilities:[];
  if(!(user.role==="owner"||(user.adminEnabled===true&&caps.includes("manageEconomy")))){
    throw Error("forbidden");
  }
  return {uid:decoded.uid,db};
}

function normalizePolicy(raw={}){
  const enabled=raw.enabled===true;
  const recipientShareBps=Number(raw.recipientShareBps??0);
  if(!Number.isSafeInteger(recipientShareBps)||recipientShareBps<0||recipientShareBps>10000){
    throw Error("invalid_recipient_share");
  }
  return {
    enabled,
    recipientShareBps,
    coinsPerDiamond:10000,
    settlementMode:"accumulate_then_convert",
    agencySupportTracking:true,
    periodTimeZone:"UTC",
  };
}

export default async function handler(req,res){
  if(cors(req,res))return;
  if(req.method!=="POST")return out(res,405,{ok:false,code:"method_not_allowed"});
  try{
    initFirebase();
    const {uid,db}=await actor(req);
    const action=clean(req.body?.action);
    const ref=db.collection("system_config").doc("gift_economy");

    if(action==="state"){
      const snap=await ref.get();
      const config=snap.exists?snap.data():{
        enabled:false,
        recipientShareBps:0,
        coinsPerDiamond:10000,
        settlementMode:"accumulate_then_convert",
        agencySupportTracking:true,
        periodTimeZone:"UTC",
      };
      return out(res,200,{ok:true,config});
    }

    if(action==="save"){
      const policy=normalizePolicy(req.body||{});
      const before=await ref.get();
      const auditRef=db.collection("admin_audit_logs").doc();
      await db.runTransaction(async tx=>{
        tx.set(ref,{
          ...policy,
          updatedBy:uid,
          updatedAt:FieldValue.serverTimestamp(),
        },{merge:true});
        tx.create(auditRef,{
          actorUid:uid,
          action:"updateGiftEconomyPolicy",
          targetType:"system_config",
          targetId:"gift_economy",
          before:before.exists?before.data():null,
          after:policy,
          createdAt:FieldValue.serverTimestamp(),
        });
      });
      return out(res,200,{ok:true,config:policy});
    }

    return out(res,400,{ok:false,code:"invalid_action"});
  }catch(error){
    const code=clean(error?.message)||"server_error";
    const status=code==="unauthorized"?401:code==="forbidden"?403:
      ["invalid_recipient_share","invalid_action"].includes(code)?400:500;
    return out(res,status,{ok:false,code});
  }
}
