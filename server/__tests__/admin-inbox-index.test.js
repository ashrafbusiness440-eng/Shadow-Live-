import assert from "node:assert/strict";
import test from "node:test";

import {
  adminInboxIndexId,
  adminInboxIndexPath,
  adminInboxDeleteWrites,
  adminInboxLegacyIndexPath,
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

test("terminal review removes legacy row only when its target matches", () => {
  const targetId = "diary_comment_" + "x".repeat(290);
  const competingId = "diary_comment_" + "x".repeat(290) + "_another";
  const db = { writeDelete: (path) => ({ kind: "delete", path }) };
  const legacyPath = adminInboxLegacyIndexPath("diary_report", targetId);
  assert.equal(legacyPath, "admin_inbox_items/diary_report__" + targetId.slice(0, 160));
  const unknown = adminInboxDeleteWrites(db, "diary_report", targetId);
  assert.equal(unknown.length, 1);
  const competitor = adminInboxDeleteWrites(db, "diary_report", targetId, {
    exists: true, data: { targetId: competingId },
  });
  assert.equal(competitor.length, 1);
  assert.equal(competitor[0].path, adminInboxIndexPath("diary_report", targetId));
  const owned = adminInboxDeleteWrites(db, "diary_report", targetId, {
    exists: true, data: { targetId },
  });
  assert.equal(owned.length, 2);
  assert.equal(owned[1].path, legacyPath);
  const short = adminInboxDeleteWrites(db, "diary_report", "report_1");
  assert.equal(short.length, 1);
  assert.equal(short[0].path, "admin_inbox_items/diary_report__report_1");
});
