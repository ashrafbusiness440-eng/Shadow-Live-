import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  ROOM_FILTER_EVIDENCE_RETENTION_MS,
  ROOM_FILTER_FLAG_RING_SIZE,
  ROOM_FILTER_FLAG_PURGE_BATCH,
  roomFlagEvidenceExpired, roomFlagPublicItem,
} from "../../cloudflare-worker/src/room-filter-evidence-retention.js";
import { flagSampleRepeatCount } from "../../cloudflare-worker/src/content-filter-control.js";

test("U6-I room private proof is never copied into normal report lists", () => {
  const now = Date.UTC(2026, 9, 14);
  const flagged = { sequence:3, actorUid:"account_a",
    status:"pending", evidence:{ text:"ONE PRIVATE MESSAGE" },
    reviewedAtMs:0, createdAtMs:now };
  const publicItem=roomFlagPublicItem(flagged,now);
  assert.equal(publicItem.evidence,undefined);
  assert.equal(publicItem.hasSensitiveEvidence,true);
  assert.equal(JSON.stringify(publicItem).includes("ONE PRIVATE MESSAGE"),false);
  assert.equal(flagged.evidence.text,"ONE PRIVATE MESSAGE");
});

test("U6-I 90-day expiry denies reads at boundary even before hourly ring sweep",()=>{
  const reviewedAtMs=Date.UTC(2026, 9, 14);
  assert.equal(ROOM_FILTER_EVIDENCE_RETENTION_MS,90*24*3600*1000);
  const item={status:"reviewed",reviewedAtMs,evidence:{text:"ONE PRIVATE MESSAGE"}};
  assert.equal(roomFlagEvidenceExpired(item,
    reviewedAtMs+ROOM_FILTER_EVIDENCE_RETENTION_MS-1),false);
  assert.equal(roomFlagEvidenceExpired(item,
    reviewedAtMs+ROOM_FILTER_EVIDENCE_RETENTION_MS),true);
  assert.equal(roomFlagPublicItem(item,
    reviewedAtMs+ROOM_FILTER_EVIDENCE_RETENTION_MS).hasSensitiveEvidence,false);
  assert.equal(roomFlagEvidenceExpired({status:"pending",reviewedAtMs},Date.now()),false);
  assert.equal(roomFlagEvidenceExpired({status:"reviewed"},Date.now()),false);
});

test("U6-I old room evidence cleanup is bounded without a new timer or listener",()=>{
  const room=fs.readFileSync("cloudflare-worker/src/room-realtime-object.js","utf8");
  const worker=fs.readFileSync("cloudflare-worker/src/index.js","utf8");
  assert.equal(ROOM_FILTER_FLAG_RING_SIZE,1000);
  assert.equal(ROOM_FILTER_FLAG_PURGE_BATCH,25);
  assert.match(room,/"\/filter\/flag\/purge"/);
  assert.match(room,/roomFlagEvidenceExpired\(item, nowMs\)/);
  assert.match(room,/roomFlagPublicItem\(item\)/);
  assert.match(room,/evidencePurgedAtMs/);
  assert.match(worker,/getUTCMinutes\(\) === 0/);
  assert.match(worker,/https:\/\/internal\/filter\/flag\/purge/);
  assert.equal(room.includes("setInterval("),false);
});

test("U6-I repeat indicators count only within an already-returned bounded sample",()=>{
  const ts=Date.UTC(2026,9,14);
  const flags=[
    {actorUid:"a",createdAtMs:ts,id:"a1"},
    {actorUid:"a",createdAtMs:ts-3600_000,id:"a2"},
    {actorUid:"a",createdAtMs:ts-30*3600_000,id:"a3"},
    {actorUid:"b",createdAtMs:ts,id:"b"},
  ];
  assert.equal(flagSampleRepeatCount(flags,flags[0]),2);
  assert.equal(flagSampleRepeatCount(flags,flags[2]),1);
  assert.equal(flagSampleRepeatCount(flags,flags[3]),1);
  assert.equal(flagSampleRepeatCount(flags,{actorUid:"",createdAtMs:ts}),0);
  const ui=fs.readFileSync("lib/admin/system_reports_control_page.dart","utf8");
  assert.match(ui,/العينة المحدودة/);
  assert.match(ui,/repeatsInSample24h/);
});
