import assert from "node:assert/strict";
import test from "node:test";
import {
  BET_LADDERS,
  calculatePayout,
  dailyRoundClock,
  deterministicRoll,
  greedyCatPayout,
  normalizeSelections,
  resolveOutcome,
  slotReelsForOutcome,
  totalStake,
  validateOutcomeWeights,
  weightedOutcome,
} from "../games/game-engine.js";

test("greedy cat salad pays all x5 selections",()=>{
  const selections=normalizeSelections("greedy_cat","",[
    {choiceId:"pepper5",amountCoins:2000},
    {choiceId:"tomato5",amountCoins:2000},
    {choiceId:"cabbage5",amountCoins:2000},
    {choiceId:"carrot5",amountCoins:2000},
  ]);
  assert.equal(totalStake(selections),8000);
  assert.equal(greedyCatPayout(selections,"salad"),40000);
});

test("greedy cat pizza pays x10 x15 x25 x45 together",()=>{
  const selections=normalizeSelections("greedy_cat","",[
    {choiceId:"chicken10",amountCoins:2000},
    {choiceId:"fish15",amountCoins:2000},
    {choiceId:"steak25",amountCoins:2000},
    {choiceId:"shell45",amountCoins:2000},
  ]);
  assert.equal(totalStake(selections),8000);
  assert.equal(greedyCatPayout(selections,"pizza"),190000);
});

test("bet ladders reject unsupported arbitrary values",()=>{
  assert.deepEqual(BET_LADDERS.greedy_cat,[200,2000,20000,200000]);
  assert.throws(
    ()=>normalizeSelections("greedy_cat","",[
      {choiceId:"pepper5",amountCoins:1234},
    ]),
    /invalid_bet/,
  );
});

test("greedy cat repeated taps on one choice accumulate before payout",()=>{
  const selections=normalizeSelections("greedy_cat","",[
    {choiceId:"chicken10",amountCoins:2000},
    {choiceId:"chicken10",amountCoins:20000},
    {choiceId:"chicken10",amountCoins:20000},
  ]);
  assert.equal(selections.length,1);
  assert.equal(selections[0].choiceId,"chicken10");
  assert.equal(selections[0].amountCoins,42000);
  assert.equal(selections[0].entryCount,3);
  assert.equal(totalStake(selections),42000);
  assert.equal(greedyCatPayout(selections,"chicken10"),420000);
});

test("witch repeated taps on one choice accumulate exactly",()=>{
  const selections=normalizeSelections("witch","normal",[
    {choiceId:"book",amountCoins:1000},
    {choiceId:"book",amountCoins:10000},
    {choiceId:"book",amountCoins:10000},
  ]);
  assert.equal(selections.length,1);
  assert.equal(selections[0].choiceId,"book");
  assert.equal(selections[0].amountCoins,21000);
  assert.equal(selections[0].entryCount,3);
  assert.equal(totalStake(selections),21000);
  assert.equal(calculatePayout({
    gameId:"witch",
    mode:"normal",
    selections,
    outcomeId:"book",
  }),210000);
});

test("daily collective round id is room independent and resets by day",()=>{
  const before=Date.UTC(2026,8,23,19,59,59);
  const after=Date.UTC(2026,8,23,20,0,1);
  const a=dailyRoundClock({
    nowMs:before,
    durationSeconds:30,
    timezoneOffsetMinutes:240,
    gameId:"greedy_cat",
  });
  const b=dailyRoundClock({
    nowMs:after,
    durationSeconds:30,
    timezoneOffsetMinutes:240,
    gameId:"greedy_cat",
  });
  assert.equal(a.dayKey,"2026-09-23");
  assert.equal(b.dayKey,"2026-09-24");
  assert.equal(b.roundNumber,1);
  assert.match(a.roundId,/^greedy_cat:2026-09-23:/);
  assert.equal(b.roundId,"greedy_cat:2026-09-24:1");
});

test("weighted server outcome is deterministic for one global round",()=>{
  const outcomes=validateOutcomeWeights("slot","",[
    {id:"lose",weightBps:6875},
    {id:"pair",weightBps:3000},
    {id:"jackpot",weightBps:125},
  ]);
  assert.equal(weightedOutcome(outcomes,0),"lose");
  assert.equal(weightedOutcome(outcomes,7000),"pair");
  assert.equal(weightedOutcome(outcomes,9999),"jackpot");

  const one=resolveOutcome({
    gameId:"slot",
    mode:"",
    outcomes,
    roundId:"slot:user:operation_123456",
    secret:"shadow-live-game-rng-secret-test",
  });
  const two=resolveOutcome({
    gameId:"slot",
    mode:"",
    outcomes,
    roundId:"slot:user:operation_123456",
    secret:"shadow-live-game-rng-secret-test",
  });
  assert.deepEqual(one,two);
  assert.equal(deterministicRoll(
    "shadow-live-game-rng-secret-test",
    "slot:user:operation_123456",
  ).roll,one.roll);
});

test("slot reels match resolved outcome category",()=>{
  const digest="00112233445566778899aabbccddeeff";
  const jackpot=slotReelsForOutcome("jackpot",digest);
  assert.equal(new Set(jackpot).size,1);
  const pair=slotReelsForOutcome("pair",digest);
  assert.equal(new Set(pair).size,2);
  const lose=slotReelsForOutcome("lose",digest);
  assert.equal(new Set(lose).size,3);
});

test("generic payout routes to game-specific calculator",()=>{
  const selections=normalizeSelections("witch","normal",[
    {choiceId:"moon",amountCoins:100},
  ]);
  assert.equal(calculatePayout({
    gameId:"witch",
    mode:"normal",
    selections,
    outcomeId:"moon",
  }),180);
});
