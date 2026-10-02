import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL("../../" + path, import.meta.url), "utf8");
}

test("Customer Service defaults entertainment features off and keeps 5/2 capacity", () => {
  const voice = source("cloudflare-worker/src/voice-session-legacy.js");

  assert.equal(voice.includes('const customerService=type==="customer_service";'), true);
  assert.equal(voice.includes('giftsEnabled:read("giftsEnabled",!customerService)'), true);
  assert.equal(voice.includes('pkEnabled:read("pkEnabled",!customerService)'), true);
  assert.equal(voice.includes('gamesEnabled:read("gamesEnabled",!customerService)'), true);
  assert.equal(voice.includes('roomRocketEnabled:read("roomRocketEnabled",!customerService)'), true);
  assert.equal(
    voice.includes('body.seats??(officialType==="customer_service"?5:8)'),
    true,
  );
  assert.equal(
    voice.includes('body.moderators??(officialType==="customer_service"?2:3)'),
    true,
  );
  assert.equal(voice.includes('controlAction==="setRoomFeatures"'), true);
  assert.equal(voice.includes('new ApiError("room_pk_disabled",409)'), true);
});

test("gifts, games and room rocket enforce room feature flags on the server", () => {
  const gift = source("cloudflare-worker/src/room-gift.js");
  const games = source("cloudflare-worker/src/legacy-games/game-runtime.js");

  assert.equal(gift.includes('"room_gifts_disabled"'), true);
  assert.equal(
    gift.includes('roomFeatureEnabled(\n      room,\n      "roomRocketEnabled"'),
    true,
  );
  assert.equal(gift.includes("if (roomRocketEnabled) {"), true);

  assert.equal(games.includes('"room_games_disabled"'), true);
  assert.equal(games.includes('roomType!=="customer_service"'), true);
});

test("Shadow Control exposes independent official-room feature switches", () => {
  const control = source("lib/main_control.dart");

  assert.equal(control.includes("createGiftsEnabled"), true);
  assert.equal(control.includes("createPkEnabled"), true);
  assert.equal(control.includes("createGamesEnabled"), true);
  assert.equal(control.includes("createRoomRocketEnabled"), true);
  assert.equal(control.includes("'controlAction':'createOfficialRoom'"), true);
  assert.equal(control.includes("execute('setRoomFeatures'"), true);
  assert.equal(control.includes("'giftsEnabled':giftsEnabled"), true);
  assert.equal(control.includes("'pkEnabled':pkEnabled"), true);
  assert.equal(control.includes("'gamesEnabled':gamesEnabled"), true);
  assert.equal(control.includes("'roomRocketEnabled':roomRocketEnabled"), true);
  assert.equal(
    control.includes("createSeatsController.text=customerService?'5':'8'"),
    true,
  );
  assert.equal(
    control.includes("createModeratorsController.text=customerService?'2':'3'"),
    true,
  );
  assert.equal(
    control.includes("labelText:'رابط صورة الغرفة الخارجية'"),
    true,
  );
});

test("room UI hides Level for official rooms and all support chrome in Customer Service", () => {
  const main = source("lib/main.dart");

  assert.equal(main.includes("bool get _showRoomLevel => !_isOfficialRoom;"), true);
  assert.equal(
    main.includes(
      "bool get _showRoomSupport =>\n      !_isCustomerServiceRoom && (!_isOfficialRoom || _roomGiftsEnabled);",
    ),
    true,
  );
  assert.equal(main.includes("if (_roomGiftsEnabled) ...["), true);
  assert.equal(main.includes("if (_roomGamesEnabled)"), true);
  assert.equal(
    main.includes("if (!_roomRocketEnabled) return const SizedBox.shrink();"),
    true,
  );
});
