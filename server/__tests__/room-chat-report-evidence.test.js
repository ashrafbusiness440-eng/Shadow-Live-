import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL("../../" + path, import.meta.url), "utf8");
}

test("room reports preserve only bounded live-session evidence", () => {
  const object = source("cloudflare-worker/src/room-realtime-object.js");
  const persistence = source(
    "cloudflare-worker/src/room-realtime-persistence.js",
  );

  assert.equal(object.includes('"client.room_chat_report"'), true);
  assert.equal(object.includes('"room.chat_report_ack"'), true);
  assert.equal(object.includes('"room_realtime_session"'), true);
  assert.equal(object.includes('recentChat: [...previous, chatMessage].slice(-7)'), true);
  assert.equal(object.includes('const from = Math.max(0, targetIndex - 2);'), true);
  assert.equal(
    object.includes('const to = Math.min(recentChat.length, targetIndex + 3);'),
    true,
  );
  assert.equal(object.includes('targetType: "room_message"'), true);
  assert.equal(object.includes('status: "new"'), true);
  assert.equal(object.includes('db.writeCreate(\`reports/\${reportId}\`'), true);
  assert.equal(object.includes('collection("messages")'), false);
});

test("room report UI submits only a message id and reason over the live socket", () => {
  const presence = source(
    "lib/features/room/services/room_presence_service.dart",
  );
  const service = source(
    "lib/features/room/services/room_chat_service.dart",
  );
  const feed = source(
    "lib/features/room/widgets/room_chat_panel.dart",
  );

  assert.equal(presence.includes("'client.room_chat_report'"), true);
  assert.equal(presence.includes("'messageId': targetMessageId"), true);
  assert.equal(presence.includes("'reason': reportReason"), true);
  assert.equal(service.includes("reportRoomChatMessage("), true);
  assert.equal(feed.includes("'إبلاغ عن الرسالة'"), true);
  assert.equal(
    feed.includes("'يُحفظ فقط دليل محدود لهذه الرسالة وسياق قريب منها للمراجعة.'"),
    true,
  );
});
