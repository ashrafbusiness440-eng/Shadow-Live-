import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

function source(relative) {
  return readFileSync(new URL("../../" + relative, import.meta.url), "utf8");
}

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
