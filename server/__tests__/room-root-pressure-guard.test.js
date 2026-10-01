import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("room gifts no longer fan support counters out through rooms/{roomId}", () => {
  const roomGift = source("../../cloudflare-worker/src/room-gift.js");

  assert.equal(roomGift.includes("const roomDailySupport ="), false);
  assert.equal(roomGift.includes("dailySupport: roomDailySupport"), false);
  assert.equal(roomGift.includes("weeklySupport: roomWeeklySupport"), false);
  assert.equal(roomGift.includes("monthlySupport: roomMonthlySupport"), false);

  assert.equal(roomGift.includes("const roomDailyPath ="), true);
  assert.equal(roomGift.includes("const roomWeeklyPath ="), true);
  assert.equal(roomGift.includes("const roomMonthlyPath ="), true);
  assert.equal(
    roomGift.includes("High-frequency room support lives in the period support documents"),
    true,
  );
});

test("room insights and bootstrap read exact support period documents", () => {
  const voice = source("../../cloudflare-worker/src/voice-session-legacy.js");

  assert.equal(
    voice.includes('roomRef.collection("support_daily").doc(periods.day)'),
    true,
  );
  assert.equal(
    voice.includes('roomRef.collection("support_weekly").doc(periods.week)'),
    true,
  );
  assert.equal(
    voice.includes('roomRef.collection("support_monthly").doc(periods.month)'),
    true,
  );
  assert.equal(
    voice.includes("Number(weeklySupportSnap.data()?.supportCoins||0)"),
    true,
  );
  assert.equal(
    voice.includes("Number(monthlySupportSnap.data()?.supportCoins||0)"),
    true,
  );
});

test("room chat touches the room root at most once per minute", () => {
  const voice = source("../../cloudflare-worker/src/voice-session-legacy.js");

  assert.equal(
    voice.includes("const ROOM_CHAT_ROOT_TOUCH_INTERVAL_MS=60_000;"),
    true,
  );
  assert.equal(
    voice.includes(
      "lastChatAtMs<=0||nowMs-lastChatAtMs>=ROOM_CHAT_ROOT_TOUCH_INTERVAL_MS",
    ),
    true,
  );
});


test("Agency room logo link reuses bootstrap metadata without an Agency hot-path read", () => {
  const voice = source("../../cloudflare-worker/src/voice-session-legacy.js");
  const main = source("../../lib/main.dart");
  const publicAgency = source(
    "../../lib/features/agency/screens/public_agency_page.dart",
  );

  const roomResponseStart = voice.indexOf("function roomResponse(roomId,data)");
  const bootstrapStart = voice.indexOf("async function roomBootstrap");
  const bootstrapEnd = voice.indexOf("async function ", bootstrapStart + 20);
  assert.notEqual(roomResponseStart, -1);
  assert.notEqual(bootstrapStart, -1);

  const roomResponseBlock = voice.slice(roomResponseStart, bootstrapStart);
  const bootstrapBlock = voice.slice(
    bootstrapStart,
    bootstrapEnd === -1 ? voice.length : bootstrapEnd,
  );

  assert.equal(roomResponseBlock.includes("const agencyId=clean(data.agencyId);"), true);
  assert.equal(
    roomResponseBlock.includes(
      'agencyId:roomType==="agency"&&/^\\d{3,8}$/.test(agencyId)?agencyId:""',
    ),
    true,
  );
  assert.equal(roomResponseBlock.includes('agencyLogoUrl:roomType==="agency"'), true);
  assert.equal(bootstrapBlock.includes('collection("agencies")'), false);
  assert.equal(bootstrapBlock.includes("agencies/"), false);
  assert.equal(bootstrapBlock.includes("viewerAgencyId:clean(actor.agencyId)"), true);
  assert.equal(bootstrapBlock.includes("viewerAgencyRole:clean(actor.agencyRole)"), true);

  assert.equal(main.includes("agency-room-logo-button"), true);
  assert.equal(main.includes("agency-room-house-button"), false);
  assert.equal(main.includes("agencyIdForRoom(_roomArguments)"), true);
  assert.equal(main.includes("viewerAgencyId: viewerAgencyId"), true);
  assert.equal(main.includes("viewerAgencyRole: viewerAgencyRole"), true);
  assert.equal(publicAgency.includes("viewerAgencyRole"), true);
});


test("opening an existing active room keeps the no-extra-user-read fast path", () => {
  const voice = source("../../cloudflare-worker/src/voice-session-legacy.js");
  const start = voice.indexOf("async function openPersonalRoom(db,uid");
  const end = voice.indexOf("async function changeRoomPublicId", start);
  const block = voice.slice(start, end);
  const fastReturn = block.indexOf("if(data.isActive!==false){");
  const userRead = block.indexOf("const userSnap=await userRef.get();");

  assert.notEqual(start, -1);
  assert.notEqual(fastReturn, -1);
  assert.notEqual(userRead, -1);
  assert.ok(fastReturn < userRead);
  assert.equal(
    block.includes('clean(user.agencyRole)==="owner"&&/^\\d{3,8}$/.test(linkedAgencyId)'),
    true,
  );
  assert.equal(
    block.includes('tx.set(agencyRef,{roomId,updatedAt:now},{merge:true});'),
    true,
  );
});


test("Agency room managers reuse the actor snapshot and do not add Agency hot-path reads", () => {
  const voice = source("../../cloudflare-worker/src/voice-session-legacy.js");

  assert.equal(
    voice.includes("function agencyRoomManagementCapabilities(room,actor,uid)"),
    true,
  );
  assert.equal(voice.includes('role==="manager"||role==="senior_manager"'), true);
  assert.equal(
    voice.includes("agencyCapabilities=agencyRoomManagementCapabilities(room,actor,uid)"),
    true,
  );

  const bootstrapStart = voice.indexOf("async function roomBootstrap");
  const bootstrapEnd = voice.indexOf("async function ", bootstrapStart + 20);
  const bootstrapBlock = voice.slice(
    bootstrapStart,
    bootstrapEnd === -1 ? voice.length : bootstrapEnd,
  );
  assert.equal(bootstrapBlock.includes('collection("agencies")'), false);
  assert.equal(bootstrapBlock.includes("agencies/"), false);
});

test("First room creation for an Agency Owner links the same deterministic personal room id", () => {
  const voice = source("../../cloudflare-worker/src/voice-session-legacy.js");

  const start = voice.indexOf("async function openPersonalRoom");
  const end = voice.indexOf("async function changeRoomPublicId", start);
  const block = voice.slice(start, end);

  assert.equal(block.includes('const roomId="personal_"+uid;'), true);
  assert.equal(block.includes('clean(user.agencyRole)==="owner"'), true);
  assert.equal(block.includes('roomType:createAsAgency?"agency":"personal"'), true);
  assert.equal(block.includes("tx.set(agencyRef,{roomId,updatedAt:now},{merge:true});"), true);
  assert.equal(block.includes("length:createAsAgency?10:8"), true);
});


test("Agency room discovery reuses the already-loaded room list", () => {
  const rooms = source("../../lib/screens/room/room_list_screen.dart");

  assert.equal(
    rooms.includes("return ['الكل', 'دردشة', 'رسمية', 'وكالات', ...result];"),
    true,
  );
  assert.equal(rooms.includes("case 'وكالات':"), true);
  assert.equal(rooms.includes("return _isAgencyRoom(room);"), true);
  assert.equal(
    rooms.includes(".where((room) => _matchesRoomFilter(room, _category))"),
    true,
  );
  assert.equal(rooms.includes("loadAgencyRooms"), false);
});

test("Agency application review cards are lazy and open the full profile", () => {
  const control = source("../../lib/admin/agency_control_page.dart");
  const backend = source("../../cloudflare-worker/src/agency-control.js");

  assert.equal(control.includes("'action': 'reviewDetails'"), true);
  assert.equal(control.includes("PublicProfileScreen(userId: uid)"), true);
  assert.equal(control.includes("reviewPersonCard("), true);
  assert.equal(control.includes("profileImageUrl"), true);
  assert.equal(control.includes("accountStatus"), true);
  assert.equal(control.includes("availability"), true);

  const detailsStart = backend.indexOf("export async function getAgencyReviewDetails");
  const reviewStart = backend.indexOf("export async function startAgencyReview", detailsStart);
  const block = backend.slice(detailsStart, reviewStart);
  assert.equal(block.includes("AGENCY_LIMITS.maxApplicationHostIds"), true);
  assert.equal(block.includes("db.get(\`users/\${person.uid}\`)"), true);
  assert.equal(
    block.includes("db.get(\`agency_user_memberships/\${person.uid}\`)"),
    true,
  );
  assert.equal(block.includes("runQuery("), false);
});
