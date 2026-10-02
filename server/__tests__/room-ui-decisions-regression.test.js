import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

function source(relative) {
  return readFileSync(new URL("../../" + relative, import.meta.url), "utf8");
}


test("Room Image audit uses canonical variables without stale cover aliases", () => {
  const voice = source("cloudflare-worker/src/voice-session-legacy.js");
  const start = voice.indexOf("async function updateRoomSettings(");
  const end = voice.indexOf("async function setRoomChatEnabled", start);
  const block = voice.slice(start, end);

  assert.notEqual(start, -1);
  assert.equal(block.includes("coverImageObjectIdProvided"), false);
  assert.equal(block.includes("\n        coverImageUrl,\n"), false);
  assert.equal(block.includes("roomImageUrl,"), true);
  assert.equal(
    block.includes("coverImageUrl:roomImageUrl"),
    true,
  );
});

test("Room Image is the canonical external room image across list, API and settings", () => {
  const main = source("lib/main.dart");
  const rooms = source("lib/screens/room/room_list_screen.dart");
  const voice = source("cloudflare-worker/src/voice-session-legacy.js");

  assert.equal(
    rooms.includes("room.data['roomImageUrl'] ??"),
    true,
  );
  assert.equal(
    rooms.indexOf("room.data['roomImageUrl']") <
      rooms.indexOf("room.data['coverImageUrl']"),
    true,
  );
  assert.equal(
    main.indexOf("_roomArguments['roomImageUrl']") <
      main.indexOf("_roomArguments['coverImageUrl']"),
    true,
  );
  assert.equal(
    voice.includes(
      "roomImageUrl:clean(data.roomImageUrl||data.coverImageUrl||data.imageUrl)",
    ),
    true,
  );
  assert.equal(
    voice.includes("coverImageUrl:roomImageUrl"),
    true,
  );
});

test("Room image stays separate from room background and settings route to My Items", () => {
  const main = source("lib/main.dart");
  const items = source("lib/features/profile/screens/my_items_screen.dart");

  const backgroundStart = main.indexOf("Widget _buildRoomBackground({");
  const backgroundEnd = main.indexOf(
    "\n  @override\n  Widget build(BuildContext context)",
    backgroundStart,
  );
  const background = main.slice(backgroundStart, backgroundEnd);

  assert.ok(backgroundStart >= 0);
  assert.equal(background.includes("coverImageUrl"), false);
  assert.equal(background.includes("rewardImageUrl"), true);
  assert.equal(background.includes("rewardAssetKey"), true);

  assert.equal(main.includes("'صورة الغرفة'"), true);
  assert.equal(
    main.includes("تظهر في قائمة الغرف والهيدر فقط، وليست خلفية الغرفة."),
    true,
  );
  assert.equal(main.includes("'خلفية الغرفة'"), true);
  assert.equal(main.includes("initialType: 'room_background'"), true);
  assert.equal(items.includes("this.initialType"), true);
});

test("Room menu is grouped and room IDs follow the latest 3-8 digit reusable policy", () => {
  const main = source("lib/main.dart");
  const voice = source("cloudflare-worker/src/voice-session-legacy.js");

  assert.equal(main.includes("'إجراء سريع'"), true);
  assert.equal(main.includes("'إدارة الغرفة'"), true);
  assert.equal(main.includes("'الإعدادات'"), true);
  assert.equal(main.includes("'الجلسة'"), true);
  assert.equal(main.includes("'الدخول الخفي'"), true);
  assert.equal(main.includes("'تغيير معرّف الغرفة'"), true);
  assert.equal(main.includes("'معرّف جديد — من 3 إلى 8 أرقام'"), true);
  assert.equal(
    main.includes("'المعرّف القديم يصبح متاحًا للاستخدام بعد نجاح التغيير.'"),
    true,
  );

  const changeStart = voice.indexOf("async function changeRoomPublicId(");
  const changeEnd = voice.indexOf(
    "\nasync function updateRoomSettings(",
    changeStart,
  );
  const change = voice.slice(changeStart, changeEnd);

  assert.ok(changeStart >= 0);
  assert.equal(change.includes("/^[0-9]{3,8}$/"), true);
  assert.equal(change.includes("tx.delete(oldRef);"), true);
  assert.equal(change.includes("active:false"), false);
  assert.equal(change.includes("replacedBy:newPublicId"), false);
});


test("room image crop is real square output and Agency images stay on their dedicated path", () => {
  const main = source("lib/main.dart");
  const crop = source(
    "lib/features/agency/widgets/agency_room_image_crop_sheet.dart",
  );

  assert.equal(main.includes("showRoomImageCropSheet("), true);
  assert.equal(main.includes("scope: 'agency_room_image'"), true);
  assert.equal(main.includes("'agencyRoomImageUrl'"), true);
  assert.equal(main.includes("'agencyRoomImageObjectId'"), true);
  assert.equal(
    main.includes("replaceObjectId:"),
    true,
  );

  assert.equal(crop.includes("aspectRatio: 1"), true);
  assert.equal(crop.includes("fixCropRect: true"), true);
  assert.equal(crop.includes("shape: BoxShape.circle"), true);
  assert.equal(crop.includes("_cropController.crop();"), true);
  assert.equal(crop.includes("_cropController.cropCircle();"), false);
  assert.equal(
    crop.includes("المربع هو القص الفعلي المحفوظ. الدائرة معاينة فقط"),
    true,
  );
});
