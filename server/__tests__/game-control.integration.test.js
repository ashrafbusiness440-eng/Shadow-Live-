import assert from "node:assert/strict";
import {after,test} from "node:test";
import {deleteApp,getApps,initializeApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import {
  gameControlState,
  saveGameTiming,
  saveGameVariant,
} from "../games/game-control.js";
import {gameCatalog,placeGameBet} from "../games/game-runtime.js";

const app=getApps()[0]||initializeApp({projectId:"shadow-live-economy-test"});
const db=getFirestore(app);
const rngSecret="shadow-live-game-rng-secret-control";
const nowMs=Date.UTC(2026,8,23,12,0,5);

after(async()=>{await deleteApp(app);});

async function resetConfig(){
  await Promise.all([
    db.collection("system_config").doc("game_runtime").set({
      enabled:true,
      timezoneOffsetMinutes:240,
      roundDurationSeconds:30,
      lockBeforeMs:1000,
      games:{},
    }),
    db.collection("system_config").doc("emergency_lock").set({
      enabled:false,economyLocked:false,gamesLocked:false,
    }),
  ]);
}

test("saving one game variant does not modify the other games",async()=>{
  await resetConfig();
  const actor="admin_games_"+Date.now();
  await saveGameVariant(db,actor,{
    key:"greedy_cat",
    enabled:true,
    targetRtpBps:8500,
    bets:[500,5000,50000],
    outcomes:[
      {id:"tomato5",weightBps:9999},
      {id:"pizza",weightBps:1},
    ],
    reason:"configure greedy cat",
  });

  const snap=await db.collection("system_config").doc("game_runtime").get();
  const config=snap.data()||{};
  assert.equal(config.games.greedy_cat.enabled,true);
  assert.deepEqual(config.games.greedy_cat.bets,[500,5000,50000]);
  assert.equal(config.games.witch,undefined);
  assert.equal(config.games.slot,undefined);

  const audit=await db.collection("admin_audit_logs")
    .where("targetType","==","game_runtime")
    .get();
  assert.ok(audit.docs.some(doc=>doc.data()?.targetId==="greedy_cat"));
});

test("witch normal and advanced remain independently configurable",async()=>{
  await resetConfig();
  const actor="admin_witch_"+Date.now();

  await saveGameVariant(db,actor,{
    key:"witch_normal",
    enabled:true,
    targetRtpBps:8500,
    bets:[100,1000,10000],
    outcomes:[
      {id:"moon",weightBps:9999},
      {id:"book",weightBps:1},
    ],
    reason:"configure witch normal",
  });
  await saveGameVariant(db,actor,{
    key:"witch_advanced",
    enabled:false,
    targetRtpBps:8200,
    bets:[200,2000,20000],
    outcomes:[],
    reason:"disable witch advanced",
  });

  const config=(await db.collection("system_config").doc("game_runtime").get()).data();
  assert.equal(config.games.witch.enabled,true);
  assert.equal(config.games.witch.normal.enabled,true);
  assert.equal(config.games.witch.advanced.enabled,false);
  assert.equal(config.games.witch.normal.targetRtpBps,8500);
  assert.equal(config.games.witch.advanced.targetRtpBps,8200);

  const state=await gameControlState(db);
  const normal=state.variants.find(item=>item.key==="witch_normal");
  const advanced=state.variants.find(item=>item.key==="witch_advanced");
  assert.equal(normal.enabled,true);
  assert.equal(advanced.enabled,false);

  const catalog=await gameCatalog(db);
  assert.ok(catalog.items.some(item=>item.key==="witch_normal"));
  assert.equal(catalog.items.some(item=>item.key==="witch_advanced"),false);

  const suffix=Date.now().toString()+"_mode_guard";
  const uid="mode_guard_"+suffix;
  const roomId="mode_guard_room_"+suffix;
  await Promise.all([
    db.collection("users").doc(uid).set({role:"user",coins:100000}),
    db.collection("rooms").doc(roomId).set({isActive:true}),
    db.collection("room_presence").doc(roomId).collection("users").doc(uid).set({lastSeenAtMs:nowMs}),
  ]);
  await assert.rejects(
    placeGameBet(db,uid,{
      gameId:"witch",mode:"advanced",roomId,
      idempotencyKey:"mode_guard_"+suffix,
      bets:[{choiceId:"book",amountCoins:2000}],
    },{nowMs,rngSecret}),
    /game_disabled/,
  );
});

test("runtime accepts a control-defined custom bet ladder",async()=>{
  await resetConfig();
  const suffix=Date.now().toString()+"_ladder";
  const uid="game_control_user_"+suffix;
  const roomId="game_control_room_"+suffix;

  await saveGameVariant(db,"admin_ladder_"+suffix,{
    key:"greedy_cat",
    enabled:true,
    targetRtpBps:8500,
    bets:[500,5000,50000],
    outcomes:[
      {id:"tomato5",weightBps:9999},
      {id:"pizza",weightBps:1},
    ],
    reason:"custom ladder test",
  });

  await Promise.all([
    db.collection("users").doc(uid).set({role:"user",coins:100000}),
    db.collection("rooms").doc(roomId).set({isActive:true}),
    db.collection("room_presence").doc(roomId).collection("users").doc(uid).set({
      lastSeenAtMs:nowMs,
    }),
  ]);

  const ok=await placeGameBet(db,uid,{
    gameId:"greedy_cat",
    roomId,
    idempotencyKey:"custom_ladder_"+suffix,
    bets:[{choiceId:"tomato5",amountCoins:500}],
  },{nowMs,rngSecret});
  assert.equal(ok.totalStakeCoins,500);

  await assert.rejects(
    placeGameBet(db,uid,{
      gameId:"greedy_cat",
      roomId,
      idempotencyKey:"custom_ladder_bad_"+suffix,
      bets:[{choiceId:"tomato5",amountCoins:200}],
    },{nowMs,rngSecret}),
    /invalid_bet/,
  );
});

test("control state returns actual RTP and timing with audit",async()=>{
  await resetConfig();
  const actor="admin_state_"+Date.now();
  await saveGameTiming(db,actor,{
    timezoneOffsetMinutes:240,
    roundDurationSeconds:45,
    lockBeforeMs:2000,
    reason:"timing test",
  });
  await db.collection("game_rounds").doc("stats_round_"+Date.now()).set({
    gameId:"slot",
    mode:"",
    totalWagerCoins:100000,
    totalPayoutCoins:85000,
    operationCount:12,
  });

  const state=await gameControlState(db);
  const slot=state.stats.find(item=>item.key==="slot");
  assert.ok(slot);
  assert.equal(slot.actualRtpBps,8500);
  assert.equal(state.config.roundDurationSeconds,45);
  assert.ok(state.audit.length>0);
});
