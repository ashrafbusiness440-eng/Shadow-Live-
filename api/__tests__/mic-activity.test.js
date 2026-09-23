import assert from "node:assert/strict";
import test from "node:test";
import {
  activeMicSegments,
  splitUtcIntervalByDay,
  totalMicSeconds,
} from "../../server/economy/mic-activity.js";

test("muted seat time never counts as real mic activity",()=>{
  const end=Date.UTC(2026,8,22,12,0,0);
  const start=end-2*60*60*1000;
  assert.deepEqual(
    activeMicSegments({muted:true,micStartedAtMs:start},end),
    [],
  );
});

test("120 unmuted minutes equals one 7200-second activity interval",()=>{
  const start=Date.UTC(2026,8,22,10,0,0);
  const end=start+120*60*1000;
  const segments=activeMicSegments({muted:false,micStartedAtMs:start},end);
  assert.equal(segments.length,1);
  assert.equal(segments[0].day,"2026-09-22");
  assert.equal(segments[0].seconds,7200);
  assert.equal(totalMicSeconds(segments),7200);
});

test("mic interval crossing UTC midnight is split into the correct days",()=>{
  const start=Date.UTC(2026,8,22,23,30,0);
  const end=Date.UTC(2026,8,23,0,30,0);
  assert.deepEqual(splitUtcIntervalByDay(start,end),[
    {day:"2026-09-22",month:"2026-09",seconds:1800},
    {day:"2026-09-23",month:"2026-09",seconds:1800},
  ]);
});

test("missing or invalid active start does not create activity",()=>{
  const end=Date.UTC(2026,8,22,12,0,0);
  assert.deepEqual(activeMicSegments({muted:false,micStartedAtMs:0},end),[]);
  assert.deepEqual(activeMicSegments({muted:false},end),[]);
});
