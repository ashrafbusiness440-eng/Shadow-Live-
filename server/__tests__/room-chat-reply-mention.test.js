import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL("../../" + path, import.meta.url), "utf8");
}

test("live room feed exposes reply, mention and report actions", () => {
  const feed = source("lib/features/room/widgets/room_chat_panel.dart");

  assert.equal(feed.includes("'رد'"), true);
  assert.equal(feed.includes("'منشن'"), true);
  assert.equal(feed.includes("'إبلاغ عن الرسالة'"), true);
  assert.equal(feed.includes("prepareRoomChatReply("), true);
  assert.equal(feed.includes("prepareRoomChatMention("), true);
});

test("live composer sends reply and mention metadata over realtime chat", () => {
  const feed = source("lib/features/room/widgets/room_chat_panel.dart");
  const session = source(
    "lib/features/voice/services/voice_room_session_controller.dart",
  );

  assert.equal(feed.includes("replyTo: reply?.id"), true);
  assert.equal(feed.includes("replyPreview: reply?.text"), true);
  assert.equal(feed.includes("replySenderUid: reply?.senderUid"), true);
  assert.equal(
    feed.includes("mentionUid == null ? const [] : <String>[mentionUid]"),
    true,
  );
  assert.equal(feed.includes("'رد على '"), true);
  assert.equal(session.includes("_roomChatReplyTarget"), true);
  assert.equal(session.includes("_roomChatMentionTarget"), true);
  assert.equal(session.includes("clearRoomChatComposerIntent()"), true);
});
