import assert from "node:assert/strict";
import {after,test} from "node:test";
import {deleteApp,getApps,initializeApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import {
  gameCatalog,
  gameState,
  placeGameBet,
  settleGameOperation,
} from "../games/game-runtime.js";

const app=getApps()[0]||initializeApp({projectId:"shadow-live-economy-test"});
const db=getFirestore(app);
const rngSecret="shadow-live-game-rng-secret-integration";
const nowMs=Date.UTC(2026,8,23,12,0,5);

after(async()=>{await deleteApp(app);});

async function seedRuntime(){
  await Promise.all([
    db.collection("system_config").doc("emergency_lock").set({
      enabled:false,economyLocked:false,gamesLocked:false,
    }),
    db.collection("system_config").doc("game_runtime").set({
      enabled:true,
      targetRtpBps:8500,
      timezoneOffsetMinutes:240,
      roundDurationSeconds:30,
      lockBeforeMs:1000,
      games:{
        greedy_cat:{
          enabled:true,
          outcomes:[
            {id:"tomato5",weightBps:9999},
            {id:"pizza",weightBps:1},
          ],
        },
        witch:{
          enabled:true,
          normal:{
            enabled:true,
            outcomes:[
              {id:"moon",weightBps:9999},
              {id:"book",weightBps:1},
            ],
          },
          advanced:{
            enabled:true,
            outcomes:[
              {id:"moon",weightBps:9999},
              {id:"book",weightBps:1},
            ],
          },
        },
        slot:{
          enabled:true,
          outcomes:[
            {id:"lose",weightBps:9999},
            {id:"jackpot",weightBps:1},
          ],
        },
      },
    }),
  ]);
}

async function seedUserRoom(uid,roomId,coins=20000){
  await Promise.all([
    db.collection("users").doc(uid).set({role:"user",coins}),
    db.collection("rooms").doc(roomId).set({isActive:true}),
    db.collection("room_presence").doc(roomId).collection("users").doc(uid).set({
      lastSeenAtMs:nowMs,
      displayName:uid,
    }),
  ]);
}

test("catalog exposes only enabled runtime variants with their bet ladders",async()=>{
  await seedRuntime();
  const catalog=await gameCatalog(db);
  assert.equal(catalog.ok,true);
  assert.deepEqual(
    catalog.items.map(item=>item.key).sort(),
    ["greedy_cat","slot","witch_advanced","witch_normal"],
  );
  const greedy=catalog.items.find(item=>item.key==="greedy_cat");
  assert.deepEqual(greedy.bets,[200,2000,20000,200000]);
});

test("collective state exposes the same previous global result in every room",async()=>{
  await seedRuntime();
  const suffix=Date.now().toString()+"_last_result";
  const uidA="state_a_"+suffix;
  const uidB="state_b_"+suffix;
  await Promise.all([
    seedUserRoom(uidA,"state_room_a_"+suffix),
    seedUserRoom(uidB,"state_room_b_"+suffix),
  ]);
  const options={nowMs,rngSecret};
  const [a,b]=await Promise.all([
    gameState(db,uidA,{gameId:"greedy_cat"},options),
    gameState(db,uidB,{gameId:"greedy_cat"},options),
  ]);
  assert.ok(a.lastResult);
  assert.deepEqual(a.lastResult,b.lastResult);
  assert.equal(a.round.roundId,b.round.roundId);
  assert.equal(a.serverNowMs,nowMs);
});

test("collective game debits once and settles after disconnect",async()=>{
  await seedRuntime();
  const suffix=Date.now().toString();
  const uid="game_user_"+suffix;
  const roomId="game_room_"+suffix;
  const key="greedy_operation_"+suffix;
  await seedUserRoom(uid,roomId);

  const first=await placeGameBet(db,uid,{
    gameId:"greedy_cat",
    roomId,
    idempotencyKey:key,
    bets:[
      {choiceId:"pepper5",amountCoins:200},
      {choiceId:"tomato5",amountCoins:200},
      {choiceId:"cabbage5",amountCoins:200},
      {choiceId:"carrot5",amountCoins:200},
    ],
  },{nowMs,rngSecret});

  assert.equal(first.code,"ok");
  assert.equal(first.status,"pending");
  assert.equal(first.totalStakeCoins,800);

  const afterDebit=await db.collection("users").doc(uid).get();
  assert.equal(afterDebit.data().coins,19200);

  const duplicate=await placeGameBet(db,uid,{
    gameId:"greedy_cat",
    roomId,
    idempotencyKey:key,
    bets:[{choiceId:"tomato5",amountCoins:200}],
  },{nowMs,rngSecret});
  assert.equal(duplicate.code,"duplicate");
  assert.equal((await db.collection("users").doc(uid).get()).data().coins,19200);

  const operationRef=db.collection("game_operations").doc(uid+"__"+key);
  const operation=(await operationRef.get()).data();
  assert.equal(operation.status,"pending");
  assert.equal(operation.totalStakeCoins,800);

  await db.collection("room_presence").doc(roomId).collection("users").doc(uid).delete();

  const settled=await settleGameOperation(db,uid,{idempotencyKey:key},{
    nowMs:Number(operation.closesAtMs)+1,
  });
  assert.equal(settled.code,"ok");
  assert.equal(settled.status,"settled");

  const finalUser=(await db.collection("users").doc(uid).get()).data();
  assert.equal(finalUser.coins,19200+Number(operation.payoutCoins));

  const settleAgain=await settleGameOperation(db,uid,{idempotencyKey:key},{
    nowMs:Number(operation.closesAtMs)+5000,
  });
  assert.equal(settleAgain.code,"duplicate");
  assert.equal((await db.collection("users").doc(uid).get()).data().coins,finalUser.coins);

  const debit=await db.collection("financial_ledger")
    .doc("game_debit__"+uid+"__"+key).get();
  assert.equal(debit.data().delta,-800);
  if(Number(operation.payoutCoins)>0){
    const credit=await db.collection("financial_ledger")
      .doc("game_credit__"+uid+"__"+key).get();
    assert.equal(credit.data().delta,Number(operation.payoutCoins));
  }
});

test("greedy cat stores repeated taps as events and one accumulated selection",async()=>{
  await seedRuntime();
  const suffix=Date.now().toString()+"_repeat_cat";
  const uid="repeat_cat_"+suffix;
  const roomId="repeat_cat_room_"+suffix;
  const key="repeat_cat_operation_"+suffix;
  await seedUserRoom(uid,roomId,100000);

  const result=await placeGameBet(db,uid,{
    gameId:"greedy_cat",
    roomId,
    idempotencyKey:key,
    bets:[
      {choiceId:"chicken10",amountCoins:2000},
      {choiceId:"chicken10",amountCoins:20000},
      {choiceId:"chicken10",amountCoins:20000},
    ],
  },{nowMs,rngSecret});

  assert.equal(result.totalStakeCoins,42000);
  const operation=(await db.collection("game_operations")
    .doc(uid+"__"+key).get()).data();
  assert.equal(operation.betEvents.length,3);
  assert.equal(operation.selections.length,1);
  assert.equal(operation.selections[0].choiceId,"chicken10");
  assert.equal(operation.selections[0].amountCoins,42000);
  assert.equal(operation.selections[0].entryCount,3);
  assert.equal((await db.collection("users").doc(uid).get()).data().coins,58000);
});

test("witch separate taps in one round aggregate to 21K on the same choice",async()=>{
  await seedRuntime();
  const suffix=Date.now().toString()+"_repeat_witch";
  const uid="repeat_witch_"+suffix;
  const roomId="repeat_witch_room_"+suffix;
  await seedUserRoom(uid,roomId,100000);

  const amounts=[1000,10000,10000];
  const operations=[];
  for(let i=0;i<amounts.length;i++){
    operations.push(await placeGameBet(db,uid,{
      gameId:"witch",
      mode:"normal",
      roomId,
      idempotencyKey:"repeat_witch_"+suffix+"_"+i,
      bets:[{choiceId:"book",amountCoins:amounts[i]}],
    },{nowMs,rngSecret}));
  }

  assert.equal(new Set(operations.map(item=>item.roundId)).size,1);
  assert.equal((await db.collection("users").doc(uid).get()).data().coins,79000);

  const state=await gameState(db,uid,{
    gameId:"witch",
    mode:"normal",
  },{nowMs,rngSecret});
  assert.equal(state.currentRoundSelections.length,1);
  assert.equal(state.currentRoundSelections[0].choiceId,"book");
  assert.equal(state.currentRoundSelections[0].amountCoins,21000);
});

test("same collective round is global across users and rooms",async()=>{
  await seedRuntime();
  const suffix=Date.now().toString()+"_global";
  const uidA="game_a_"+suffix;
  const uidB="game_b_"+suffix;
  const roomA="room_a_"+suffix;
  const roomB="room_b_"+suffix;
  await Promise.all([
    seedUserRoom(uidA,roomA),
    seedUserRoom(uidB,roomB),
  ]);

  const beforePressure=await gameState(
    db,
    uidA,
    {gameId:"greedy_cat"},
    {nowMs,rngSecret},
  );
  const beforeTotals=Object.fromEntries(
    beforePressure.serverRoundSelections.map(
      item=>[item.choiceId,item.amountCoins],
    ),
  );

  const [a,b]=await Promise.all([
    placeGameBet(db,uidA,{
      gameId:"greedy_cat",
      roomId:roomA,
      idempotencyKey:"global_round_a_"+suffix,
      bets:[{choiceId:"tomato5",amountCoins:200}],
    },{nowMs,rngSecret}),
    placeGameBet(db,uidB,{
      gameId:"greedy_cat",
      roomId:roomB,
      idempotencyKey:"global_round_b_"+suffix,
      bets:[{choiceId:"fish15",amountCoins:200}],
    },{nowMs,rngSecret}),
  ]);

  assert.equal(a.roundId,b.roundId);
  const opA=(await db.collection("game_operations")
    .doc(uidA+"__global_round_a_"+suffix).get()).data();
  const opB=(await db.collection("game_operations")
    .doc(uidB+"__global_round_b_"+suffix).get()).data();
  assert.equal(opA.outcomeId,opB.outcomeId);
  assert.equal(opA.entropyDigest,opB.entropyDigest);

  const pressure=await gameState(db,uidA,{gameId:"greedy_cat"},{nowMs,rngSecret});
  const serverTotals=Object.fromEntries(
    pressure.serverRoundSelections.map(item=>[item.choiceId,item.amountCoins]),
  );
  assert.equal(
    serverTotals.tomato5-(beforeTotals.tomato5||0),
    200,
  );
  assert.equal(
    serverTotals.fish15-(beforeTotals.fish15||0),
    200,
  );
});

test("slot settles debit and payout atomically in one operation",async()=>{
  await seedRuntime();
  const suffix=Date.now().toString()+"_slot";
  const uid="slot_user_"+suffix;
  const roomId="slot_room_"+suffix;
  const key="slot_operation_"+suffix;
  await seedUserRoom(uid,roomId,5000);

  const result=await placeGameBet(db,uid,{
    gameId:"slot",
    roomId,
    idempotencyKey:key,
    bets:[{amountCoins:200}],
  },{nowMs,rngSecret});

  assert.equal(result.status,"settled");
  assert.equal(result.totalStakeCoins,200);
  assert.equal(Array.isArray(result.reels),true);
  assert.equal(result.reels.length,3);

  const operation=(await db.collection("game_operations").doc(uid+"__"+key).get()).data();
  const user=(await db.collection("users").doc(uid).get()).data();
  assert.equal(user.coins,5000-200+Number(operation.payoutCoins));
});
