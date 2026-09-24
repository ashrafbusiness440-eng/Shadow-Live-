import { getApps, initializeApp, cert, getAuth, FieldValue, getFirestore, legacyEnv } from "../legacy-firebase-admin-shim.js";
import {
  BET_LADDERS,
  GREEDY_CAT_CHOICES,
  SLOT_OUTCOMES,
  WITCH_CHOICES,
  TARGET_RTP_BPS,
  defaultOutcomeWeights,
  validateBetLadder,
  validateOutcomeWeights,
} from "./game-engine.js";

const clean=(value)=>String(value??"").trim();
const out=(res,status,body)=>res.status(status).json(body);

function parseServiceAccount(raw){
  const text=clean(raw);
  if(!text)throw Error("server_not_configured");
  let sa=JSON.parse(text);
  if(typeof sa==="string")sa=JSON.parse(sa);
  const projectId=sa.project_id||sa.projectId;
  const clientEmail=sa.client_email||sa.clientEmail;
  const privateKey=String(sa.private_key||sa.privateKey||"").replace(/\\n/g,"\n");
  if(!projectId||!clientEmail||!privateKey)throw Error("invalid_service_account_json");
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

async function actor(req){
  const authorization=clean(req.headers.authorization);
  if(!authorization.startsWith("Bearer "))throw Error("unauthorized");
  const decoded=await getAuth().verifyIdToken(authorization.slice(7));
  const db=getFirestore();
  const snap=await db.collection("users").doc(decoded.uid).get();
  if(!snap.exists)throw Error("forbidden");
  const data=snap.data()||{};
  const role=clean(data.role);
  const capabilities=Array.isArray(data.capabilities)?data.capabilities.map(clean):[];
  const enabled=data.adminEnabled!==false;
  const canManage=enabled&&(role==="owner"||capabilities.includes("manageGames")||capabilities.includes("manageEconomy"));
  if(!canManage)throw Error("forbidden");
  return {uid:decoded.uid,db,isOwner:role==="owner",canManage};
}

const CATALOG=Object.freeze([
  Object.freeze({
    key:"greedy_cat",
    gameId:"greedy_cat",
    mode:"",
    nameAr:"القط الجشع",
    defaultBets:BET_LADDERS.greedy_cat,
    outcomeIds:Object.freeze([...Object.keys(GREEDY_CAT_CHOICES),"salad","pizza"]),
  }),
  Object.freeze({
    key:"witch_normal",
    gameId:"witch",
    mode:"normal",
    nameAr:"الساحرة — عادي",
    defaultBets:BET_LADDERS.witch_normal,
    outcomeIds:Object.freeze(Object.keys(WITCH_CHOICES.normal)),
  }),
  Object.freeze({
    key:"witch_advanced",
    gameId:"witch",
    mode:"advanced",
    nameAr:"الساحرة — متقدم",
    defaultBets:BET_LADDERS.witch_advanced,
    outcomeIds:Object.freeze(Object.keys(WITCH_CHOICES.advanced)),
  }),
  Object.freeze({
    key:"slot",
    gameId:"slot",
    mode:"",
    nameAr:"Shadow Slot",
    defaultBets:BET_LADDERS.slot,
    outcomeIds:Object.freeze(Object.keys(SLOT_OUTCOMES)),
  }),
]);

function clampRtp(value){
  const n=Number(value);
  if(!Number.isSafeInteger(n)||n<1000||n>9900)throw Error("invalid_rtp");
  return n;
}

function validateOutcomesOrEmpty(gameId,mode,outcomes,enabled){
  if((outcomes==null||outcomes.length===0)&&!enabled)return [];
  return [...validateOutcomeWeights(gameId,mode,outcomes)];
}

function defaultVariant(item){
  return {
    enabled:true,
    targetRtpBps:TARGET_RTP_BPS,
    bets:[...item.defaultBets],
    outcomes:defaultOutcomeWeights(item.gameId,item.mode),
  };
}

function readVariant(config,item){
  const games=config?.games&&typeof config.games==="object"?config.games:{};
  const game=games[item.gameId]&&typeof games[item.gameId]==="object"?games[item.gameId]:{};
  const raw=item.gameId==="witch"
    ? (game[item.mode]&&typeof game[item.mode]==="object"?game[item.mode]:{})
    : game;
  const base=defaultVariant(item);
  const hasStoredOutcomes=Array.isArray(raw.outcomes)&&raw.outcomes.length>0;
  const hasStoredEnabled=Object.prototype.hasOwnProperty.call(raw,"enabled");
  const enabled=hasStoredEnabled?raw.enabled===true:true;
  return {
    key:item.key,
    gameId:item.gameId,
    mode:item.mode,
    nameAr:item.nameAr,
    enabled,
    targetRtpBps:Number.isSafeInteger(Number(raw.targetRtpBps))
      ? Number(raw.targetRtpBps)
      : Number.isSafeInteger(Number(game.targetRtpBps))
        ? Number(game.targetRtpBps)
        : base.targetRtpBps,
    bets:Array.isArray(raw.bets)&&raw.bets.length?raw.bets:[...base.bets],
    outcomes:hasStoredOutcomes?raw.outcomes:base.outcomes,
    outcomeIds:[...item.outcomeIds],
  };
}

function applyVariant(config,item,patch){
  const source=config&&typeof config==="object"?config:{};
  const next={
    ...source,
    games:source.games&&typeof source.games==="object"?{...source.games}:{},
  };
  next.enabled=true;
  next.targetRtpBps=Number.isSafeInteger(Number(next.targetRtpBps))
    ? Number(next.targetRtpBps)
    : TARGET_RTP_BPS;
  next.timezoneOffsetMinutes=Number.isFinite(Number(next.timezoneOffsetMinutes))
    ? Number(next.timezoneOffsetMinutes)
    : 240;
  next.roundDurationSeconds=Number.isFinite(Number(next.roundDurationSeconds))
    ? Number(next.roundDurationSeconds)
    : 30;
  next.lockBeforeMs=Number.isFinite(Number(next.lockBeforeMs))
    ? Number(next.lockBeforeMs)
    : 3000;
  next.games=next.games&&typeof next.games==="object"?next.games:{};

  const targetRtpBps=clampRtp(patch.targetRtpBps);
  const bets=[...validateBetLadder(item.gameId,item.mode,patch.bets)];
  const enabled=patch.enabled===true;
  const outcomes=validateOutcomesOrEmpty(item.gameId,item.mode,patch.outcomes,enabled);

  if(item.gameId==="witch"){
    const game=next.games.witch&&typeof next.games.witch==="object"
      ? {...next.games.witch}
      : {};
    const variant=game[item.mode]&&typeof game[item.mode]==="object"
      ? {...game[item.mode]}
      : {};
    variant.enabled=enabled;
    variant.targetRtpBps=targetRtpBps;
    variant.bets=bets;
    variant.outcomes=outcomes;
    game[item.mode]=variant;
    game.enabled=Boolean(
      game.normal?.enabled===true||
      game.advanced?.enabled===true,
    );
    next.games.witch=game;
  }else{
    const game=next.games[item.gameId]&&typeof next.games[item.gameId]==="object"
      ? {...next.games[item.gameId]}
      : {};
    game.enabled=enabled;
    game.targetRtpBps=targetRtpBps;
    game.bets=bets;
    game.outcomes=outcomes;
    next.games[item.gameId]=game;
  }
  return next;
}

function publicAudit(doc){
  const data=doc.data()||{};
  return {
    id:doc.id,
    action:clean(data.action),
    actorUid:clean(data.actorUid),
    targetId:clean(data.targetId),
    reason:clean(data.reason),
    before:data.before||null,
    after:data.after||null,
    createdAt:data.createdAt||null,
  };
}

async function statsForVariant(db,item){
  const snap=await db.collection("game_rounds")
    .where("gameId","==",item.gameId)
    .limit(500)
    .get();
  let wager=0,payout=0,rounds=0,operations=0;
  for(const doc of snap.docs){
    const data=doc.data()||{};
    if(item.gameId==="witch"&&clean(data.mode)!==item.mode)continue;
    rounds++;
    wager+=Math.max(0,Number(data.totalWagerCoins||0));
    payout+=Math.max(0,Number(data.totalPayoutCoins||0));
    operations+=Math.max(0,Number(data.operationCount||0));
  }
  return {
    key:item.key,
    rounds,
    operations,
    totalWagerCoins:wager,
    totalPayoutCoins:payout,
    actualRtpBps:wager>0?Math.round((payout*10000)/wager):0,
  };
}

export async function gameControlState(db){
  const configRef=db.collection("system_config").doc("game_runtime");
  const [configSnap,auditSnap]=await Promise.all([
    configRef.get(),
    db.collection("admin_audit_logs")
      .where("targetType","==","game_runtime")
      .limit(30)
      .get(),
  ]);
  const config=configSnap.exists?(configSnap.data()||{}):{};
  const variants=CATALOG.map(item=>readVariant(config,item));
  const stats=await Promise.all(CATALOG.map(item=>statsForVariant(db,item)));
  return {
    config:{
      engineEnabled:config.enabled===true,
      timezoneOffsetMinutes:Number(config.timezoneOffsetMinutes??240),
      roundDurationSeconds:Number(config.roundDurationSeconds??30),
      lockBeforeMs:Number(config.lockBeforeMs??3000),
    },
    variants,
    stats,
    audit:auditSnap.docs.map(publicAudit),
  };
}

export async function saveGameVariant(db,actorUid,body={}){
  const key=clean(body.key);
  const item=CATALOG.find(entry=>entry.key===key);
  if(!item)throw Error("invalid_game_key");
  const reason=clean(body.reason);
  if(reason.length<3||reason.length>240)throw Error("invalid_reason");

  const configRef=db.collection("system_config").doc("game_runtime");
  const auditRef=db.collection("admin_audit_logs").doc();
  const result=await db.runTransaction(async(tx)=>{
    const configSnap=await tx.get(configRef);
    const before=configSnap.exists?(configSnap.data()||{}):{};
    const next=applyVariant(before,item,{
      enabled:body.enabled===true,
      targetRtpBps:body.targetRtpBps,
      bets:body.bets,
      outcomes:body.outcomes,
    });
    const beforeVariant=readVariant(before,item);
    const afterVariant=readVariant(next,item);
    const now=FieldValue.serverTimestamp();

    tx.set(configRef,{
      ...next,
      updatedBy:actorUid,
      updatedAt:now,
    },{merge:false});
    tx.create(auditRef,{
      actorUid,
      action:"updateGameRuntime",
      targetType:"game_runtime",
      targetId:key,
      reason,
      before:beforeVariant,
      after:afterVariant,
      createdAt:now,
    });
    return afterVariant;
  });
  return result;
}

export async function saveGameTiming(db,actorUid,body={}){
  const reason=clean(body.reason);
  if(reason.length<3||reason.length>240)throw Error("invalid_reason");
  const timezoneOffsetMinutes=Number(body.timezoneOffsetMinutes);
  const roundDurationSeconds=Number(body.roundDurationSeconds);
  const lockBeforeMs=Number(body.lockBeforeMs);
  if(!Number.isFinite(timezoneOffsetMinutes)||timezoneOffsetMinutes<-720||timezoneOffsetMinutes>840){
    throw Error("invalid_timezone");
  }
  if(!Number.isFinite(roundDurationSeconds)||roundDurationSeconds<10||roundDurationSeconds>300){
    throw Error("invalid_round_duration");
  }
  if(!Number.isFinite(lockBeforeMs)||lockBeforeMs<500||lockBeforeMs>10000){
    throw Error("invalid_lock_window");
  }

  const ref=db.collection("system_config").doc("game_runtime");
  const auditRef=db.collection("admin_audit_logs").doc();
  await db.runTransaction(async(tx)=>{
    const snap=await tx.get(ref);
    const before=snap.exists?(snap.data()||{}):{};
    const after={
      timezoneOffsetMinutes,
      roundDurationSeconds,
      lockBeforeMs,
    };
    const now=FieldValue.serverTimestamp();
    tx.set(ref,{
      ...before,
      enabled:true,
      targetRtpBps:Number.isSafeInteger(Number(before.targetRtpBps))
        ? Number(before.targetRtpBps)
        : TARGET_RTP_BPS,
      ...after,
      updatedBy:actorUid,
      updatedAt:now,
    },{merge:true});
    tx.create(auditRef,{
      actorUid,
      action:"updateGameTiming",
      targetType:"game_runtime",
      targetId:"timing",
      reason,
      before:{
        timezoneOffsetMinutes:Number(before.timezoneOffsetMinutes??240),
        roundDurationSeconds:Number(before.roundDurationSeconds??30),
        lockBeforeMs:Number(before.lockBeforeMs??3000),
      },
      after,
      createdAt:now,
    });
  });
  return {
    timezoneOffsetMinutes,
    roundDurationSeconds,
    lockBeforeMs,
  };
}

export async function handler(req,res){
  if(cors(req,res))return;
  if(req.method!=="POST")return out(res,405,{ok:false,code:"method_not_allowed"});
  try{
    initFirebase();
    const {uid,db}=await actor(req);
    const action=clean(req.body?.action);
    if(action==="state"){
      return out(res,200,{ok:true,...await gameControlState(db)});
    }
    if(action==="saveVariant"){
      const variant=await saveGameVariant(db,uid,req.body||{});
      return out(res,200,{ok:true,variant});
    }
    if(action==="saveTiming"){
      const timing=await saveGameTiming(db,uid,req.body||{});
      return out(res,200,{ok:true,timing});
    }
    throw Error("invalid_action");
  }catch(error){
    const code=clean(error?.message)||"server_error";
    const status=code==="unauthorized"?401:
      code==="forbidden"?403:
      [
        "invalid_action","invalid_game_key","invalid_reason","invalid_rtp",
        "invalid_bet_ladder","invalid_probabilities","invalid_timezone",
        "invalid_round_duration","invalid_lock_window",
      ].includes(code)?400:500;
    return out(res,status,{ok:false,code});
  }
}
