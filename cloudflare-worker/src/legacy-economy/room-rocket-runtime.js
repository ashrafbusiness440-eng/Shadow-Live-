import { getApps, initializeApp, cert, getAuth, FieldValue, getFirestore, legacyEnv } from "../legacy-firebase-admin-shim.js";
import crypto from "node:crypto";
import {
  legacyPresenceFresh,
  realtimeUserPresentFromNamespace,
} from "../room-presence-authority.js";

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
  return {uid:decoded.uid,db:getFirestore()};
}

function validId(value){
  return /^[A-Za-z0-9_.-]{1,240}$/.test(clean(value));
}

function isTop3(explosion,uid){
  return Array.isArray(explosion?.top3) &&
    explosion.top3.some((item)=>clean(item?.uid)===uid);
}

function isContributor(explosion,uid){
  return Array.isArray(explosion?.contributorIds) &&
    explosion.contributorIds.includes(uid);
}

function rewardItems(explosion){
  const pool=explosion?.rewardPool&&typeof explosion.rewardPool==="object"
    ? explosion.rewardPool : {};
  const result=[];
  for(const item of Array.isArray(pool.coinPrizes)?pool.coinPrizes:[]){
    const coins=Number(item?.coins||0);
    const weight=Number(item?.weight||0);
    if(Number.isSafeInteger(coins)&&coins>0&&Number.isSafeInteger(weight)&&weight>0){
      result.push({type:"coins",coins,weight});
    }
  }
  const groups=[
    ["frame",pool.frameRewards],
    ["entrance",pool.entranceRewards],
    ["voice_wave",pool.voiceWaveRewards],
    ["room_background",pool.roomBackgroundRewards],
  ];
  for(const [type,items] of groups){
    for(const item of Array.isArray(items)?items:[]){
      if(item?.enabled===false) continue;
      const id=clean(item?.id);
      const durationHours=Number(item?.durationHours||0);
      const weight=Number(item?.weight||0);
      const overflowCoins=Number(item?.overflowCoins||0);
      if(!id||!Number.isSafeInteger(durationHours)||durationHours<=0||
         !Number.isSafeInteger(weight)||weight<=0) continue;
      result.push({
        type,
        id,
        durationHours,
        weight,
        overflowCoins:Number.isSafeInteger(overflowCoins)&&overflowCoins>0?overflowCoins:0,
        nameAr:clean(item?.nameAr),
        assetKey:clean(item?.assetKey),
        imageUrl:clean(item?.imageUrl),
      });
    }
  }
  return result;
}

function weightedPick(items){
  const total=items.reduce((n,item)=>n+item.weight,0);
  if(total<=0) return null;
  let value=crypto.randomInt(total);
  for(const item of items){
    if(value<item.weight) return item;
    value-=item.weight;
  }
  return items[items.length-1]||null;
}

function drawAttempts(explosion,attempts){
  const chance=Math.max(0,Math.min(10000,Number(explosion?.winProbabilityBps||3000)));
  const items=rewardItems(explosion);
  const outcomes=[];
  for(let i=0;i<attempts;i+=1){
    if(crypto.randomInt(10000)>=chance||items.length===0){
      outcomes.push({won:false});
      continue;
    }
    const picked=weightedPick(items);
    outcomes.push(picked?{won:true,...picked}:{won:false});
  }
  return outcomes;
}

function rewardDocId(type,id){
  return (type+"__"+id).replace(/[^A-Za-z0-9_.-]/g,"_").slice(0,220);
}

export async function registerRocketEntry(db,uid,explosionId,nowMs=Date.now()){
  if(!validId(explosionId)) throw Error("invalid_explosion_id");
  const explosionRef=db.collection("room_rocket_explosions").doc(explosionId);
  const explosionSnap=await explosionRef.get();
  if(!explosionSnap.exists) throw Error("explosion_not_found");
  const explosion=explosionSnap.data()||{};
  const startsAtMs=Number(explosion.startsAtMs||0);
  const endsAtMs=Number(explosion.endsAtMs||0);
  if(nowMs<startsAtMs||nowMs>=endsAtMs) throw Error("reward_window_closed");

  const roomId=clean(explosion.roomId);
  if(!roomId) throw Error("invalid_room");
  const realtimePresent=await realtimeUserPresentFromNamespace(
    legacyEnv.ROOM_REALTIME,
    roomId,
    uid,
  );
  let presenceSource="room_realtime";
  if(realtimePresent===false) throw Error("not_in_room");
  if(realtimePresent===null){
    const presence=await db.collection("room_presence")
      .doc(roomId).collection("users").doc(uid).get();
    if(!legacyPresenceFresh(presence,nowMs)) throw Error("not_in_room");
    presenceSource="legacy_room_presence";
  }

  const attempts=isTop3(explosion,uid)?2:1;
  const ref=explosionRef.collection("entries").doc(uid);
  await ref.set({
    uid,
    roomId,
    explosionId,
    attempts,
    source:isContributor(explosion,uid)?"contributor_and_room":presenceSource,
    enteredAtMs:nowMs,
    createdAt:FieldValue.serverTimestamp(),
  },{merge:true});
  return {ok:true,attempts,endsAtMs};
}

export async function claimRocketReward(db,uid,explosionId,nowMs=Date.now()){
  if(!validId(explosionId)) throw Error("invalid_explosion_id");
  const explosionRef=db.collection("room_rocket_explosions").doc(explosionId);
  const entryRef=explosionRef.collection("entries").doc(uid);
  const [explosionSnap,entrySnap]=await Promise.all([
    explosionRef.get(),
    entryRef.get(),
  ]);
  if(!explosionSnap.exists) throw Error("explosion_not_found");
  const explosion=explosionSnap.data()||{};
  if(nowMs<Number(explosion.endsAtMs||0)) throw Error("reward_not_ready");

  const contributor=isContributor(explosion,uid);
  if(!contributor&&!entrySnap.exists) throw Error("not_eligible");

  const attempts=isTop3(explosion,uid)?2:1;
  const drawnOutcomes=drawAttempts(explosion,attempts);
  const resultRef=explosionRef.collection("results").doc(uid);
  const userRef=db.collection("users").doc(uid);
  const noWinMessageAr=clean(explosion.noWinMessageAr)||"حظ أوفر في المرة القادمة";
  const capHours=Math.max(1,Number(explosion.cosmeticStackCapHours||720));
  const awardAtMs=Math.max(0,Number(explosion.endsAtMs||nowMs));
  const cosmeticTypes=new Set(["frame","entrance","voice_wave","room_background"]);
  const cosmeticKeys=[...new Set(drawnOutcomes
    .filter((item)=>item.won&&cosmeticTypes.has(item.type))
    .map((item)=>item.type+"::"+item.id))];

  const rewardRefs=new Map();
  for(const key of cosmeticKeys){
    const [type,id]=key.split("::");
    rewardRefs.set(
      key,
      db.collection("user_rewards").doc(uid)
        .collection("items").doc(rewardDocId(type,id)),
    );
  }

  const result=await db.runTransaction(async tx=>{
    const rewardEntries=[...rewardRefs.entries()];
    const [again,userSnap,...rewardSnaps]=await Promise.all([
      tx.get(resultRef),
      tx.get(userRef),
      ...rewardEntries.map(([,ref])=>tx.get(ref)),
    ]);
    if(again.exists) return {duplicate:true,result:again.data()};
    if(!userSnap.exists) throw Error("user_not_found");

    const cosmeticState=new Map();
    rewardEntries.forEach(([key],index)=>{
      const snap=rewardSnaps[index];
      const data=snap?.exists?(snap.data()||{}):{};
      cosmeticState.set(key,{
        expiresAtMs:Math.max(awardAtMs,Number(data.expiresAtMs||0)),
        active:data.active===true,
      });
    });

    const resolved=[];
    let coinAward=0;
    for(const outcome of drawnOutcomes){
      if(!outcome.won){
        resolved.push({won:false,messageAr:noWinMessageAr});
        continue;
      }
      if(outcome.type==="coins"){
        coinAward+=outcome.coins;
        resolved.push({won:true,type:"coins",coins:outcome.coins});
        continue;
      }

      const key=outcome.type+"::"+outcome.id;
      const state=cosmeticState.get(key)||{expiresAtMs:awardAtMs,active:false};
      const requestedMs=outcome.durationHours*3600000;
      const capEndMs=awardAtMs+capHours*3600000;
      const requestedEndMs=state.expiresAtMs+requestedMs;
      const grantedEndMs=Math.min(requestedEndMs,capEndMs);
      const grantedMs=Math.max(0,grantedEndMs-state.expiresAtMs);
      const overflowMs=Math.max(0,requestedMs-grantedMs);
      const overflowRatio=requestedMs>0?overflowMs/requestedMs:0;
      const convertedCoins=Math.floor((outcome.overflowCoins||0)*overflowRatio);
      coinAward+=convertedCoins;
      state.expiresAtMs=grantedEndMs;
      cosmeticState.set(key,state);
      resolved.push({
        won:true,
        type:outcome.type,
        rewardId:outcome.id,
        nameAr:clean(outcome.nameAr),
        assetKey:clean(outcome.assetKey),
        imageUrl:clean(outcome.imageUrl),
        durationHours:outcome.durationHours,
        expiresAtMs:grantedEndMs,
        convertedCoins,
      });
    }

    const now=FieldValue.serverTimestamp();
    if(coinAward>0){
      tx.update(userRef,{
        coins:FieldValue.increment(coinAward),
        walletUpdatedAt:now,
      });
      const ledgerRef=db.collection("financial_ledger")
        .doc("rocket_"+explosionId+"_"+uid);
      tx.create(ledgerRef,{
        userId:uid,
        asset:"coins",
        delta:coinAward,
        reason:"room_rocket_reward",
        sourceType:"room_rocket",
        sourceId:explosionId,
        roomId:clean(explosion.roomId),
        actorUid:"system",
        createdAt:now,
      });
    }

    for(const [key,state] of cosmeticState){
      const [type,id]=key.split("::");
      const ref=rewardRefs.get(key);
      tx.set(ref,{
        type,
        rewardId:id,
        nameAr:clean(
          resolved.find((item)=>item.won&&item.type===type&&item.rewardId===id)?.nameAr,
        ),
        assetKey:clean(
          resolved.find((item)=>item.won&&item.type===type&&item.rewardId===id)?.assetKey,
        ),
        imageUrl:clean(
          resolved.find((item)=>item.won&&item.type===type&&item.rewardId===id)?.imageUrl,
        ),
        expiresAtMs:state.expiresAtMs,
        active:state.active===true,
        source:"room_rocket",
        sourceExplosionId:explosionId,
        updatedAt:now,
      },{merge:true});
    }

    const stored={
      uid,
      roomId:clean(explosion.roomId),
      explosionId,
      level:Number(explosion.level||0),
      attempts,
      outcomes:resolved,
      coinAward,
      private:true,
      awardedAtMs:awardAtMs,
      claimedAtMs:nowMs,
      createdAt:now,
    };
    tx.create(resultRef,stored);

    const notificationRef=db.collection("notifications").doc();
    tx.create(notificationRef,{
      userId:uid,
      type:"system",
      category:"gifts",
      title:"نتيجة صاروخ الغرفة 🚀",
      body:resolved.some((item)=>item.won)
        ?"تمت إضافة جائزة صاروخ الغرفة إلى حسابك."
        : noWinMessageAr,
      data:{
        kind:"room_rocket_result",
        explosionId,
        roomId:clean(explosion.roomId),
        level:Number(explosion.level||0),
      },
      read:false,
      timestamp:now,
    });
    return {duplicate:false,result:stored};
  });

  return {ok:true,...result};
}

export async function handler(req,res){
  if(cors(req,res)) return;
  if(req.method!=="POST") return out(res,405,{ok:false,code:"method_not_allowed"});
  try{
    initFirebase();
    const {uid,db}=await actor(req);
    const action=clean(req.body?.action);
    const explosionId=clean(req.body?.explosionId);
    if(action==="enter"){
      const result=await registerRocketEntry(db,uid,explosionId);
      return out(res,200,result);
    }
    if(action==="claim"){
      const result=await claimRocketReward(db,uid,explosionId);
      return out(res,200,result);
    }
    return out(res,400,{ok:false,code:"invalid_action"});
  }catch(error){
    const code=clean(error?.message)||"server_error";
    const notFound=new Set(["explosion_not_found","user_not_found"]);
    const conflict=new Set(["reward_window_closed","reward_not_ready","not_in_room","not_eligible"]);
    const bad=new Set(["invalid_action","invalid_explosion_id","invalid_room"]);
    const status=code==="unauthorized"?401:notFound.has(code)?404:conflict.has(code)?409:bad.has(code)?400:500;
    return out(res,status,{ok:false,code:status===500?"room_rocket_failed":code});
  }
}
