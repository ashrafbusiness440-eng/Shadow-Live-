import assert from "node:assert/strict";
import test from "node:test";

import {
  adminInboxIndexId,
  adminInboxIndexPath,
  adminInboxDeleteWrites,
} from "../../cloudflare-worker/src/admin-inbox-index.js";

test("full legacy diary report ids never collide on reporter suffix", () => {
  const common = "diary_comment_" + "diary".repeat(19) + "_" +
    "comment".repeat(15) + "_";
  const reportA = common + "reporter_one";
  const reportB = common + "reporter_two";
  assert.ok(common.length > 160);
  assert.notEqual(reportA, reportB);
  assert.notEqual(
    adminInboxIndexId("diary_report", reportA),
    adminInboxIndexId("diary_report", reportB),
  );
  assert.equal(
    adminInboxIndexPath("diary_report", reportA),
    "admin_inbox_items/diary_report__" + reportA,
  );
});

test("terminal review removes both modern and old truncated index paths", () => {
  const targetId = "diary_comment_" + "x".repeat(290);
  const db = { writeDelete: (path) => ({ kind: "delete", path }) };
  const writes = adminInboxDeleteWrites(db, "diary_report", targetId);
  assert.equal(writes.length, 2);
  assert.equal(writes[0].path, adminInboxIndexPath("diary_report", targetId));
  assert.equal(writes[1].path, "admin_inbox_items/diary_report__" + targetId.slice(0, 160));

  const short = adminInboxDeleteWrites(db, "diary_report", "report_1");
  assert.equal(short.length, 1);
  assert.equal(short[0].path, "admin_inbox_items/diary_report__report_1");
});
