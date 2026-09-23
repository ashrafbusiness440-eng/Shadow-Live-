import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceRoomRocket,
  defaultRoomRocketConfig,
  normalizeRoomRocketConfig,
} from "../economy/room-rocket.js";

const sender=(uid,name=uid)=>({uid,displayName:name,profileImageUrl:""});

test("room rocket keeps partial progress below the current threshold",()=>{
  const result=advanceRoomRocket({
    state:{},
    config:defaultRoomRocketConfig(),
    roomId:"room_a",
    sender:sender("u1"),
    contributionCoins:90000,
    nowMs:1000,
    operationId:"op_a",
  });
  assert.equal(result.explosions.length,0);
  assert.equal(result.nextState.currentLevel,1);
  assert.equal(result.nextState.progressCoins,90000);
  assert.equal(result.nextState.levelContributors.u1.coins,90000);
});

test("overflow carries to following levels and schedules each explosion 10 seconds apart",()=>{
  const config=defaultRoomRocketConfig();
  const result=advanceRoomRocket({
    state:{progressCoins:90000,levelContributors:{u0:{uid:"u0",coins:90000}}},
    config,
    roomId:"room_b",
    sender:sender("u1","Trigger"),
    contributionCoins:610000,
    nowMs:5000,
    operationId:"op_b",
  });
  assert.equal(result.explosions.length,2);
  assert.equal(result.explosions[0].level,1);
  assert.equal(result.explosions[0].startsAtMs,5000);
  assert.equal(result.explosions[0].endsAtMs,15000);
  assert.equal(result.explosions[1].level,2);
  assert.equal(result.explosions[1].startsAtMs,15000);
  assert.equal(result.explosions[1].endsAtMs,25000);
  assert.equal(result.nextState.currentLevel,3);
  assert.equal(result.nextState.progressCoins,100000);
});

test("top three are ranked by contribution to the exact exploded level",()=>{
  const config=defaultRoomRocketConfig();
  let state={};
  state=advanceRoomRocket({
    state,config,roomId:"room_c",sender:sender("a"),
    contributionCoins:40000,nowMs:1000,operationId:"a1",
  }).nextState;
  state=advanceRoomRocket({
    state,config,roomId:"room_c",sender:sender("b"),
    contributionCoins:35000,nowMs:2000,operationId:"b1",
  }).nextState;
  const result=advanceRoomRocket({
    state,config,roomId:"room_c",sender:sender("c"),
    contributionCoins:25000,nowMs:3000,operationId:"c1",
  });
  assert.equal(result.explosions.length,1);
  assert.deepEqual(result.explosions[0].top3.map(x=>x.uid),["a","b","c"]);
  assert.equal(result.explosions[0].contributors.reduce((n,x)=>n+x.coins,0),100000);
});

test("after level four the next overflow starts a new cycle at level one",()=>{
  const config=defaultRoomRocketConfig();
  const result=advanceRoomRocket({
    state:{cycleNumber:7,levelIndex:3,progressCoins:4990000},
    config,roomId:"room_d",sender:sender("u1"),
    contributionCoins:210000,nowMs:1000,operationId:"op_d",
  });
  assert.equal(result.explosions.length,2);
  assert.equal(result.explosions[0].cycleNumber,7);
  assert.equal(result.explosions[0].level,4);
  assert.equal(result.explosions[1].cycleNumber,8);
  assert.equal(result.explosions[1].level,1);
  assert.equal(result.nextState.cycleNumber,8);
  assert.equal(result.nextState.currentLevel,2);
  assert.equal(result.nextState.progressCoins,10000);
});

test("approved reward policy includes voice waves and never VIP",()=>{
  const config=normalizeRoomRocketConfig({});
  assert.equal(config.explosionDurationSeconds,10);
  assert.equal(config.winProbabilityBps,3000);
  assert.deepEqual(config.levels.map((level)=>level.winProbabilityBps),[3000,3000,3000,3000]);
  const custom=normalizeRoomRocketConfig({
    levels:config.levels.map((level,index)=>({
      ...level,
      winProbabilityBps:[1000,2000,3000,4000][index],
    })),
  });
  assert.deepEqual(custom.levels.map((level)=>level.winProbabilityBps),[1000,2000,3000,4000]);
  assert.equal(config.regularAttempts,1);
  assert.equal(config.topContributorAttempts,2);
  assert.deepEqual(config.rewardTypes,["coins","frame","entrance","voice_wave"]);
  assert.equal(config.vipRewardEnabled,false);
  assert.equal(config.cosmeticStackCapHours,720);
});
