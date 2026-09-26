import { getApps, initializeApp, cert, getAuth, FieldValue, getFirestore, legacyEnv } from "../legacy-firebase-admin-shim.js";
import {
  TARGET_RTP_BPS,
  calculatePayout,
  defaultOutcomeWeights,
  dailyRoundClock,
  normalizeBetEvents,
  normalizeSelections,
  resolveOutcome,
  slotReelsForOutcome,
  totalStake,
  validIdempotencyKey,
  validateBetLadder,
  validateOutcomeWeights,
} from "./game-engine.js";
import { readThroughConfigCache } from "../config-cache.js";

const clean=(value)=>String(value??"").trim();
const validRoomId=(value)=>/^[A-Za-z0-9_-]{1,180}$/.test(clean(value));

function realtimeRoomStub(roomId){
  const namespace=legacyEnv.ROOM_REALTIME;
  if(!namespace||!validRoomId(roomId))return null;
  try{
    return namespace.get(namespace.idFromName(roomId));
  }catch(_){
    return null;
  }
}

async function realtimeGameUserPresent(roomId,uid){
  const stub=realtimeRoomStub(roomId);
  if(!stub)return null;
  try{
    const target=new URL("https://room-realtime.internal/presence/has");
    target.searchParams.set("uid",clean(uid));
    const response=await stub.fetch(target.toString());
    if(!response.ok)return null;
    const body=await response.json().catch(()=>({}));
    return body.present===true;
  }catch(_){
    return null;
  }
}

async function registerGameRealtimeSchedules(roomId,uid,schedules){
  const stub=realtimeRoomStub(roomId);
  if(!stub||!Array.isArray(schedules)||schedules.length===0)return false;
  try{
    const response=await stub.fetch("https://room-realtime.internal/game/register",{
      method:"POST",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({
        roomId:clean(roomId),
        uid:clean(uid),
        schedules,
      }),
    });
    return response.ok;
  }catch(_){
    return false;
  }
}

const GAME_RUNTIME_CACHE_KEY="config:game_runtime";

function transientFirestoreError(error){
  const code=clean(error?.message);
  const status=Number(error?.status||0);
  return status===429||
    status===408||
    status>=500||
    [
      "RESOURCE_EXHAUSTED",
      "UNAVAILABLE",
      "DEADLINE_EXCEEDED",
      "firestore_request_failed",
    ].includes(code);
}

async function loadRuntimeConfig(db,{allowFallback=false}={}){
  try{
    return await readThroughConfigCache(
      GAME_RUNTIME_CACHE_KEY,
      async()=>{
        const snap=await db.collection("system_config").doc("game_runtime").get();
        return runtimeConfig(snap.exists?snap.data()||{}:{});
      },
      {
        ttlMs:30000,
        staleMs:5*60*1000,
        allowStaleOnError:allowFallback,
      },
    );
  }catch(error){
    if(!allowFallback||!transientFirestoreError(error))throw error;
    return runtimeConfig({});
  }
}

const FALLBACK_CONFIG=Object.freeze({
  enabled:true,
  targetRtpBps:TARGET_RTP_BPS,
  timezoneOffsetMinutes:240,
  roundDurationSeconds:30,
  lockBeforeMs:3000,
  resultHoldMs:4000,
  games:Object.freeze({
    greedy_cat:Object.freeze({
      enabled:true,
      outcomes:Object.freeze(defaultOutcomeWeights("greedy_cat")),
    }),
    witch:Object.freeze({
      enabled:true,
      normal:Object.freeze({
        enabled:true,
        outcomes:Object.freeze(defaultOutcomeWeights("witch","normal")),
      }),
      advanced:Object.freeze({
        enabled:true,
        outcomes:Object.freeze(defaultOutcomeWeights("witch","advanced")),
      }),
    }),
    slot:Object.freeze({
      enabled:true,
      outcomes:Object.freeze(defaultOutcomeWeights("slot")),
    }),
  }),
});

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
  res.setHeader("Access-Control-Allow-Methods","GET,POST,OPTIONS");
  if(req.method==="OPTIONS"){
    res.status(204).end();
    return true;
  }
  return false;
}

const out=(res,status,body)=>res.status(status).json(body);

async function actor(req,{checkUserState=true}={}){
  const authorization=clean(req.headers.authorization);
  if(!authorization.startsWith("Bearer "))throw Error("unauthorized");
  const decoded=await getAuth().verifyIdToken(
    authorization.slice(7),
    {checkUserState},
  );
  if(decoded.firebase?.sign_in_provider==="anonymous")throw Error("account_required");
  return decoded;
}

function runtimeConfig(raw={}){
  const games=raw?.games&&typeof raw.games==="object"?raw.games:{};
  return {
    enabled:raw?.enabled!==false,
    targetRtpBps:Number.isSafeInteger(Number(raw?.targetRtpBps))
      ? Math.max(1000,Math.min(9900,Number(raw.targetRtpBps)))
      : TARGET_RTP_BPS,
    timezoneOffsetMinutes:Number.isFinite(Number(raw?.timezoneOffsetMinutes))
      ? Math.max(-720,Math.min(840,Number(raw.timezoneOffsetMinutes)))
      : 240,
    roundDurationSeconds:Number.isFinite(Number(raw?.roundDurationSeconds))
      ? Math.max(10,Math.min(300,Number(raw.roundDurationSeconds)))
      : 30,
    lockBeforeMs:Number.isFinite(Number(raw?.lockBeforeMs))
      ? Math.max(500,Math.min(10000,Number(raw.lockBeforeMs)))
      : 3000,
    resultHoldMs:Number.isFinite(Number(raw?.resultHoldMs))
      ? Math.max(2000,Math.min(10000,Number(raw.resultHoldMs)))
      : 4000,
    games:{
      greedy_cat:{
        ...FALLBACK_CONFIG.games.greedy_cat,
        ...(games.greedy_cat||{}),
        enabled:Object.prototype.hasOwnProperty.call(games.greedy_cat||{},"enabled")
          ? games.greedy_cat.enabled===true
          : true,
        outcomes:Array.isArray(games.greedy_cat?.outcomes)&&games.greedy_cat.outcomes.length
          ? games.greedy_cat.outcomes
          : defaultOutcomeWeights("greedy_cat"),
      },
      witch:{
        ...FALLBACK_CONFIG.games.witch,
        ...(games.witch||{}),
        normal:{
          ...FALLBACK_CONFIG.games.witch.normal,
          ...(games.witch?.normal||{}),
          enabled:Object.prototype.hasOwnProperty.call(games.witch?.normal||{},"enabled")
            ? games.witch.normal.enabled===true
            : true,
          outcomes:Array.isArray(games.witch?.normal?.outcomes)&&games.witch.normal.outcomes.length
            ? games.witch.normal.outcomes
            : defaultOutcomeWeights("witch","normal"),
        },
        advanced:{
          ...FALLBACK_CONFIG.games.witch.advanced,
          ...(games.witch?.advanced||{}),
          enabled:Object.prototype.hasOwnProperty.call(games.witch?.advanced||{},"enabled")
            ? games.witch.advanced.enabled===true
            : true,
          outcomes:Array.isArray(games.witch?.advanced?.outcomes)&&games.witch.advanced.outcomes.length
            ? games.witch.advanced.outcomes
            : defaultOutcomeWeights("witch","advanced"),
        },
      },
      slot:{
        ...FALLBACK_CONFIG.games.slot,
        ...(games.slot||{}),
        enabled:Object.prototype.hasOwnProperty.call(games.slot||{},"enabled")
          ? games.slot.enabled===true
          : true,
        outcomes:Array.isArray(games.slot?.outcomes)&&games.slot.outcomes.length
          ? games.slot.outcomes
          : defaultOutcomeWeights("slot"),
      },
    },
  };
}

function gameConfig(config,gameId,mode){
  if(!config.enabled)throw Error("games_disabled");
  const game=config.games?.[gameId];
  if(!game)throw Error("game_disabled");
  if(gameId==="witch"){
    if(!["normal","advanced"].includes(mode))throw Error("invalid_mode");
    const variant=game[mode]||{};
    if(variant.enabled!==true)throw Error("game_disabled");
    return {
      ...game,
      ...variant,
      enabled:true,
      targetRtpBps:Number.isSafeInteger(Number(variant.targetRtpBps))
        ? Math.max(1000,Math.min(9900,Number(variant.targetRtpBps)))
        : Number.isSafeInteger(Number(game.targetRtpBps))
          ? Math.max(1000,Math.min(9900,Number(game.targetRtpBps)))
          : config.targetRtpBps,
      outcomes:validateOutcomeWeights(gameId,mode,variant.outcomes),
    };
  }
  if(game.enabled!==true)throw Error("game_disabled");
  return {
    ...game,
    targetRtpBps:Number.isSafeInteger(Number(game.targetRtpBps))
      ? Math.max(1000,Math.min(9900,Number(game.targetRtpBps)))
      : config.targetRtpBps,
    outcomes:validateOutcomeWeights(gameId,mode,game.outcomes),
  };
}

function buildRound({config,gameId,mode,uid,key,nowMs}){
  if(gameId==="slot"){
    return {
      dayKey:new Date(nowMs).toISOString().slice(0,10),
      roundNumber:0,
      opensAtMs:nowMs,
      closesAtMs:nowMs,
      bettingClosesAtMs:nowMs,
      revealAtMs:nowMs,
      resultHoldEndsAtMs:nowMs,
      nextRoundOpensAtMs:nowMs,
      roundId:gameId+":"+uid+":"+key,
    };
  }
  const cycleDurationSeconds=
    config.roundDurationSeconds+(config.resultHoldMs/1000);
  const clock=dailyRoundClock({
    nowMs,
    durationSeconds:cycleDurationSeconds,
    timezoneOffsetMinutes:config.timezoneOffsetMinutes,
    gameId,
    mode,
  });
  const nextRoundOpensAtMs=clock.closesAtMs;
  const revealAtMs=
    clock.opensAtMs+(config.roundDurationSeconds*1000);
  const bettingClosesAtMs=revealAtMs-config.lockBeforeMs;
  return Object.freeze({
    ...clock,
    closesAtMs:revealAtMs,
    bettingClosesAtMs,
    revealAtMs,
    resultHoldEndsAtMs:revealAtMs+config.resultHoldMs,
    nextRoundOpensAtMs,
  });
}

function realtimeRoundPayload(gameId,mode,round){
  return {
    gameId,
    mode,
    roundId:clean(round?.roundId),
    dayKey:clean(round?.dayKey),
    roundNumber:Number(round?.roundNumber||0),
    opensAtMs:Number(round?.opensAtMs||0),
    closesAtMs:Number(round?.closesAtMs||round?.revealAtMs||0),
    bettingClosesAtMs:Number(round?.bettingClosesAtMs||0),
    revealAtMs:Number(round?.revealAtMs||round?.closesAtMs||0),
    resultHoldEndsAtMs:Number(round?.resultHoldEndsAtMs||0),
    nextRoundOpensAtMs:Number(round?.nextRoundOpensAtMs||0),
  };
}

function gameRealtimeSchedules({
  config,
  selected,
  gameId,
  mode,
  uid,
  nowMs,
  rngSecret,
}){
  if(gameId==="slot")return [];
  const current=buildRound({
    config,
    gameId,
    mode,
    uid,
    key:"realtime_current",
    nowMs,
  });
  const next=buildRound({
    config,
    gameId,
    mode,
    uid,
    key:"realtime_next",
    nowMs:Number(current.nextRoundOpensAtMs||0)+1,
  });
  const following=buildRound({
    config,
    gameId,
    mode,
    uid,
    key:"realtime_following",
    nowMs:Number(next.nextRoundOpensAtMs||0)+1,
  });
  const resolve=(round)=>resolveOutcome({
    gameId,
    mode,
    outcomes:selected.outcomes,
    roundId:round.roundId,
    secret:rngSecret,
  }).outcomeId;

  return [
    {
      round:realtimeRoundPayload(gameId,mode,current),
      outcomeId:resolve(current),
      nextRound:realtimeRoundPayload(gameId,mode,next),
    },
    {
      round:realtimeRoundPayload(gameId,mode,next),
      outcomeId:resolve(next),
      nextRound:realtimeRoundPayload(gameId,mode,following),
    },
  ];
}

function publicOperation(data={}){
  return {
    operationId:clean(data.operationId),
    gameId:clean(data.gameId),
    mode:clean(data.mode),
    roundId:clean(data.roundId),
    roundNumber:Number(data.roundNumber||0),
    dayKey:clean(data.dayKey),
    totalStakeCoins:Number(data.totalStakeCoins||0),
    payoutCoins:data.status==="settled"?Number(data.payoutCoins||0):null,
    status:clean(data.status),
    opensAtMs:Number(data.opensAtMs||0),
    closesAtMs:Number(data.closesAtMs||0),
    outcomeId:data.status==="settled"?clean(data.outcomeId):null,
    reels:data.status==="settled"&&Array.isArray(data.reels)?data.reels:[],
    balanceAfter:Number(data.balanceAfter||0),
  };
}

function participantPublic(data={},rank=null){
  const stake=Number(data.totalStakeCoins||0);
  const payout=Number(data.payoutCoins||0);
  return {
    userId:clean(data.userId),
    displayName:clean(data.displayName),
    photoUrl:clean(data.photoUrl),
    stakeCoins:Number.isSafeInteger(stake)&&stake>0?stake:0,
    payoutCoins:Number.isSafeInteger(payout)&&payout>0?payout:0,
    won:Number.isSafeInteger(payout)&&payout>0,
    ...(rank==null?{}:{rank}),
  };
}

async function roundResultSummary(db,roundId,uid){
  const id=clean(roundId);
  if(!id)return {topWinners:[],myRound:null};
  const participants=db.collection("game_rounds").doc(id).collection("participants");
  const [leadersSnap,mySnap]=await Promise.all([
    participants.orderBy("payoutCoins","desc").limit(3).get(),
    participants.doc(uid).get(),
  ]);
  const topWinners=leadersSnap.docs
    .map((doc,index)=>participantPublic(doc.data()||{},index+1))
    .filter(item=>item.payoutCoins>0);
  let myRound=mySnap.exists?participantPublic(mySnap.data()||{}):null;
  if(myRound){
    const ranked=topWinners.find(item=>item.userId===uid);
    myRound={...myRound,winnerRank:ranked?.rank??null};
  }
  return {topWinners,myRound};
}

function ledgerBase({uid,operationId,gameId,roundId,now}){
  return {
    userId:uid,
    operationId,
    gameId,
    roundId,
    sourceType:"game",
    createdAt:now,
  };
}

export async function placeGameBet(
  db,
  uid,
  body={},
  {
    nowMs=Date.now(),
    rngSecret=legacyEnv.GAME_RNG_SECRET,
  }={},
){
  const gameId=clean(body.gameId);
  const mode=gameId==="witch"?clean(body.mode||"normal"):"";
  const roomId=clean(body.roomId);
  const key=clean(body.idempotencyKey);
  if(!validRoomId(roomId)||!validIdempotencyKey(key)){
    throw Error("invalid_request");
  }

  const operationId=uid+"__"+key;
  const userRef=db.collection("users").doc(uid);
  const roomRef=db.collection("rooms").doc(roomId);
  const presenceRef=db.collection("room_presence").doc(roomId).collection("users").doc(uid);
  const configRef=db.collection("system_config").doc("game_runtime");
  const lockRef=db.collection("system_config").doc("emergency_lock");
  const operationRef=db.collection("game_operations").doc(operationId);

  const realtimePresent=await realtimeGameUserPresent(roomId,uid);
  if(realtimePresent===false){
    const existing=await operationRef.get();
    if(existing.exists){
      return {ok:true,code:"duplicate",...publicOperation(existing.data()||{})};
    }
    throw Error("user_not_in_room");
  }
  const useLegacyPresence=realtimePresent===null;

  return db.runTransaction(async(tx)=>{
    const [userSnap,roomSnap,presenceSnap,configSnap,lockSnap,operationSnap]=
      await Promise.all([
        tx.get(userRef),
        tx.get(roomRef),
        useLegacyPresence?tx.get(presenceRef):Promise.resolve(null),
        tx.get(configRef),
        tx.get(lockRef),
        tx.get(operationRef),
      ]);

    if(operationSnap.exists){
      return {ok:true,code:"duplicate",...publicOperation(operationSnap.data()||{})};
    }
    if(!userSnap.exists)throw Error("user_not_found");
    if(!roomSnap.exists||roomSnap.data()?.isActive===false)throw Error("room_unavailable");
    if(useLegacyPresence){
      const lastSeenAtMs=Number(presenceSnap?.data()?.lastSeenAtMs||0);
      if(!presenceSnap?.exists||nowMs-lastSeenAtMs>90000){
        throw Error("user_not_in_room");
      }
    }

    const lock=lockSnap.exists?(lockSnap.data()||{}):{};
    if(lock.enabled===true||lock.economyLocked===true||lock.gamesLocked===true){
      throw Error("emergency_locked");
    }

    const config=runtimeConfig(configSnap.exists?configSnap.data()||{}:{});
    const selectedConfig=gameConfig(config,gameId,mode);
    const betEvents=normalizeBetEvents(gameId,mode,body.bets,selectedConfig.bets);
    const selections=normalizeSelections(gameId,mode,betEvents,selectedConfig.bets);
    const stake=totalStake(selections);
    const round=buildRound({config,gameId,mode,uid,key,nowMs});
    if(gameId!=="slot"&&nowMs>=round.bettingClosesAtMs){
      throw Error("round_locked");
    }

    const resolved=resolveOutcome({
      gameId,
      mode,
      outcomes:selectedConfig.outcomes,
      roundId:round.roundId,
      secret:rngSecret,
    });
    const payout=calculatePayout({
      gameId,
      mode,
      selections,
      outcomeId:resolved.outcomeId,
    });
    const reels=gameId==="slot"
      ? slotReelsForOutcome(resolved.outcomeId,resolved.entropyDigest)
      : [];

    const user=userSnap.data()||{};
    const before=Number(user.coins??user.balance??0);
    if(!Number.isSafeInteger(before)||before<0)throw Error("invalid_wallet_state");
    if(before<stake)throw Error("insufficient_balance");

    const now=FieldValue.serverTimestamp();
    const debitBalance=before-stake;
    const settled=gameId==="slot";
    const finalBalance=settled?debitBalance+payout:debitBalance;
    if(!Number.isSafeInteger(finalBalance)||finalBalance<0)throw Error("invalid_wallet_state");

    const roundRef=db.collection("game_rounds").doc(round.roundId);
    const participantRef=roundRef.collection("participants").doc(uid);
    const debitLedgerRef=db.collection("financial_ledger").doc("game_debit__"+operationId);
    const creditLedgerRef=db.collection("financial_ledger").doc("game_credit__"+operationId);
    const historyRef=db.collection("game_user_history")
      .doc(uid).collection("items").doc(operationId);

    tx.update(userRef,{
      coins:finalBalance,
      walletUpdatedAt:now,
    });

    const operation={
      operationId,
      idempotencyKey:key,
      userId:uid,
      roomId,
      gameId,
      mode,
      betEvents,
      selections,
      totalStakeCoins:stake,
      payoutCoins:payout,
      outcomeId:resolved.outcomeId,
      reels,
      entropyDigest:resolved.entropyDigest,
      status:settled?"settled":"pending",
      dayKey:round.dayKey,
      roundNumber:round.roundNumber,
      roundId:round.roundId,
      opensAtMs:round.opensAtMs,
      closesAtMs:round.closesAtMs,
      balanceBefore:before,
      balanceAfter:finalBalance,
      targetRtpBps:selectedConfig.targetRtpBps,
      createdAt:now,
      updatedAt:now,
      ...(settled?{settledAt:now}:{}),
    };
    tx.create(operationRef,operation);
    tx.create(debitLedgerRef,{
      ...ledgerBase({uid,operationId,gameId,roundId:round.roundId,now}),
      type:"game_bet_debit",
      delta:-stake,
      openingBalance:before,
      closingBalance:debitBalance,
      idempotencyKey:key,
    });

    if(settled&&payout>0){
      tx.create(creditLedgerRef,{
        ...ledgerBase({uid,operationId,gameId,roundId:round.roundId,now}),
        type:"game_payout_credit",
        delta:payout,
        openingBalance:debitBalance,
        closingBalance:finalBalance,
        idempotencyKey:key,
      });
    }

    const choiceTotals={};
    if(gameId!=="slot"){
      for(const selection of selections){
        const choiceId=clean(selection?.choiceId);
        const amountCoins=Number(selection?.amountCoins||0);
        if(choiceId&&Number.isSafeInteger(amountCoins)&&amountCoins>0){
          choiceTotals[choiceId]=FieldValue.increment(amountCoins);
        }
      }
    }
    tx.set(roundRef,{
      gameId,
      mode,
      dayKey:round.dayKey,
      roundNumber:round.roundNumber,
      roundId:round.roundId,
      opensAtMs:round.opensAtMs,
      closesAtMs:round.closesAtMs,
      bettingClosesAtMs:round.bettingClosesAtMs,
      revealAtMs:round.revealAtMs,
      resultHoldEndsAtMs:round.resultHoldEndsAtMs,
      nextRoundOpensAtMs:round.nextRoundOpensAtMs,
      outcomeId:resolved.outcomeId,
      entropyDigest:resolved.entropyDigest,
      targetRtpBps:selectedConfig.targetRtpBps,
      status:settled?"settled":"open",
      totalWagerCoins:FieldValue.increment(stake),
      totalPayoutCoins:FieldValue.increment(settled?payout:0),
      operationCount:FieldValue.increment(1),
      settledOperationCount:FieldValue.increment(settled?1:0),
      ...(gameId!=="slot"?{choiceTotals}:{}),
      updatedAt:now,
      createdAt:now,
    },{merge:true});

    if(gameId!=="slot"){
      tx.set(participantRef,{
        userId:uid,
        displayName:clean(
          user.displayName||user.name||user.publicName||user.username||uid
        ),
        photoUrl:clean(
          user.photoUrl||user.photoURL||user.profileImageUrl||user.avatarUrl||""
        ),
        totalStakeCoins:FieldValue.increment(stake),
        payoutCoins:FieldValue.increment(payout),
        operationCount:FieldValue.increment(1),
        updatedAt:now,
        createdAt:now,
      },{merge:true});
    }

    if(settled){
      tx.set(historyRef,{
        operationId,
        gameId,
        mode,
        roomId,
        roundId:round.roundId,
        roundNumber:round.roundNumber,
        dayKey:round.dayKey,
        betEvents,
        selections,
        totalStakeCoins:stake,
        payoutCoins:payout,
        outcomeId:resolved.outcomeId,
        reels,
        settledAt:now,
      });
    }

    return {
      ok:true,
      code:"ok",
      ...publicOperation(operation),
    };
  });
}

async function settleOperationRef(db,operationRef,nowMs,{workerTag=""}={}){
  return db.runTransaction(async(tx)=>{
    const operationSnap=await tx.get(operationRef);
    if(!operationSnap.exists)throw Error("operation_not_found");
    const operation=operationSnap.data()||{};
    if(operation.status==="settled"){
      return {ok:true,code:"duplicate",...publicOperation(operation)};
    }
    if(operation.status!=="pending")throw Error("invalid_operation_state");
    if(nowMs<Number(operation.closesAtMs||0))throw Error("round_not_finished");

    const uid=clean(operation.userId);
    const operationId=clean(operation.operationId||operationRef.id);
    const userRef=db.collection("users").doc(uid);
    const userSnap=await tx.get(userRef);
    if(!userSnap.exists)throw Error("user_not_found");

    const payout=Math.max(0,Number(operation.payoutCoins||0));
    const before=Number(userSnap.data()?.coins??userSnap.data()?.balance??0);
    if(!Number.isSafeInteger(before)||before<0||!Number.isSafeInteger(payout)){
      throw Error("invalid_wallet_state");
    }
    const after=before+payout;
    if(!Number.isSafeInteger(after))throw Error("invalid_wallet_state");

    const now=FieldValue.serverTimestamp();
    const roundRef=db.collection("game_rounds").doc(clean(operation.roundId));
    const creditLedgerRef=db.collection("financial_ledger").doc("game_credit__"+operationId);
    const historyRef=db.collection("game_user_history")
      .doc(uid).collection("items").doc(operationId);
    const dailyStatsRef=db.collection("game_user_stats")
      .doc(uid).collection("daily")
      .doc(clean(operation.gameId)+"__"+clean(operation.dayKey));

    tx.update(userRef,{
      coins:after,
      walletUpdatedAt:now,
    });
    tx.update(operationRef,{
      status:"settled",
      balanceAfter:after,
      settledAt:now,
      updatedAt:now,
      ...(workerTag?{settlementWorker:workerTag}:{}),
    });
    if(payout>0){
      tx.create(creditLedgerRef,{
        ...ledgerBase({
          uid,
          operationId,
          gameId:clean(operation.gameId),
          roundId:clean(operation.roundId),
          now,
        }),
        type:"game_payout_credit",
        delta:payout,
        openingBalance:before,
        closingBalance:after,
        idempotencyKey:clean(operation.idempotencyKey),
      });
    }
    tx.set(roundRef,{
      status:"settled",
      totalPayoutCoins:FieldValue.increment(payout),
      settledOperationCount:FieldValue.increment(1),
      updatedAt:now,
    },{merge:true});
    tx.set(historyRef,{
      operationId,
      gameId:clean(operation.gameId),
      mode:clean(operation.mode),
      roomId:clean(operation.roomId),
      roundId:clean(operation.roundId),
      roundNumber:Number(operation.roundNumber||0),
      dayKey:clean(operation.dayKey),
      betEvents:Array.isArray(operation.betEvents)?operation.betEvents:[],
      selections:Array.isArray(operation.selections)?operation.selections:[],
      totalStakeCoins:Number(operation.totalStakeCoins||0),
      payoutCoins:payout,
      outcomeId:clean(operation.outcomeId),
      reels:Array.isArray(operation.reels)?operation.reels:[],
      settledAt:now,
    });
    tx.set(dailyStatsRef,{
      userId:uid,
      gameId:clean(operation.gameId),
      dayKey:clean(operation.dayKey),
      payoutCoins:FieldValue.increment(payout),
      settledOperationCount:FieldValue.increment(1),
      updatedAt:now,
    },{merge:true});

    return {
      ok:true,
      code:"ok",
      ...publicOperation({...operation,status:"settled",balanceAfter:after}),
    };
  });
}

export async function settleGameOperation(db,uid,body={},options={}){
  const key=clean(body.idempotencyKey);
  if(!validIdempotencyKey(key))throw Error("invalid_request");
  return settleOperationRef(
    db,
    db.collection("game_operations").doc(uid+"__"+key),
    Number(options.nowMs||Date.now()),
  );
}

export async function settleDueGameOperations(
  db,
  {
    nowMs=Date.now(),
    limit=50,
    workerTag="",
  }={},
){
  const snapshot=await db.collection("game_operations")
    .where("status","==","pending")
    .limit(Math.max(1,Math.min(100,Number(limit||50))))
    .get();
  const due=snapshot.docs.filter(
    doc=>Number(doc.data()?.closesAtMs||0)<=nowMs,
  );
  const results=[];
  for(const doc of due){
    try{
      results.push(await settleOperationRef(db,doc.ref,nowMs,{workerTag}));
    }catch(error){
      results.push({
        ok:false,
        operationId:doc.id,
        code:clean(error?.message)||"settlement_failed",
      });
    }
  }
  return {checked:snapshot.size,settled:results.filter(x=>x.ok).length,results};
}

export async function gameCatalog(db){
  const config=await loadRuntimeConfig(db,{allowFallback:true});
  const items=[];

  const add=(key,gameId,mode,label)=>{
    try{
      const selected=gameConfig(config,gameId,mode);
      items.push({
        key,
        gameId,
        mode,
        label,
        targetRtpBps:selected.targetRtpBps,
        bets:[...validateBetLadder(gameId,mode,selected.bets)],
      });
    }catch(error){
      if(clean(error?.message)!=="game_disabled"&&
        clean(error?.message)!=="games_disabled"){
        throw error;
      }
    }
  };

  add("greedy_cat","greedy_cat","","القط الجشع");
  add("witch_normal","witch","normal","الساحرة — عادي");
  add("witch_advanced","witch","advanced","الساحرة — متقدم");
  add("slot","slot","","Shadow Slot");

  return {
    ok:true,
    engineEnabled:config.enabled===true,
    timezoneOffsetMinutes:config.timezoneOffsetMinutes,
    roundDurationSeconds:config.roundDurationSeconds,
    spinDurationMs:config.lockBeforeMs,
    resultHoldMs:config.resultHoldMs,
    items,
  };
}

export async function gameState(db,uid,body={},options={}){
  const gameId=clean(body.gameId);
  const mode=gameId==="witch"?clean(body.mode||"normal"):"";
  const roomId=clean(body.roomId);
  const nowMs=Number(options.nowMs||Date.now());

  try{
    const userDueSnapshot=await db.collection("game_operations")
      .where("userId","==",uid)
      .limit(50)
      .get();
    for(const doc of userDueSnapshot.docs){
      const operation=doc.data()||{};
      if(operation.status!=="pending")continue;
      if(Number(operation.closesAtMs||0)>nowMs)continue;
      try{
        await settleOperationRef(db,doc.ref,nowMs);
      }catch(error){
        const code=clean(error?.message);
        if(!["operation_not_found","invalid_operation_state"].includes(code)){
          throw error;
        }
      }
    }
  }catch(error){
    if(!transientFirestoreError(error))throw error;
  }

  const config=await loadRuntimeConfig(db,{allowFallback:true});
  const selected=gameConfig(config,gameId,mode);
  const round=buildRound({
    config,
    gameId,
    mode,
    uid,
    key:"state_preview",
    nowMs,
  });

  const roundStatus=gameId==="slot"
    ? "settled"
    : nowMs<round.bettingClosesAtMs
      ? "betting"
      : nowMs<round.revealAtMs
        ? "spinning"
        : "result_hold";
  let userDailyPayoutCoins=0;
  try{
    const dailyStatsSnap=await db.collection("game_user_stats")
      .doc(uid).collection("daily")
      .doc(gameId+"__"+round.dayKey)
      .get();
    userDailyPayoutCoins=Math.max(
      0,
      Number(dailyStatsSnap.exists?dailyStatsSnap.data()?.payoutCoins||0:0),
    );
  }catch(error){
    if(!transientFirestoreError(error))throw error;
  }
  let lastResult=null;
  const recentResults=[];
  if(gameId!=="slot"){
    const seenRoundIds=new Set();
    const roundsToReveal=[];
    if(roundStatus==="result_hold"){
      roundsToReveal.push(round);
    }
    const cycleMs=(config.roundDurationSeconds*1000)+config.resultHoldMs;
    for(let index=1;roundsToReveal.length<20&&index<=21;index++){
      const previousNow=Math.max(
        0,
        round.opensAtMs-1-(cycleMs*(index-1)),
      );
      const previous=buildRound({
        config,
        gameId,
        mode,
        uid,
        key:"previous_preview_"+index,
        nowMs:previousNow,
      });
      if(previous.roundId===round.roundId||seenRoundIds.has(previous.roundId)){
        continue;
      }
      seenRoundIds.add(previous.roundId);
      roundsToReveal.push(previous);
    }
    for(const resultRound of roundsToReveal.slice(0,20)){
      const resolved=resolveOutcome({
        gameId,
        mode,
        outcomes:selected.outcomes,
        roundId:resultRound.roundId,
        secret:options.rngSecret||legacyEnv.GAME_RNG_SECRET,
      });
      recentResults.push({
        roundId:resultRound.roundId,
        dayKey:resultRound.dayKey,
        roundNumber:resultRound.roundNumber,
        outcomeId:resolved.outcomeId,
        closedAtMs:resultRound.revealAtMs,
      });
    }
    lastResult=recentResults[0]||null;
    if(lastResult){
      let summary={topWinners:[],myRound:null};
      try{
        summary=await roundResultSummary(db,lastResult.roundId,uid);
      }catch(error){
        if(!transientFirestoreError(error))throw error;
      }
      lastResult={
        ...lastResult,
        topWinners:summary.topWinners,
        myRound:summary.myRound,
      };
    }
  }
  let serverRoundSelections=[];
  if(gameId!=="slot"){
    try{
      const roundSnap=await db.collection("game_rounds").doc(round.roundId).get();
      const choiceTotals=roundSnap.exists?roundSnap.data()?.choiceTotals:{};
      if(choiceTotals&&typeof choiceTotals==="object"){
        serverRoundSelections=Object.entries(choiceTotals)
          .map(([choiceId,amountCoins])=>({
            choiceId:clean(choiceId),
            amountCoins:Number(amountCoins||0),
          }))
          .filter(item=>
            item.choiceId&&
            Number.isSafeInteger(item.amountCoins)&&
            item.amountCoins>0
          );
      }
    }catch(error){
      if(!transientFirestoreError(error))throw error;
    }
  }

  let pendingRaw=[];
  try{
    const pendingSnapshot=await db.collection("game_operations")
      .where("userId","==",uid)
      .limit(50)
      .get();
    pendingRaw=pendingSnapshot.docs
      .map(doc=>doc.data()||{})
      .filter(item=>item.status==="pending");
  }catch(error){
    if(!transientFirestoreError(error))throw error;
  }
  const pending=pendingRaw.map(publicOperation);
  const currentRoundTotals=new Map();
  if(gameId!=="slot"){
    for(const operation of pendingRaw){
      if(clean(operation.roundId)!==round.roundId)continue;
      for(const selection of Array.isArray(operation.selections)
        ? operation.selections
        : []){
        const choiceId=clean(selection?.choiceId);
        const amountCoins=Number(selection?.amountCoins||0);
        if(!choiceId||!Number.isSafeInteger(amountCoins)||amountCoins<=0)continue;
        currentRoundTotals.set(
          choiceId,
          (currentRoundTotals.get(choiceId)||0)+amountCoins,
        );
      }
    }
  }
  const currentRoundSelections=[...currentRoundTotals.entries()]
    .map(([choiceId,amountCoins])=>({choiceId,amountCoins}));

  if(gameId!=="slot"&&validRoomId(roomId)&&legacyEnv.ROOM_REALTIME){
    const schedules=gameRealtimeSchedules({
      config,
      selected,
      gameId,
      mode,
      uid,
      nowMs,
      rngSecret:options.rngSecret||legacyEnv.GAME_RNG_SECRET,
    });
    await registerGameRealtimeSchedules(roomId,uid,schedules);
  }

  return {
    ok:true,
    gameId,
    mode,
    enabled:selected.enabled===true,
    targetRtpBps:selected.targetRtpBps,
    bets:[...validateBetLadder(gameId,mode,selected.bets)],
    serverNowMs:nowMs,
    lastResult,
    recentResults,
    round:gameId==="slot"?null:{
      roundId:round.roundId,
      dayKey:round.dayKey,
      roundNumber:round.roundNumber,
      opensAtMs:round.opensAtMs,
      closesAtMs:round.closesAtMs,
      bettingClosesAtMs:round.bettingClosesAtMs,
      revealAtMs:round.revealAtMs,
      resultHoldEndsAtMs:round.resultHoldEndsAtMs,
      nextRoundOpensAtMs:round.nextRoundOpensAtMs,
      locked:roundStatus!=="betting",
      status:roundStatus,
    },
    currentRoundSelections,
    serverRoundSelections,
    totalRoundStakeCoins:serverRoundSelections
      .reduce((sum,item)=>sum+Number(item.amountCoins||0),0),
    userDailyPayoutCoins,
    pending,
  };
}

export async function handler(req,res){
  if(cors(req,res))return;
  try{
    initFirebase();
    const db=getFirestore();

    if(req.method==="GET"&&clean(req.query?.action)==="settleDue"){
      const authorization=clean(req.headers.authorization);
      const secret=clean(legacyEnv.CRON_SECRET);
      if(!secret||authorization!=="Bearer "+secret)throw Error("unauthorized");
      const result=await settleDueGameOperations(db);
      return out(res,200,{ok:true,...result});
    }

    if(req.method!=="POST")return out(res,405,{ok:false,code:"method_not_allowed"});
    const action=clean(req.body?.action);
    const readOnlyAction=action==="catalog"||action==="state";
    const {uid}=await actor(req,{checkUserState:!readOnlyAction});
    if(action==="catalog"){
      return out(res,200,await gameCatalog(db));
    }
    if(action==="placeBet"){
      const result=await placeGameBet(db,uid,req.body||{});
      return out(res,200,result);
    }
    if(action==="settleOperation"){
      const result=await settleGameOperation(db,uid,req.body||{});
      return out(res,200,result);
    }
    if(action==="state"){
      const result=await gameState(db,uid,req.body||{});
      return out(res,200,result);
    }
    throw Error("invalid_action");
  }catch(error){
    const code=clean(error?.message)||"server_error";
    const status=code==="unauthorized"?401:
      code==="account_required"?403:
      ["operation_not_found","user_not_found"].includes(code)?404:
      [
        "invalid_request","unsupported_game","invalid_mode","invalid_bets",
        "invalid_choice","duplicate_choice","invalid_bet","invalid_probabilities",
        "rng_not_configured","invalid_outcome","invalid_payout","round_locked",
        "round_not_finished","invalid_action",
      ].includes(code)?400:
      ["games_disabled","game_disabled","emergency_locked","user_not_in_room",
        "room_unavailable","insufficient_balance"].includes(code)?409:500;
    return out(res,status,{ok:false,code});
  }
}
