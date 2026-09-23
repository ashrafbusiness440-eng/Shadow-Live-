import {createHmac} from "node:crypto";

const clean=(value)=>String(value??"").trim();

export const TARGET_RTP_BPS=8500;
export const GAME_IDS=Object.freeze(["greedy_cat","witch","slot"]);

export const BET_LADDERS=Object.freeze({
  greedy_cat:Object.freeze([200,2000,20000,200000]),
  witch_normal:Object.freeze([100,1000,10000,100000]),
  witch_advanced:Object.freeze([200,2000,20000,200000]),
  slot:Object.freeze([200,1000,2000,5000,10000,20000,50000,100000,200000]),
});

export const GREEDY_CAT_CHOICES=Object.freeze({
  pepper5:Object.freeze({multiplier:5,group:"salad"}),
  tomato5:Object.freeze({multiplier:5,group:"salad"}),
  cabbage5:Object.freeze({multiplier:5,group:"salad"}),
  carrot5:Object.freeze({multiplier:5,group:"salad"}),
  chicken10:Object.freeze({multiplier:10,group:"pizza"}),
  fish15:Object.freeze({multiplier:15,group:"pizza"}),
  steak25:Object.freeze({multiplier:25,group:"pizza"}),
  shell45:Object.freeze({multiplier:45,group:"pizza"}),
});

export const WITCH_CHOICES=Object.freeze({
  normal:Object.freeze({
    moon:1.8,mirror:2.2,potion:3,orb:4,owl:6,book:10,
  }),
  advanced:Object.freeze({
    moon:2.2,mirror:3,potion:4.5,orb:6,owl:9,book:16,
  }),
});

export const SLOT_OUTCOMES=Object.freeze({
  lose:Object.freeze({multiplier:0}),
  pair:Object.freeze({multiplier:2}),
  jackpot:Object.freeze({multiplier:20}),
});

export const DEFAULT_OUTCOME_WEIGHTS=Object.freeze({
  greedy_cat:Object.freeze([
    Object.freeze({id:"pepper5",weightBps:2000}),
    Object.freeze({id:"tomato5",weightBps:1999}),
    Object.freeze({id:"cabbage5",weightBps:1999}),
    Object.freeze({id:"carrot5",weightBps:1999}),
    Object.freeze({id:"chicken10",weightBps:1036}),
    Object.freeze({id:"fish15",weightBps:536}),
    Object.freeze({id:"steak25",weightBps:144}),
    Object.freeze({id:"shell45",weightBps:8}),
    Object.freeze({id:"salad",weightBps:278}),
    Object.freeze({id:"pizza",weightBps:1}),
  ]),
  witch_normal:Object.freeze([
    Object.freeze({id:"moon",weightBps:1364}),
    Object.freeze({id:"mirror",weightBps:1384}),
    Object.freeze({id:"potion",weightBps:1472}),
    Object.freeze({id:"orb",weightBps:1578}),
    Object.freeze({id:"owl",weightBps:1812}),
    Object.freeze({id:"book",weightBps:2390}),
  ]),
  witch_advanced:Object.freeze([
    Object.freeze({id:"moon",weightBps:2395}),
    Object.freeze({id:"mirror",weightBps:2235}),
    Object.freeze({id:"potion",weightBps:1908}),
    Object.freeze({id:"orb",weightBps:1644}),
    Object.freeze({id:"owl",weightBps:1216}),
    Object.freeze({id:"book",weightBps:602}),
  ]),
  slot:Object.freeze([
    Object.freeze({id:"lose",weightBps:6875}),
    Object.freeze({id:"pair",weightBps:3000}),
    Object.freeze({id:"jackpot",weightBps:125}),
  ]),
});

export function defaultOutcomeWeights(gameId,mode=""){
  const key=gameId==="witch"
    ? (mode==="advanced"?"witch_advanced":"witch_normal")
    : gameId;
  const source=DEFAULT_OUTCOME_WEIGHTS[key];
  if(!source)throw Error("unsupported_game");
  return source.map(item=>({id:item.id,weightBps:item.weightBps}));
}

export function validIdempotencyKey(value){
  return /^[A-Za-z0-9_-]{12,220}$/.test(clean(value));
}

function defaultBets(gameId,mode){
  if(gameId==="greedy_cat")return BET_LADDERS.greedy_cat;
  if(gameId==="slot")return BET_LADDERS.slot;
  if(gameId==="witch"){
    return mode==="advanced"
      ? BET_LADDERS.witch_advanced
      : BET_LADDERS.witch_normal;
  }
  throw Error("unsupported_game");
}

export function validateBetLadder(gameId,mode,rawBets){
  const source=Array.isArray(rawBets)&&rawBets.length?rawBets:defaultBets(gameId,mode);
  if(source.length<1||source.length>20)throw Error("invalid_bet_ladder");
  const normalized=[];
  let previous=0;
  for(const raw of source){
    const value=Number(raw);
    if(!Number.isSafeInteger(value)||value<=0||value>100000000||value<=previous){
      throw Error("invalid_bet_ladder");
    }
    previous=value;
    normalized.push(value);
  }
  return Object.freeze(normalized);
}

function allowedBetSet(gameId,mode,rawBets){
  return new Set(validateBetLadder(gameId,mode,rawBets));
}

function choiceMap(gameId,mode){
  if(gameId==="greedy_cat")return GREEDY_CAT_CHOICES;
  if(gameId==="witch")return WITCH_CHOICES[mode==="advanced"?"advanced":"normal"];
  throw Error("unsupported_game");
}

export function normalizeBetEvents(gameId,mode,rawSelections,allowedBets){
  if(!GAME_IDS.includes(gameId))throw Error("unsupported_game");
  if(gameId==="slot"){
    const amount=Number(Array.isArray(rawSelections)
      ? rawSelections[0]?.amountCoins
      : rawSelections?.amountCoins);
    if(!allowedBetSet(gameId,mode,allowedBets).has(amount))throw Error("invalid_bet");
    return Object.freeze([{choiceId:"spin",amountCoins:amount}]);
  }

  if(gameId==="witch"&&!["normal","advanced"].includes(mode)){
    throw Error("invalid_mode");
  }
  if(!Array.isArray(rawSelections)||rawSelections.length<1||rawSelections.length>100){
    throw Error("invalid_bets");
  }
  const choices=choiceMap(gameId,mode);
  const ladder=allowedBetSet(gameId,mode,allowedBets);
  const events=[];
  for(const raw of rawSelections){
    const choiceId=clean(raw?.choiceId);
    const amountCoins=Number(raw?.amountCoins);
    if(!Object.prototype.hasOwnProperty.call(choices,choiceId)){
      throw Error("invalid_choice");
    }
    if(!Number.isSafeInteger(amountCoins)||!ladder.has(amountCoins)){
      throw Error("invalid_bet");
    }
    events.push(Object.freeze({choiceId,amountCoins}));
  }
  return Object.freeze(events);
}

export function normalizeSelections(gameId,mode,rawSelections,allowedBets){
  const events=normalizeBetEvents(gameId,mode,rawSelections,allowedBets);
  if(gameId==="slot")return events;

  const merged=new Map();
  for(const event of events){
    const previous=merged.get(event.choiceId)||{amountCoins:0,entryCount:0};
    const nextAmount=previous.amountCoins+event.amountCoins;
    if(!Number.isSafeInteger(nextAmount)||nextAmount<=0){
      throw Error("invalid_bet");
    }
    merged.set(event.choiceId,{
      amountCoins:nextAmount,
      entryCount:previous.entryCount+1,
    });
  }

  return Object.freeze(
    [...merged.entries()].map(([choiceId,value])=>Object.freeze({
      choiceId,
      amountCoins:value.amountCoins,
      entryCount:value.entryCount,
    })),
  );
}

export function totalStake(selections){
  const value=selections.reduce((sum,item)=>sum+Number(item.amountCoins||0),0);
  if(!Number.isSafeInteger(value)||value<=0)throw Error("invalid_bet");
  return value;
}

export function greedyCatPayout(selections,outcomeId){
  const outcome=clean(outcomeId);
  if(outcome!=="salad"&&outcome!=="pizza"&&
    !Object.prototype.hasOwnProperty.call(GREEDY_CAT_CHOICES,outcome)){
    throw Error("invalid_outcome");
  }
  let payout=0;
  for(const bet of selections){
    const choice=GREEDY_CAT_CHOICES[bet.choiceId];
    if(!choice)throw Error("invalid_choice");
    const wins=
      outcome===bet.choiceId||
      (outcome==="salad"&&choice.group==="salad")||
      (outcome==="pizza"&&choice.group==="pizza");
    if(wins)payout+=Math.floor(bet.amountCoins*choice.multiplier);
  }
  if(!Number.isSafeInteger(payout)||payout<0)throw Error("invalid_payout");
  return payout;
}

export function witchPayout(selections,mode,outcomeId){
  const choices=WITCH_CHOICES[mode==="advanced"?"advanced":"normal"];
  if(!Object.prototype.hasOwnProperty.call(choices,outcomeId)){
    throw Error("invalid_outcome");
  }
  let payout=0;
  for(const bet of selections){
    if(bet.choiceId===outcomeId){
      payout+=Math.floor(bet.amountCoins*Number(choices[outcomeId]));
    }
  }
  if(!Number.isSafeInteger(payout)||payout<0)throw Error("invalid_payout");
  return payout;
}

export function slotPayout(amountCoins,outcomeId){
  const outcome=SLOT_OUTCOMES[outcomeId];
  if(!outcome)throw Error("invalid_outcome");
  const payout=Math.floor(Number(amountCoins)*outcome.multiplier);
  if(!Number.isSafeInteger(payout)||payout<0)throw Error("invalid_payout");
  return payout;
}

export function validateOutcomeWeights(gameId,mode,outcomes){
  if(!Array.isArray(outcomes)||outcomes.length<2||outcomes.length>32){
    throw Error("invalid_probabilities");
  }
  const allowed=gameId==="greedy_cat"
    ? new Set([...Object.keys(GREEDY_CAT_CHOICES),"salad","pizza"])
    : gameId==="witch"
      ? new Set(Object.keys(WITCH_CHOICES[mode==="advanced"?"advanced":"normal"]))
      : new Set(Object.keys(SLOT_OUTCOMES));
  let total=0;
  const seen=new Set();
  const normalized=[];
  for(const raw of outcomes){
    const id=clean(raw?.id);
    const weightBps=Number(raw?.weightBps);
    if(!allowed.has(id)||seen.has(id)||!Number.isSafeInteger(weightBps)||
      weightBps<=0||weightBps>10000){
      throw Error("invalid_probabilities");
    }
    seen.add(id);
    total+=weightBps;
    normalized.push(Object.freeze({id,weightBps}));
  }
  if(total!==10000)throw Error("invalid_probabilities");
  return Object.freeze(normalized);
}

export function deterministicRoll(secret,roundId){
  const key=clean(secret);
  const id=clean(roundId);
  if(key.length<24||id.length<3)throw Error("rng_not_configured");
  const digest=createHmac("sha256",key).update(id).digest();
  const value=digest.readUInt32BE(0);
  return {
    roll:value%10000,
    digestHex:digest.toString("hex"),
  };
}

export function weightedOutcome(outcomes,roll){
  const value=Math.max(0,Math.min(9999,Math.floor(Number(roll))));
  let cursor=0;
  for(const outcome of outcomes){
    cursor+=outcome.weightBps;
    if(value<cursor)return outcome.id;
  }
  throw Error("invalid_probabilities");
}

export function resolveOutcome({gameId,mode,outcomes,roundId,secret}){
  const normalized=validateOutcomeWeights(gameId,mode,outcomes);
  const entropy=deterministicRoll(secret,roundId);
  return {
    outcomeId:weightedOutcome(normalized,entropy.roll),
    roll:entropy.roll,
    entropyDigest:entropy.digestHex,
  };
}

export function calculatePayout({gameId,mode,selections,outcomeId}){
  if(gameId==="greedy_cat")return greedyCatPayout(selections,outcomeId);
  if(gameId==="witch")return witchPayout(selections,mode,outcomeId);
  if(gameId==="slot")return slotPayout(selections[0].amountCoins,outcomeId);
  throw Error("unsupported_game");
}

export function dailyRoundClock({
  nowMs=Date.now(),
  durationSeconds=30,
  timezoneOffsetMinutes=240,
  gameId,
  mode="",
}={}){
  const durationMs=Math.max(10,Math.min(300,Number(durationSeconds||30)))*1000;
  const offsetMs=Math.max(-720,Math.min(840,Number(timezoneOffsetMinutes||0)))*60000;
  const shifted=Number(nowMs)+offsetMs;
  const dayIndex=Math.floor(shifted/86400000);
  const dayStartShifted=dayIndex*86400000;
  const elapsed=Math.max(0,shifted-dayStartShifted);
  const roundNumber=Math.floor(elapsed/durationMs)+1;
  const opensAtMs=dayStartShifted-offsetMs+(roundNumber-1)*durationMs;
  const closesAtMs=opensAtMs+durationMs;
  const dayKey=new Date(dayStartShifted).toISOString().slice(0,10);
  const modeKey=gameId==="witch"?":"+clean(mode):"";
  return Object.freeze({
    dayKey,
    roundNumber,
    opensAtMs,
    closesAtMs,
    roundId:gameId+modeKey+":"+dayKey+":"+String(roundNumber),
  });
}

export function slotReelsForOutcome(outcomeId,entropyDigest){
  const symbols=["crown","diamond","star","mic","moon","fire"];
  const hex=clean(entropyDigest).padEnd(12,"0");
  const at=(offset)=>parseInt(hex.slice(offset,offset+2),16)%symbols.length;
  const a=at(0);
  if(outcomeId==="jackpot")return [symbols[a],symbols[a],symbols[a]];
  if(outcomeId==="pair"){
    const b=(a+1+(at(2)%5))%symbols.length;
    return [symbols[a],symbols[a],symbols[b]];
  }
  let b=at(2);
  let c=at(4);
  if(b===a)b=(b+1)%symbols.length;
  if(c===a||c===b)c=(c+2)%symbols.length;
  if(c===a||c===b)c=(c+1)%symbols.length;
  return [symbols[a],symbols[b],symbols[c]];
}
