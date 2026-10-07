import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("gift picker stays compact and uses four-column coin UI", () => {
  const picker = source(
    "../../lib/features/gift/widgets/unified_gift_picker_sheet.dart",
  );

  assert.equal(
    picker.includes("height: MediaQuery.sizeOf(context).height * .55"),
    true,
  );
  assert.equal(picker.includes("crossAxisCount: 4"), true);
  assert.equal(picker.includes("_featuredStrip"), false);
  assert.equal(picker.includes("Icons.monetization_on_rounded"), true);
  assert.equal(picker.includes("Icons.add_circle_rounded"), true);
  assert.equal(picker.includes("Icons.remove"), false);
  assert.equal(picker.includes("formatCompactAmount"), true);
  assert.equal(picker.includes("Icons.shopping_bag_rounded"), true);
});

test("custom gift quantity is 1 through 9999 end to end", () => {
  const picker = source(
    "../../lib/features/gift/widgets/unified_gift_picker_sheet.dart",
  );
  const room = source("../../cloudflare-worker/src/room-gift.js");
  const direct = source(
    "../../cloudflare-worker/src/chat-safety-actions.js",
  );

  assert.equal(
    picker.includes("أدخل عدد الهدايا من 1 إلى 9999"),
    true,
  );
  assert.equal(
    picker.includes("value < 1 || value > 9999"),
    true,
  );
  assert.equal(room.includes("quantity < 1 || quantity > 9999"), true);
  assert.equal(direct.includes("quantity < 1 || quantity > 9999"), true);
  assert.equal(room.includes("[1, 7, 77, 777].includes(quantity)"), false);
  assert.equal(direct.includes("[1, 7, 77, 777].includes(quantity)"), false);
});

test("room recipient strip keeps owner first and shows mic seat numbers", () => {
  const roomSheet = source(
    "../../lib/features/gift/widgets/room_gift_sheet.dart",
  );
  const main = source("../../lib/main.dart");

  assert.equal(roomSheet.includes("final String ownerUid"), true);
  assert.equal(roomSheet.includes("a.uid == ownerUid"), true);
  assert.equal(roomSheet.includes("seat.index + 1"), true);
  assert.equal(roomSheet.includes("ListView.separated"), true);
  assert.equal(roomSheet.includes("mode: 'all_mics'"), true);
  assert.equal(roomSheet.includes("mode: 'all_room'"), true);
  assert.equal(main.includes("ownerUid: (_roomArguments['ownerUid']"), true);
});

test("gift bag is one bounded catalog source and free sends do not credit paid economy", () => {
  const catalog = source(
    "../../cloudflare-worker/src/legacy-economy/gift-catalog.js",
  );
  const client = source(
    "../../lib/features/gift/services/gift_catalog_service.dart",
  );
  const room = source("../../cloudflare-worker/src/room-gift.js");
  const direct = source(
    "../../cloudflare-worker/src/chat-safety-actions.js",
  );

  assert.equal(catalog.includes("publicGiftBag(db, decoded.uid)"), true);
  assert.equal(catalog.includes('.limit(100)'), true);
  assert.equal(catalog.includes('action === "grantBagGift"'), true);
  assert.equal(catalog.includes('"admin", "event", "free"'), true);
  assert.equal(client.includes("cachedBagQuantities"), true);

  for (const code of [room, direct]) {
    assert.equal(code.includes("gift_bag_insufficient"), true);
    assert.equal(code.includes("const paidCost = useGiftBag ? 0 :"), true);
    assert.equal(code.includes("bagQuantityRemaining"), true);
    assert.equal(code.includes("if (paidCost > 0)"), true);
  }
});
