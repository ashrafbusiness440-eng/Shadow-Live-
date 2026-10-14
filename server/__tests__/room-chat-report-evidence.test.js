import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { verifiedRoomReportEvidence } from "../../cloudflare-worker/src/chat-safety-actions.js";

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


test("U6-A verified room evidence is bounded and ignores submitted client claims", () => {
  const time = new Date("2026-10-14T12:00:00Z");
  const live = {
    roomName:"الغرفة الرسمية", roomType:"agency", ownerUid:"owner001",
    hostUid:"host001", isActive:true,
    seats:Array.from({length:40},(_,i)=>({
      index:i, uid:i%3===0 ? "" : "uid"+i,
      muted:i%2===0, locked:i===2, muteLocked:i===4,
      streamToken:"never_copy_voice_tokens",
      privateEmail:"never_copy_email",
    })),
  };
  const snapshot=verifiedRoomReportEvidence(live,time);
  assert.equal(snapshot.source,"verified_room_document");
  assert.deepEqual(snapshot.recordedAt,time);
  assert.equal(snapshot.roomState.name,"الغرفة الرسمية");
  assert.equal(snapshot.roomState.type,"agency");
  assert.equal(snapshot.roomState.ownerUid,"owner001");
  assert.equal(snapshot.roomState.hostUid,"host001");
  assert.equal(snapshot.roomState.occupiedSeatCount,14);
  assert.equal(snapshot.roomState.occupiedSeats.length,14);
  assert.equal(snapshot.roomState.occupiedSeats[0].uid,"uid1");
  assert.equal(snapshot.roomState.occupiedSeats.at(-1).uid,"uid20");
  assert.doesNotMatch(JSON.stringify(snapshot),/streamToken|privateEmail|never_copy/);
  const report=source("cloudflare-worker/src/chat-safety-actions.js");
  assert.match(report,/evidence: verifiedRoomReportEvidence\(room\.data \|\| \{\}, now\)/);
  assert.ok(!report.includes("evidence: verifiedRoomReportEvidence(body"));
});
