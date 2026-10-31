import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const gift = readFileSync(new URL("../src/room-gift.js", import.meta.url), "utf8");
const voice = readFileSync(new URL("../src/voice-session-legacy.js", import.meta.url), "utf8");
const insights = voice.slice(
  voice.indexOf("async function roomInsights("),
  voice.indexOf("async function roomBootstrap("),
);

test("room recipient totals are committed with the verified idempotent gift", () => {
  const body = gift.slice(
    gift.indexOf("for (let index = 0; index < recipientRecords.length; index += 1)"),
    gift.indexOf("gift_transactions/", gift.indexOf("for (let index = 0; index < recipientRecords.length; index += 1)")),
  );
  assert.match(body, /roomDailyPath \+ "\/recipients\/" \+ receiverId/);
  assert.match(body, /if \(paidRecipientCost > 0\)/);
  assert.match(body, /db\.increment\("receivedCoins", paidRecipientCost\)/);
  assert.match(body, /db\.increment\("giftCount", quantity\)/);
  assert.doesNotMatch(body, /rooms\/\$\{roomId\}\/recipients/);
  assert.match(body, /roomReceiverName/);
  assert.match(body, /roomReceiverProfileImageUrl/);
});

test("receiver rankings are day and room bound, descending, bounded and opt-in", () => {
  assert.match(insights, /const includeAttraction=body\.includeAttraction===true/);
  assert.match(insights, /dailySupportRef\.collection\("recipients"\)/);
  assert.match(insights, /\.orderBy\("receivedCoins","desc"\)\.limit\(50\)\.get\(\)/);
  assert.match(insights, /dailySupport:Math\.max\(0,Number\(data\.receivedCoins\|\|0\)\)/);
  assert.match(insights, /attraction=await enrichSupporterPublicMetadata\(db,ranked,uid\)/);
  assert.match(insights, /\n    attraction,\n    ranking,/);
});

test("no room-wide query or extra per-gift room-root update is introduced", () => {
  const rec = gift.slice(
    gift.indexOf("// Daily receiver ranking"),
    gift.indexOf("...userLevelSupportAggregateWrites", gift.indexOf("// Daily receiver ranking")),
  );
  assert.doesNotMatch(rec, /\.collection\("rooms"\)\.get\(/);
  assert.doesNotMatch(rec, /"rooms\/" \+ roomId/);
  assert.match(rec, /writes\.push\(/);
});
