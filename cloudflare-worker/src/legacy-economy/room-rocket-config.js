import { getApps, initializeApp, cert, getAuth, FieldValue, getFirestore, legacyEnv } from "../legacy-firebase-admin-shim.js";
import { assertUserDocumentSessionState } from "../firebase-auth.js";
import { primeConfigCache, readThroughConfigCache } from "../config-cache.js";
import {
  defaultRoomRocketConfig,
  normalizeRoomRocketConfig,
} from "./room-rocket.js";

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
    const sa=parseServiceAccount(legacyEnv.FIREBASE_SERVICE_ACCOUNT);
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
  const decoded=await getAuth().verifyIdToken(authorization.slice(7), {checkUserState:false});
  const db=getFirestore();
  const snap=await db.collection("users").doc(decoded.uid).get();
  if(!snap.exists) throw Error("forbidden");
  const user=snap.data()||{};
  assertUserDocumentSessionState(decoded, user);
  const caps=Array.isArray(user.capabilities)?user.capabilities:[];
  if(!(user.role==="owner"||(user.adminEnabled===true&&caps.includes("manageEconomy")))){
    throw Error("forbidden");
  }
  return {uid:decoded.uid,db};
}

async function cachedRoomRocketConfig(db){
  return readThroughConfigCache(
    "config:room_rocket",
    async()=>{
      const snap=await db.collection("system_config").doc("room_rocket").get();
      if(!snap.exists)return defaultRoomRocketConfig();
      try{return normalizeRoomRocketConfig(snap.data()||{});}
      catch(_){return {...defaultRoomRocketConfig(),...(snap.data()||{})};}
    },
    {ttlMs:60000,staleMs:5*60*1000},
  );
}

export async function saveRoomRocketConfig(db,uid,raw={}){
  const config=normalizeRoomRocketConfig(raw);
  const ref=db.collection("system_config").doc("room_rocket");
  const before=await ref.get();
  const auditRef=db.collection("admin_audit_logs").doc();

  await db.runTransaction(async tx=>{
    tx.set(ref,{
      ...config,
      updatedBy:uid,
      updatedAt:FieldValue.serverTimestamp(),
    },{merge:true});
    tx.create(auditRef,{
      actorUid:uid,
      action:"updateRoomRocketConfig",
      targetType:"system_config",
      targetId:"room_rocket",
      before:before.exists?before.data():null,
      after:config,
      createdAt:FieldValue.serverTimestamp(),
    });
  });
  primeConfigCache("config:room_rocket",config,{ttlMs:60000,staleMs:5*60*1000});
  return config;
}

export async function handler(req,res){
  if(cors(req,res)) return;
  if(req.method!=="POST") return out(res,405,{ok:false,code:"method_not_allowed"});
  try{
    initFirebase();
    const {uid,db}=await actor(req);
    const action=clean(req.body?.action);
    const ref=db.collection("system_config").doc("room_rocket");

    if(action==="state"){
      const config=await cachedRoomRocketConfig(db);
      return out(res,200,{ok:true,config});
    }

    if(action==="save"){
      const config=await saveRoomRocketConfig(db,uid,req.body||{});
      return out(res,200,{ok:true,config});
    }

    return out(res,400,{ok:false,code:"invalid_action"});
  }catch(error){
    const code=clean(error?.message)||"server_error";
    const bad=new Set([
      "invalid_action","invalid_rocket_threshold","invalid_explosion_duration",
      "invalid_win_probability","invalid_reward_duration","invalid_stack_cap",
      "too_many_coin_prizes","invalid_coin_prize","invalid_reward_weight",
      "too_many_cosmetic_rewards","invalid_reward_id","invalid_overflow_coins"
    ]);
    const status=code==="unauthorized"?401:code==="forbidden"?403:bad.has(code)?400:500;
    return out(res,status,{ok:false,code:status===500?"room_rocket_config_failed":code});
  }
}
