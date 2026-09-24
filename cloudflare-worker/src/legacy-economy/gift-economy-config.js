import { getApps, initializeApp, cert, getAuth, FieldValue, getFirestore, legacyEnv } from "../legacy-firebase-admin-shim.js";

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

export function defaultPolicy(){
  return {
    enabled:true,
    policyMode:"tiered_host_agency",
    coinsPerUsd:10000,
    coinsPerDiamond:10000,
    tierPeriod:"monthly",
    settlementMode:"cycle_settlement",
    agencySupportTracking:true,
    periodTimeZone:"UTC",
    hostPerformanceBonusBps:200,
    agencyPerformanceBonusBps:200,
    hostBonusQualifiedDays:9,
    hostBonusMinutesPerQualifiedDay:120,
    agencyBonusActiveHosts:10,
    activityRuleMode:"cycle_multiplier",
    activityPayoutBpsByQualifiedDays:{
      "0":0,"1":0,"2":0,"3":2500,"4":4000,
      "5":5500,"6":7000,"7":8000,"8":9000,"9":10000
    },
    tiers:[
      {id:"starter",nameAr:"Starter",minGiftCoins:0,hostShareBps:5500,agencyShareBps:500},
      {id:"bronze",nameAr:"Bronze",minGiftCoins:1000000,hostShareBps:5700,agencyShareBps:600},
      {id:"silver",nameAr:"Silver",minGiftCoins:5000000,hostShareBps:6000,agencyShareBps:800},
      {id:"gold",nameAr:"Gold",minGiftCoins:20000000,hostShareBps:6200,agencyShareBps:900},
      {id:"diamond",nameAr:"Diamond",minGiftCoins:50000000,hostShareBps:6300,agencyShareBps:1000}
    ]
  };
}

function integer(value,code,min,max){
  const n=Number(value);
  if(!Number.isSafeInteger(n)||n<min||n>max) throw Error(code);
  return n;
}
function normalizeTier(item,index){
  const id=clean(item?.id)||("tier_"+String(index+1));
  const nameAr=clean(item?.nameAr)||id;
  const minGiftCoins=integer(item?.minGiftCoins,"invalid_tier_threshold",0,1000000000000);
  const hostShareBps=integer(item?.hostShareBps,"invalid_host_share",0,10000);
  const agencyShareBps=integer(item?.agencyShareBps,"invalid_agency_share",0,10000);
  if(hostShareBps+agencyShareBps>10000) throw Error("invalid_split_total");
  return {
    id,nameAr,minGiftCoins,hostShareBps,agencyShareBps,
    platformShareBps:10000-hostShareBps-agencyShareBps
  };
}
export function normalizePolicy(raw={}){
  const defaults=defaultPolicy();
  const enabled=raw.policyMode==="tiered_host_agency" ? raw.enabled!==false : true;
  const hostPerformanceBonusBps=integer(
    raw.hostPerformanceBonusBps??defaults.hostPerformanceBonusBps,
    "invalid_host_bonus",0,3000
  );
  const agencyPerformanceBonusBps=integer(
    raw.agencyPerformanceBonusBps??defaults.agencyPerformanceBonusBps,
    "invalid_agency_bonus",0,3000
  );
  const hostBonusQualifiedDays=integer(
    raw.hostBonusQualifiedDays??defaults.hostBonusQualifiedDays,
    "invalid_host_bonus_days",1,31
  );
  const hostBonusMinutesPerQualifiedDay=integer(
    raw.hostBonusMinutesPerQualifiedDay??defaults.hostBonusMinutesPerQualifiedDay,
    "invalid_host_bonus_minutes",1,1440
  );
  const agencyBonusActiveHosts=integer(
    raw.agencyBonusActiveHosts??defaults.agencyBonusActiveHosts,
    "invalid_agency_bonus_hosts",1,100000
  );
  const activitySource=raw.activityPayoutBpsByQualifiedDays||defaults.activityPayoutBpsByQualifiedDays;
  const activityPayoutBpsByQualifiedDays={};
  for(let day=0;day<=9;day++){
    const key=String(day);
    activityPayoutBpsByQualifiedDays[key]=integer(
      activitySource?.[key]??defaults.activityPayoutBpsByQualifiedDays[key],
      "invalid_activity_multiplier",0,10000
    );
  }
  for(let day=1;day<=9;day++){
    if(activityPayoutBpsByQualifiedDays[String(day)]<activityPayoutBpsByQualifiedDays[String(day-1)]){
      throw Error("invalid_activity_multiplier_order");
    }
  }
  let source=Array.isArray(raw.tiers)&&raw.tiers.length?raw.tiers:defaults.tiers;
  if(source.length<1||source.length>10) throw Error("invalid_tiers");
  const tiers=source.map(normalizeTier).sort((a,b)=>a.minGiftCoins-b.minGiftCoins);
  if(tiers[0].minGiftCoins!==0) throw Error("first_tier_must_start_zero");
  for(let i=1;i<tiers.length;i++){
    if(tiers[i].minGiftCoins<=tiers[i-1].minGiftCoins) throw Error("invalid_tier_order");
  }
  for(const tier of tiers){
    if(tier.hostShareBps+tier.agencyShareBps+hostPerformanceBonusBps+agencyPerformanceBonusBps>10000){
      throw Error("bonus_exceeds_platform_share");
    }
  }
  const legacyRecipientShareBps=tiers[0].hostShareBps;
  return {
    enabled,
    policyMode:"tiered_host_agency",
    coinsPerUsd:10000,
    coinsPerDiamond:10000,
    tierPeriod:"monthly",
    settlementMode:"cycle_settlement",
    agencySupportTracking:true,
    periodTimeZone:"UTC",
    recipientShareBps:legacyRecipientShareBps,
    hostPerformanceBonusBps,
    agencyPerformanceBonusBps,
    hostBonusQualifiedDays,
    hostBonusMinutesPerQualifiedDay,
    agencyBonusActiveHosts,
    activityRuleMode:"cycle_multiplier",
    activityPayoutBpsByQualifiedDays,
    tiers
  };
}

export async function saveGiftEconomyPolicy(db,uid,raw={}){
  const policy=normalizePolicy(raw);
  const ref=db.collection("system_config").doc("gift_economy");
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
  return policy;
}

export async function handler(req,res){
  if(cors(req,res))return;
  if(req.method!=="POST")return out(res,405,{ok:false,code:"method_not_allowed"});
  try{
    initFirebase();
    const {uid,db}=await actor(req);
    const action=clean(req.body?.action);
    const ref=db.collection("system_config").doc("gift_economy");

    if(action==="state"){
      const snap=await ref.get();
      let config=defaultPolicy();
      if(snap.exists){
        const data=snap.data()||{};
        try{config=normalizePolicy(data);}
        catch(_){config={...defaultPolicy(),...data};}
      }
      return out(res,200,{ok:true,config});
    }

    if(action==="save"){
      const policy=await saveGiftEconomyPolicy(db,uid,req.body||{});
      return out(res,200,{ok:true,config:policy});
    }

    return out(res,400,{ok:false,code:"invalid_action"});
  }catch(error){
    const code=clean(error?.message)||"server_error";
    const bad=new Set([
      "invalid_tier_threshold","invalid_host_share","invalid_agency_share",
      "invalid_split_total","invalid_host_bonus","invalid_agency_bonus",
      "invalid_host_bonus_days","invalid_host_bonus_minutes",
      "invalid_agency_bonus_hosts","invalid_activity_multiplier",
      "invalid_activity_multiplier_order","invalid_tiers","first_tier_must_start_zero",
      "invalid_tier_order","bonus_exceeds_platform_share","invalid_action"
    ]);
    const status=code==="unauthorized"?401:code==="forbidden"?403:bad.has(code)?400:500;
    return out(res,status,{ok:false,code});
  }
}
