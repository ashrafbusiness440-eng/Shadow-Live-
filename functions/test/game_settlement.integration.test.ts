import assert from "node:assert/strict";
import {after,test} from "node:test";
import {deleteApp,getApps,initializeApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import {settleDueGameOperations} from "../src/game_settlement.js";

const app=getApps()[0]||initializeApp({projectId:"shadow-live-economy-test"});
const db=getFirestore(app);

after(async()=>{await deleteApp(app);});

test("scheduled settlement credits a disconnected pending game exactly once",async()=>{
  const suffix=Date.now().toString();
  const uid="scheduled_game_user_"+suffix;
  const operationId=uid+"__scheduled_"+suffix;
  const roundId="greedy_cat:2026-09-23:"+suffix;
  const nowMs=Date.UTC(2026,8,23,12,1,0);

  await Promise.all([
    db.collection("users").doc(uid).set({coins:1000}),
    db.collection("game_rounds").doc(roundId).set({
      gameId:"greedy_cat",
      status:"open",
      totalPayoutCoins:0,
      settledOperationCount:0,
    }),
    db.collection("game_operations").doc(operationId).set({
      operationId,
      idempotencyKey:"scheduled_"+suffix,
      userId:uid,
      roomId:"room_disconnected",
      gameId:"greedy_cat",
      mode:"",
      status:"pending",
      roundId,
      roundNumber:10,
      dayKey:"2026-09-23",
      closesAtMs:nowMs-1000,
      totalStakeCoins:200,
      payoutCoins:1000,
      outcomeId:"tomato5",
      reels:[],
    }),
  ]);

  const [a,b]=await Promise.all([
    settleDueGameOperations(db,nowMs,20),
    settleDueGameOperations(db,nowMs,20),
  ]);
  assert.equal(a.failed+b.failed,0);

  const user=(await db.collection("users").doc(uid).get()).data();
  assert.equal(user?.coins,2000);

  const operation=(await db.collection("game_operations").doc(operationId).get()).data();
  assert.equal(operation?.status,"settled");
  assert.equal(operation?.settlementWorker,"firebase_schedule");

  const ledger=await db.collection("financial_ledger")
    .doc("game_credit__"+operationId).get();
  assert.equal(ledger.exists,true);
  assert.equal(ledger.data()?.delta,1000);

  const history=await db.collection("game_user_history")
    .doc(uid).collection("items").doc(operationId).get();
  assert.equal(history.exists,true);
  assert.equal(history.data()?.payoutCoins,1000);

  const again=await settleDueGameOperations(db,nowMs+60000,20);
  assert.equal(again.failed,0);
  assert.equal((await db.collection("users").doc(uid).get()).data()?.coins,2000);
});

test("scheduled settlement leaves future rounds pending",async()=>{
  const suffix=Date.now().toString()+"_future";
  const uid="scheduled_future_user_"+suffix;
  const operationId=uid+"__scheduled_"+suffix;
  const nowMs=Date.UTC(2026,8,23,12,1,0);

  await Promise.all([
    db.collection("users").doc(uid).set({coins:5000}),
    db.collection("game_operations").doc(operationId).set({
      operationId,
      idempotencyKey:"scheduled_future_"+suffix,
      userId:uid,
      roomId:"room_future",
      gameId:"witch",
      mode:"normal",
      status:"pending",
      roundId:"witch:normal:future:"+suffix,
      roundNumber:11,
      dayKey:"2026-09-23",
      closesAtMs:nowMs+30000,
      totalStakeCoins:1000,
      payoutCoins:10000,
      outcomeId:"book",
      reels:[],
    }),
  ]);

  const result=await settleDueGameOperations(db,nowMs,20);
  assert.equal(result.failed,0);
  const operation=(await db.collection("game_operations").doc(operationId).get()).data();
  assert.equal(operation?.status,"pending");
  assert.equal((await db.collection("users").doc(uid).get()).data()?.coins,5000);
});
