import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("room uses one effect coordinator for entrance gift and animated emoji visuals", () => {
  const main = source("../../lib/main.dart");
  const coordinator = source(
    "../../lib/features/room/widgets/room_effect_coordinator.dart",
  );
  const legacy = source(
    "../../lib/features/room/widgets/cosmetic_effect_widgets.dart",
  );

  assert.equal(main.includes("RoomEffectCoordinatorHost("), true);
  assert.equal(main.includes("RoomEntranceEffectHost("), false);
  assert.equal(legacy.includes("class RoomEntranceEffectHost"), false);

  assert.equal(coordinator.includes("ingestEntrance("), true);
  assert.equal(coordinator.includes("ingestGiftMessage("), true);
  assert.equal(coordinator.includes("ingestAnimatedEmojiMessage("), true);
  assert.equal(coordinator.includes("maxCinematicQueue = 8"), true);
  assert.equal(coordinator.includes("maxParallelSeatEffects = 8"), true);
  assert.equal(coordinator.includes("IgnorePointer("), true);
});

test("room effects toggle is visual-only and does not touch gift delivery", () => {
  const main = source("../../lib/main.dart");
  const coordinator = source(
    "../../lib/features/room/widgets/room_effect_coordinator.dart",
  );
  const roomGift = source("../../cloudflare-worker/src/room-gift.js");

  assert.equal(main.includes("visualEnabled: value"), true);
  assert.equal(coordinator.includes("_clearVisualState()"), true);
  assert.equal(coordinator.includes("financial_ledger"), false);
  assert.equal(roomGift.includes("effectMinQuantity"), false);
  assert.equal(roomGift.includes("giftVisualPolicy(gift, quantity)"), true);
});

test("room and direct messages reuse one animated emoji catalog", () => {
  const room = source(
    "../../lib/features/room/widgets/room_chat_panel.dart",
  );
  const dm = source(
    "../../lib/features/chat/screens/private_chat_screen.dart",
  );
  const dartCatalog = source(
    "../../lib/features/chat/services/animated_emoji_catalog.dart",
  );
  const serverCatalog = source(
    "../../cloudflare-worker/src/animated-emoji-catalog.js",
  );

  assert.equal(
    room.includes("chat/services/animated_emoji_catalog.dart"),
    true,
  );
  assert.equal(
    dm.includes("services/animated_emoji_catalog.dart"),
    true,
  );
  assert.equal(room.includes("showAnimatedEmojiPicker("), true);
  assert.equal(dm.includes("showAnimatedEmojiPicker("), true);
  assert.equal(dartCatalog.includes("emoji.vip_star.animation"), true);
  assert.equal(serverCatalog.includes("emoji.vip_star.animation"), true);
});
