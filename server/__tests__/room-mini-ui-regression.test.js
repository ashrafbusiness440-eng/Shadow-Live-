import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";

function source(relative) {
  return readFileSync(new URL("../../" + relative, import.meta.url), "utf8");
}

test("Mini Room is rendered, draggable, restorable, and explicitly leaveable", () => {
  const shell = source("lib/features/main/screens/main_shell_screen.dart");
  const room = source("lib/main.dart");

  assert.equal(shell.includes("VoiceRoomSessionController.instance"), true);
  assert.equal(shell.includes("Key('mini-room-card')"), true);
  assert.equal(shell.includes("Key('mini-room-close')"), true);
  assert.equal(shell.includes("onPanUpdate:"), true);
  assert.equal(shell.includes("NetworkImage(imageUrl)"), true);
  assert.equal(shell.includes("_voiceSession.restore();"), true);
  assert.equal(
    shell.includes("AppRoutes.voiceChatRoom"),
    true,
  );
  assert.equal(
    shell.includes("_miniRoomSeatService.leaveSeat(roomId)"),
    true,
  );
  assert.equal(shell.includes("await _voiceSession.leave();"), true);

  assert.equal(room.includes("PopScope<Object?>"), true);
  assert.equal(
    room.includes("if (!didPop) unawaited(_minimizeVoiceRoom());"),
    true,
  );
});
