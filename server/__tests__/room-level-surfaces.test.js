import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL("../../" + path, import.meta.url), "utf8");
}

test("room chat embeds level metadata without per-message Firestore reads", () => {
  const realtime = source("cloudflare-worker/src/room-realtime.js");
  const object = source("cloudflare-worker/src/room-realtime-object.js");
  const feed = source("lib/features/room/widgets/room_chat_panel.dart");

  assert.equal(realtime.includes("loadUserLevelPolicy(db).catch(() => null)"), true);
  assert.equal(realtime.includes("wealthLevel: levelMetadata.wealthLevel"), true);
  assert.equal(realtime.includes("attractionLevel: levelMetadata.attractionLevel"), true);
  assert.equal(realtime.includes("gameLevel: levelMetadata.gameLevel"), true);

  const start = object.indexOf("#handleRoomChatMessage(webSocket, raw)");
  const end = object.indexOf("\n  async webSocketMessage", start);
  const block = object.slice(start, end);
  assert.notEqual(start, -1);
  assert.equal(block.includes("db.get("), false);
  assert.equal(block.includes("firestore"), false);
  assert.equal(block.includes("attachment.wealthLevel"), true);
  assert.equal(block.includes("attachment.attractionLevel"), true);
  assert.equal(block.includes("attachment.gameLevel"), true);

  assert.equal(feed.includes("_openChatQuickProfile(message)"), true);
  assert.equal(feed.includes("UserLevelBadges.fromLevels("), true);
  assert.equal(feed.includes("micro: true"), true);
});

test("supporter privacy uses bounded batch reads and keeps top3 image-only", () => {
  const voice = source("cloudflare-worker/src/voice-session-legacy.js");
  const main = source("lib/main.dart");

  const snapshotStart = voice.indexOf(
    "async function supporterRankingUserSnapshots",
  );
  const filterStart = voice.indexOf(
    "async function filterSupporterRankingVisibility",
    snapshotStart,
  );
  const enrichStart = voice.indexOf(
    "async function enrichSupporterPublicMetadata",
    filterStart,
  );
  const insightsStart = voice.indexOf("async function roomInsights", enrichStart);

  const snapshots = voice.slice(snapshotStart, filterStart);
  const filter = voice.slice(filterStart, enrichStart);
  const enrich = voice.slice(enrichStart, insightsStart);
  assert.notEqual(snapshotStart, -1);
  assert.equal(snapshots.includes("list.slice(0,maxUsers)"), true);
  assert.equal(snapshots.includes("db.getAll(...refs)"), true);
  assert.equal(snapshots.includes(".get()"), false);

  assert.equal(enrich.includes("publicLevelMetadata"), true);
  assert.equal(enrich.includes("loadPublicProfilePresentations"), true);
  assert.equal(enrich.includes("{limit:50,concurrency:8}"), true);
  assert.equal(
    enrich.includes("supporterRankingUserSnapshots(db,list,viewerUid,50)"),
    true,
  );
  assert.equal(enrich.includes("filterHiddenSupporters"), true);
  assert.equal(filter.includes("supporterRankingUserSnapshots(db,list,viewerUid,3)"), true);
  assert.equal(filter.includes("return [];"), true);

  const roomStart = insightsStart;
  const roomEnd = voice.indexOf("\nasync function ", roomStart + 20);
  const roomBlock = voice.slice(roomStart, roomEnd);
  assert.equal(
    roomBlock.includes(
      "supporters=await enrichSupporterPublicMetadata(db,supporters,uid)",
    ),
    true,
  );
  assert.equal(
    roomBlock.includes(
      "supporters=await filterSupporterRankingVisibility(db,supporters,uid)",
    ),
    true,
  );

  const sheetStart = main.indexOf("Future<void> _showSupportersSheet()");
  const sheetEnd = main.indexOf("Future<void> _showRoomRankingSheet()", sheetStart);
  const sheet = main.slice(sheetStart, sheetEnd);
  assert.notEqual(sheetStart, -1);
  assert.equal(sheet.includes("supporter.publicId"), true);
  assert.equal(sheet.includes("RegistryBadge("), true);
  assert.equal(sheet.includes("UserLevelBadges.fromLevels("), true);
  assert.equal(sheet.includes("showQuickProfileSheet("), true);

  const topStart = main.indexOf("Widget _buildSupporterCluster()");
  const topEnd = main.indexOf("\n  Widget ", topStart + 20);
  const top = main.slice(topStart, topEnd);
  assert.notEqual(topStart, -1);
  assert.equal(top.includes("ProfileAvatarWithFrame("), true);
  assert.equal(top.includes("UserLevelBadges"), false);
  assert.equal(top.includes("RegistryBadge"), false);
});

test("room supporter parsing carries public id and all public badge metadata", () => {
  const service = source("lib/features/room/services/room_insights_service.dart");
  assert.equal(service.includes("final String publicId;"), true);
  assert.equal(service.includes("final int vipLevel;"), true);
  assert.equal(service.includes("final List<String> badges;"), true);
  assert.equal(service.includes("final int wealthLevel;"), true);
  assert.equal(service.includes("final int attractionLevel;"), true);
  assert.equal(service.includes("final int gameLevel;"), true);
});
