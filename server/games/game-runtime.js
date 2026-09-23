import {getApps,initializeApp,cert} from "firebase-admin/app";
import {getAuth} from "firebase-admin/auth";
import {FieldValue,getFirestore} from "firebase-admin/firestore";
import {
  TARGET_RTP_BPS,
  calculatePayout,
  dailyRoundClock,
  normalizeSelections,
  resolveOutcome,
  slotReelsForOutcome,
  totalStake,
  validIdempotencyKey,
  validateOutcomeWeights,
} from "./game-engine.js";

const clean=(value)=>String(value??"").trim();

const FALLBACK_CONFIG=Object.freeze({
  enabled:false,
  targetRtpBps:TARGET_RTP_BPS,
  timezoneOffsetMinutes:240,
  roundDurationSeconds:30,
  lockBeforeMs:3000,
  games:Object.freeze({
    greedy_cat:Object.freeze({enabled:false,outcomes:[]}),
    witch:Object.freeze({
      enabled:false,
      normal:Object.freeze({outcomes:[]}),
      advanced:Object.freeze({outcomes:[]}),
    }),
    slot:Object.freeze({
      enabled:false,
      outcomes:Object.freeze([
        Object.freeze({id:"lose",weightBps:6875}),
        Object.freeze({id:"pair",weightBps:3000}),
        Object.freeze({id:"jackpot",weightBps:125}),
      ]),
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
    const sa=parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT);
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

async function actor(req){
  const authorization=clean(req.headers.authorization);
  if(!authorization.startsWith("Bearer "))throw Error("unauthorized");
  const decoded=await getAuth().verifyIdToken(authorization.slice(7));
  if(decoded.firebase?.sign_in_provider==="anonymous")throw Error("account_required");
  return decoded;
}

function runtimeConfig(raw={}){
  const games=raw?.games&&typeof raw.games==="object"?raw.games:{};
  return {
    enabled:raw?.enabled===true,
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
    games:{
      greedy_cat:{
        ...FALLBACK_CONFIG.games.greedy_cat,
        ...(games.greedy_cat||{}),
      },
      witch:{
        ...FALLBACK_CONFIG.games.witch,
        ...(games.witch||{}),
        normal:{
          ...FALLBACK_CONFIG.games.witch.normal,
          ...(games.witch?.normal||{}),
        },
        advanced:{
          ...FALLBACK_CONFIG.games.witch.advanced,
          ...(games.witch?.advanced||{}),
        },
      },
      slot:{
        ...FALLBACK_CONFIG.games.slot,
        ...(games.slot||{}),
      },
    },
  };
}

function gameConfig(config,gameId,mode){
  if(!config.enabled)throw Error("games_disabled");
  const game=config.games?.[gameId];
  if(!game||game.enabled!==true)throw Error("game_disabled");
  if(gameId==="witch"){
    if(!["normal","advanced"].includes(mode))throw Error("invalid_mode");
    const variant=game[mode]||{};
    return {
      ...game,
      ...variant,
      outcomes:validateOutcomeWeights(gameId,mode,variant.outcomes),
    };
  }
  return {
    ...game,
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
      roundId:gameId+":"+uid+":"+key,
    };
  }
  return dailyRoundClock({
    nowMs,
    durationSeconds:config.roundDurationSeconds,
    timezoneOffsetMinutes:config.timezoneOffsetMinutes,
    gameId,
    mode,
  });
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
    rngSecret=process.env.GAME_RNG_SECRET,
  }={},
){
  const gameId=clean(body.gameId);
  const mode=gameId==="witch"?clean(body.mode||"normal"):"";
  const roomId=clean(body.roomId);
  const key=clean(body.idempotencyKey);
  if(!/^[A-Za-z0-9_-]{1,180}$/.test(roomId)||!validIdempotencyKey(key)){
    throw Error("invalid_request");
  }

  const operationId=uid+"__"+key;
  const userRef=db.collection("users").doc(uid);
  const roomRef=db.collection("rooms").doc(roomId);
  const presenceRef=db.collection("room_presence").doc(roomId).collection("users").doc(uid);
  const configRef=db.collection("system_config").doc("game_runtime");
  const lockRef=db.collection("system_config").doc("emergency_lock");
  const operationRef=db.collection("game_operations").doc(operationId);

  return db.runTransaction(async(tx)=>{
    const [userSnap,roomSnap,presenceSnap,configSnap,lockSnap,operationSnap]=
      await Promise.all([
        tx.get(userRef),
        tx.get(roomRef),
        tx.get(presenceRef),
        tx.get(configRef),
        tx.get(lockRef),
        tx.get(operationRef),
      ]);

    if(operationSnap.exists){
      return {ok:true,code:"duplicate",...publicOperation(operationSnap.data()||{})};
    }
    if(!userSnap.exists)throw Error("user_not_found");
    if(!roomSnap.exists||roomSnap.data()?.isActive===false)throw Error("room_unavailable");
    const lastSeenAtMs=Number(presenceSnap.data()?.lastSeenAtMs||0);
    if(!presenceSnap.exists||nowMs-lastSeenAtMs>90000)throw Error("user_not_in_room");

    const lock=lockSnap.exists?(lockSnap.data()||{}):{};
    if(lock.enabled===true||lock.economyLocked===true||lock.gamesLocked===true){
      throw Error("emergency_locked");
    }

    const config=runtimeConfig(configSnap.exists?configSnap.data()||{}:{});
    const selectedConfig=gameConfig(config,gameId,mode);
    const selections=normalizeSelections(gameId,mode,body.bets);
    const stake=totalStake(selections);
    const round=buildRound({config,gameId,mode,uid,key,nowMs});
    if(gameId!=="slot"&&nowMs>=round.closesAtMs-config.lockBeforeMs){
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
      targetRtpBps:config.targetRtpBps,
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

    tx.set(roundRef,{
      gameId,
      mode,
      dayKey:round.dayKey,
      roundNumber:round.roundNumber,
      roundId:round.roundId,
      opensAtMs:round.opensAtMs,
      closesAtMs:round.closesAtMs,
      outcomeId:resolved.outcomeId,
      entropyDigest:resolved.entropyDigest,
      targetRtpBps:config.targetRtpBps,
      status:settled?"settled":"open",
      totalWagerCoins:FieldValue.increment(stake),
      totalPayoutCoins:FieldValue.increment(settled?payout:0),
      operationCount:FieldValue.increment(1),
      settledOperationCount:FieldValue.increment(settled?1:0),
      updatedAt:now,
      createdAt:now,
    },{merge:true});

    if(settled){
      tx.set(historyRef,{
        operationId,
        gameId,
        mode,
        roomId,
        roundId:round.roundId,
        roundNumber:round.roundNumber,
        dayKey:round.dayKey,
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

async function settleOperationRef(db,operationRef,nowMs){
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

    tx.update(userRef,{
      coins:after,
      walletUpdatedAt:now,
    });
    tx.update(operationRef,{
      status:"settled",
      balanceAfter:after,
      settledAt:now,
      updatedAt:now,
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
      totalStakeCoins:Number(operation.totalStakeCoins||0),
      payoutCoins:payout,
      outcomeId:clean(operation.outcomeId),
      reels:Array.isArray(operation.reels)?operation.reels:[],
      settledAt:now,
    });

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
      results.push(await settleOperationRef(db,doc.ref,nowMs));
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

export async function gameState(db,uid,body={},options={}){
  const gameId=clean(body.gameId);
  const mode=gameId==="witch"?clean(body.mode||"normal"):"";
  const configSnap=await db.collection("system_config").doc("game_runtime").get();
  const config=runtimeConfig(configSnap.exists?configSnap.data()||{}:{});
  const selected=gameConfig(config,gameId,mode);
  const nowMs=Number(options.nowMs||Date.now());
  const round=buildRound({
    config,
    gameId,
    mode,
    uid,
    key:"state_preview",
    nowMs,
  });
  const pendingSnapshot=await db.collection("game_operations")
    .where("userId","==",uid)
    .limit(50)
    .get();
  const pending=pendingSnapshot.docs
    .map(doc=>doc.data()||{})
    .filter(item=>item.status==="pending")
    .map(publicOperation);
  return {
    ok:true,
    gameId,
    mode,
    enabled:selected.enabled===true,
    targetRtpBps:config.targetRtpBps,
    round:gameId==="slot"?null:{
      roundId:round.roundId,
      dayKey:round.dayKey,
      roundNumber:round.roundNumber,
      opensAtMs:round.opensAtMs,
      closesAtMs:round.closesAtMs,
      locked:nowMs>=round.closesAtMs-config.lockBeforeMs,
    },
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
      const secret=clean(process.env.CRON_SECRET);
      if(!secret||authorization!=="Bearer "+secret)throw Error("unauthorized");
      const result=await settleDueGameOperations(db);
      return out(res,200,{ok:true,...result});
    }

    if(req.method!=="POST")return out(res,405,{ok:false,code:"method_not_allowed"});
    const {uid}=await actor(req);
    const action=clean(req.body?.action);
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
