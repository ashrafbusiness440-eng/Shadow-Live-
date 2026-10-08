import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";

test("chat/diary gift reports specific missing resource codes", async () => {
  const source = await readFile(
    new URL("../../cloudflare-worker/src/chat-safety-actions.js", import.meta.url),
    "utf8",
  );

  assert.equal(source.includes('new ApiError("sender_not_found", 404)'), true);
  assert.equal(source.includes('new ApiError("receiver_not_found", 404)'), true);
  assert.equal(source.includes('"diary_not_found" : "conversation_not_found"'), true);
  assert.equal(source.includes('new ApiError("invalid_diary_receiver", 409)'), true);
});
