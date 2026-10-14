import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { generalReportsTestHooks, generalReportType } from "../../cloudflare-worker/src/general-reports.js";
import { adminInboxTestHooks } from "../../cloudflare-worker/src/admin-inbox.js";
import { mutateAccount } from "../../cloudflare-worker/src/manage-user-account.js";
import { reportPriority } from "../../cloudflare-worker/src/report-priority-policy.js";
import { manageUserAccessInternals } from "../../cloudflare-worker/src/manage-user-access.js";

class Db {
  constructor(seed = {}) {
    this.docs = new Map(Object.entries(seed).map(([k,v]) => [k, structuredClone(v)]));
    this.queryCalls = 0;
  }
  async beginTransaction() { return "test_tx"; }
  async rollback() {}
  async get(path) {
    return { exists: this.docs.has(path), data: this.docs.has(path)
      ? structuredClone(this.docs.get(path)) : null };
  }
  async list(collection, limit = 200) {
    return [...this.docs.entries()].filter(([key]) =>
      key.startsWith(collection + "/") &&
      !key.substring(collection.length + 1).includes("/")
    ).slice(0, limit).map(([key, data]) =>
      ({ id: key.substring(collection.length + 1), data: structuredClone(data) }));
  }
  async runQuery(collection, options = {}) {
    this.queryCalls++;
    return [...this.docs.entries()].filter(([key]) =>
      key.startsWith(collection + "/") &&
      !key.substring(collection.length + 1).includes("/")
    ).map(([key,data]) => ({
      id: key.substring(collection.length + 1), data: structuredClone(data),
    })).filter(row => (options.filters || []).every(filter =>
      filter.op === "==" && row.data?.[filter.field] === filter.value
    )).sort((a, b) => options.orderBy?.length
      ? b.id.localeCompare(a.id) : 0)
      .filter(row => !options.startAfter?.length ||
        row.id.localeCompare(
          String(options.startAfter[0]?.referencePath || "").split("/").pop(),
        ) < 0)
      .slice(0, options.limit || 100);
  }
  writeCreate(path, fields) { return {kind:"create",path,fields:structuredClone(fields)}; }
  writeUpdate(path, fields) { return {kind:"update",path,fields:structuredClone(fields)}; }
  writeDelete(path) { return {kind:"delete",path}; }
  async commit(_tx, writes) {
    for (const w of writes) {
      if (w.kind === "delete") this.docs.delete(w.path);
      else if (w.kind === "create") {
        if (this.docs.has(w.path)) throw Error("already_exists");
        this.docs.set(w.path, structuredClone(w.fields));
      } else this.docs.set(w.path, {
        ...this.docs.get(w.path), ...structuredClone(w.fields),
      });
    }
  }
}

const cases = () => ({
  "reports/legacy_chat": {
    type:"user", source:"private_chat", reporterId:"reporter",
    targetUserId:"target", conversationId:"dm1", reason:"harassment",
    status:"open", createdAt:new Date(4000),
  },
  "reports/room_msg": {
    targetType:"room_message", reporterUid:"reporter", targetUid:"target",
    roomId:"room1", messageId:"m1", status:"new", reason:"abuse",
    evidence:{message:{text:"bad"},context:[{text:"bad"}]},
    createdAt:new Date(3000),
  },
  "reports/room_1": {
    targetType:"room", reporterUid:"reporter", targetUid:"owner",
    roomId:"room1", status:"under_review", reason:"spam",
    createdAt:new Date(2000),
  },
  "reports/diary_1": {
    targetType:"diary", reporterUid:"reporter", status:"new",
    createdAt:new Date(5000),
  },
  "public_profiles/reporter": {displayName:"المبلّغ",publicId:"12345678"},
  "public_profiles/target": {displayName:"المبلّغ عليه",publicId:"87654321"},
  "public_profiles/owner": {displayName:"صاحب الغرفة",publicId:"11223344"},
});

test("only user and room reports enter this separate moderation flow", () => {
  assert.equal(generalReportType({type:"user",source:"private_chat"}),"user_report");
  assert.equal(generalReportType({targetType:"room_message"}),"room_message_report");
  assert.equal(generalReportType({targetType:"room"}),"room_report");
  assert.equal(generalReportType({targetType:"diary"}),"");
});

test("existing report sources are queried within limits, with verified public profiles", async () => {
  const db = new Db(cases());
  const out = await generalReportsTestHooks.listGeneralReports(db, {limit:20});
  assert.equal(db.queryCalls,4);
  assert.equal(out.items.length,3);
  assert.deepEqual(out.items.map(x=>x.type),[
    "user_report","room_message_report","room_report"]);
  assert.equal(out.items[0].reporterProfile.displayName,"المبلّغ");
  assert.equal(out.items[0].targetProfile.publicId,"87654321");
  assert.equal(out.items[1].evidence,undefined);
  assert.equal(out.items[1].hasSensitiveEvidence,true);
  assert.equal(out.items[2].targetProfile.displayName,"صاحب الغرفة");
  const detail = await generalReportsTestHooks.getGeneralReport(db,{reportId:"room_msg"});
  assert.equal(detail.item.evidence,undefined);
  assert.equal(detail.item.hasSensitiveEvidence,true);
  await assert.rejects(
    () => generalReportsTestHooks.getGeneralReport(db,{reportId:"diary_1"}),
    /report_not_found/);
});

test("unified hub sections use only matching bounded report sources", async () => {
  const direct = { "reports/direct_account_1": {
    targetType:"user", source:"profile", reporterUid:"reporter",
    targetUid:"target", reason:"spam", status:"new",
    createdAt:new Date(6000),
  }};
  const peopleDb = new Db({...cases(), ...direct});
  const people = await generalReportsTestHooks.listGeneralReports(
    peopleDb, { limit: 25, scope: "people" });
  assert.equal(peopleDb.queryCalls, 1);
  assert.deepEqual(people.items.map(x => x.type), ["account_report"]);
  assert.equal(people.items[0].targetUid, "target");

  const roomsDb = new Db({...cases(), ...direct});
  const rooms = await generalReportsTestHooks.listGeneralReports(
    roomsDb, { limit: 25, scope: "rooms_messages" });
  assert.equal(roomsDb.queryCalls, 3);
  assert.deepEqual(rooms.items.map(x => x.type),
    ["user_report", "room_message_report", "room_report"]);
  assert.equal(rooms.items.some(x => x.type === "account_report"), false);
  const peopleHistory = await generalReportsTestHooks.listReportHistory(
    peopleDb, {type:"account_report"});
  assert.equal(peopleHistory.items.length, 1);
  assert.equal(peopleHistory.items[0].reportId, "direct_account_1");
  await assert.rejects(
    () => generalReportsTestHooks.listGeneralReports(
      new Db(cases()), {scope:"incorrect"}),
    /invalid_report_scope/,
  );
});

test("review changes are idempotent, guarded and audit-logged", async () => {
  const db = new Db(cases());
  const call = (status,key) => generalReportsTestHooks.reviewGeneralReport(
    db,"admin",{reportId:"legacy_chat",status,
      reason:"قرار إشرافي واضح",idempotencyKey:key});
  await assert.rejects(() => call("actioned","invalid_step_123456"),
    /action_requires_execution/);
  const updated = await call("under_review","review_case_1234567");
  assert.equal(updated.status,"under_review");
  assert.equal(db.docs.get("reports/legacy_chat").reviewedBy,"admin");
  assert.equal(db.docs.get("admin_inbox_items/user_report__legacy_chat").meta.status,
    "under_review");
  assert.equal(db.docs.has("admin_audit_logs/general_report_review_case_1234567"),
    true);
  const reviewNotice = db.docs.get(
    "notifications/report_result_review_case_1234567");
  assert.equal(reviewNotice.userId, "reporter");
  assert.match(reviewNotice.body, /قيد المراجعة/);
  const repeated = await call("under_review","review_case_1234567");
  assert.equal(repeated.code,"duplicate");
  await call("rejected","reject_case_1234567");
  assert.equal(db.docs.get("reports/legacy_chat").status,"rejected");
  assert.equal(db.docs.has("admin_inbox_items/user_report__legacy_chat"),false);
  assert.equal(db.docs.get("notifications/report_result_reject_case_1234567").userId,
    "reporter");
  assert.equal([...db.docs.keys()].filter(x => x.startsWith(
    "notifications/report_result_review_case_1234567")).length, 1);
});

test("old index v1 migrates once, and permissions hide other people's reports", async () => {
  const db = new Db({
    ...cases(), "admin_inbox_items/__meta":{schemaVersion:1,ready:true},
  });
  const owner = {uid:"admin",owner:true,capabilities:new Set()};
  const first = await adminInboxTestHooks.loadIndexedItems(db,owner);
  assert.equal(first.length,3);
  assert.equal(db.docs.get("admin_inbox_items/__meta").schemaVersion,2);
  const reads = db.queryCalls;
  const second = await adminInboxTestHooks.loadIndexedItems(db,owner);
  assert.equal(second.length,3);
  assert.equal(db.queryCalls,reads);
  const otherActor = {uid:"other",owner:false,capabilities:new Set()};
  const noAccess = await adminInboxTestHooks.loadIndexedItems(db,otherActor);
  assert.equal(noAccess.length,0);
});

test("room complaint checks real session presence and creates one inbox item", () => {
  const safety = fs.readFileSync("cloudflare-worker/src/chat-safety-actions.js","utf8");
  const room = fs.readFileSync("cloudflare-worker/src/room-realtime-persistence.js","utf8");
  const ui = fs.readFileSync("lib/main.dart","utf8");
  assert.equal(safety.includes('case "reportRoom":'),true);
  assert.equal(safety.includes("realtimeUserPresentFromNamespace("),true);
  assert.equal(safety.includes('type: "room_report"'),true);
  assert.equal(safety.includes('type: "user_report"'),true);
  assert.equal(room.includes('type: "room_message_report"'),true);
  assert.equal(room.includes("adminInboxUpsertWrite(db"),true);
  assert.equal(ui.includes("'إبلاغ عن الغرفة'"),true);
  assert.equal(ui.includes("_roomActions.reportRoom("),true);
});

test("history fetches one category per bounded page and includes closed reports", async () => {
  const seed = {};
  for (let i = 0; i < 45; i++) {
    const id = "legacy_" + String(i).padStart(3, "0");
    seed["reports/" + id] = {
      type: "user", source: "private_chat",
      reporterUid: "alice", targetUid: "bob",
      status: i % 3 === 0 ? "closed" : i % 3 === 1 ? "rejected" : "under_review",
      reason: "abuse", createdAt: new Date(1000 + i),
    };
  }
  seed["reports/unrelated_999"] = {
    targetType: "diary", status: "new", createdAt: new Date(90000),
  };
  const db = new Db(seed);
  const page1 = await generalReportsTestHooks.listReportHistory(db, {
    type: "user_report",
  });
  assert.equal(page1.items.length, 20);
  assert.equal(page1.items[0].reportId, "legacy_044");
  assert.ok(page1.items.some(x => x.status === "closed"));
  assert.equal(page1.hasMore, true);
  assert.equal(page1.nextCursor, "legacy_025");
  assert.equal(db.queryCalls, 1);
  const page2 = await generalReportsTestHooks.listReportHistory(db, {
    type: "user_report", cursor: page1.nextCursor,
  });
  assert.equal(page2.items.length, 20);
  assert.equal(page2.items[0].reportId, "legacy_024");
  assert.equal(page2.nextCursor, "legacy_005");
  const page3 = await generalReportsTestHooks.listReportHistory(db, {
    type: "user_report", cursor: page2.nextCursor,
  });
  assert.equal(page3.items.length, 5);
  assert.equal(page3.hasMore, false);
  const all = [...page1.items, ...page2.items, ...page3.items];
  assert.equal(new Set(all.map(x => x.reportId)).size, 45);
  assert.equal(db.queryCalls, 3);
});

test("history refuses arbitrary queries, cursor injection and unknown category", async () => {
  const db = new Db(cases());
  await assert.rejects(
    () => generalReportsTestHooks.listReportHistory(db, { type: "diary" }),
    /invalid_report_type/,
  );
  await assert.rejects(
    () => generalReportsTestHooks.listReportHistory(db, {
      type: "user_report", cursor: "abc/def",
    }), /invalid_cursor/,
  );
  assert.equal(db.queryCalls, 0);
  const out = await generalReportsTestHooks.listReportHistory(db, {
    type: "room_report",
  });
  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].targetProfile.displayName, "صاحب الغرفة");
});

test("rejected report accepts empty explanation, still notifies, and guards other decisions", async () => {
  const db = new Db(cases());
  const r = await generalReportsTestHooks.reviewGeneralReport(db, "admin", {
    reportId: "legacy_chat", status: "rejected", reason: "",
    idempotencyKey: "reject_optional_123456",
  });
  assert.equal(r.status, "rejected");
  const notification = db.docs.get("notifications/report_result_reject_optional_123456");
  assert.equal(notification.userId, "reporter");
  assert.doesNotMatch(notification.body, /السبب:/);
  await assert.rejects(
    () => generalReportsTestHooks.reviewGeneralReport(new Db(cases()), "admin", {
      reportId: "legacy_chat", status: "under_review", reason: "",
      idempotencyKey: "review_empty_reason_123456",
    }), /invalid_reason/,
  );
});

test("a report cannot claim actioned without a completed account-operation receipt", async () => {
  const db = new Db(cases());
  const params = {
    reportId: "room_1", status: "actioned",
    reason: "تم اتخاذ إجراء يستلزم التحقق من التنفيذ",
    idempotencyKey: "unverified_action_123456",
  };
  await assert.rejects(
    () => generalReportsTestHooks.reviewGeneralReport(db, "admin", params),
    /action_requires_execution/,
  );
  await assert.rejects(
    () => generalReportsTestHooks.reviewGeneralReport(
      db, "admin", params, {
        actionKind: "account_banned",
        operationKey: "missing_receipt_123456",
      }),
    /unverified_account_action/,
  );
  assert.equal(db.docs.get("reports/room_1").status, "under_review");
  assert.equal(db.docs.has("notifications/report_result_unverified_action_123456"), false);
  assert.equal(db.docs.has("admin_audit_logs/general_report_unverified_action_123456"), false);
});

test("warning is persisted and sent to the accused before report outcome", async () => {
  const db = new Db({
    ...cases(),
    "users/admin": {role:"owner",adminEnabled:true,accountStatus:"active"},
    "users/target": {role:"user",accountStatus:"active",warningCount:0},
  });
  await generalReportsTestHooks.reviewGeneralReport(db,"admin",{
    reportId:"legacy_chat",status:"under_review",
    reason:"مراجعة البلاغ",idempotencyKey:"warn_review_12345678901",
  });
  const params = {reportId:"legacy_chat",accountAction:"warn",
    reason:"تحذير بشأن الإساءة في المحادثة",idempotencyKey:"warn_action_12345678901"};
  const result = await generalReportsTestHooks.resolveWithAccountAction(
    db,{}, {sub:"admin"}, "admin", params);
  assert.equal(result.status,"actioned");
  assert.equal(result.moderationAction,"warning");
  assert.equal(db.docs.get("reports/legacy_chat").moderationAction,"warning");
  const accused = db.docs.get("users/target");
  assert.equal(accused.accountStatus,"active");
  assert.equal(accused.warningCount,1);
  assert.equal(accused.lastWarnedBy,"admin");
  assert.equal(accused.lastWarningReason,params.reason);
  assert.equal(db.docs.get("control_operations/warn_action_12345678901_account").action,"warn");
  assert.equal(db.docs.get("control_operations/warn_action_12345678901_account")
    .result.linkedReportId, "legacy_chat");
  const recipientNotice = db.docs.get("notifications/account_warning_warn_action_12345678901_account");
  assert.equal(recipientNotice.userId,"target");
  assert.match(recipientNotice.body,/تحذير بشأن الإساءة/);
  const reporterNotice = db.docs.get(
    "notifications/report_result_warn_action_12345678901_resolution");
  assert.equal(reporterNotice.userId,"reporter");
  assert.equal(reporterNotice.actionKind,"warning");
  assert.match(reporterNotice.body,/تحذيري/);
  const again = await generalReportsTestHooks.resolveWithAccountAction(
    db,{}, {sub:"admin"}, "admin", params);
  assert.equal(again.code,"duplicate");
  assert.equal(db.docs.get("users/target").warningCount,1);
  assert.equal([...db.docs.keys()].filter(p =>
    p.startsWith("notifications/account_warning_warn_action_12345678901_")).length,1);
});

test("warning requires an actual receipt and respects protected roles", async () => {
  const initial = cases();
  await assert.rejects(
    () => generalReportsTestHooks.reviewGeneralReport(
      new Db(initial),"admin", {
        reportId:"room_1",status:"actioned",reason:"تحذير مثبت",
        idempotencyKey:"fake_warning_123456",
      }, {actionKind:"warning",operationKey:"no_warning_receipt_123456"}),
    /unverified_account_action/,
  );
  const ownerDb = new Db({
    ...initial,
    "users/admin": {role:"owner",adminEnabled:true,accountStatus:"active"},
    "users/target": {role:"owner",accountStatus:"active"},
  });
  await generalReportsTestHooks.reviewGeneralReport(ownerDb,"admin",{
    reportId:"legacy_chat",status:"under_review",
    reason:"مراجعة البلاغ",idempotencyKey:"warn_owner_review_123456",
  });
  await assert.rejects(() =>
    generalReportsTestHooks.resolveWithAccountAction(
      ownerDb,{}, {sub:"admin"},"admin", {
        reportId:"legacy_chat",accountAction:"warn",
        reason:"تحذير غير مسموح",idempotencyKey:"warn_owner_action_123456",
      }), /owner_protected/);
  assert.equal(ownerDb.docs.has(
    "notifications/account_warning_warn_owner_action_123456_account"), false);

  const limitedDb = new Db({
    ...initial,
    "users/admin": {role:"moderator",adminEnabled:true,capabilities:["reviewReports"]},
    "users/target": {role:"user",accountStatus:"active"},
  });
  await generalReportsTestHooks.reviewGeneralReport(limitedDb,"admin",{
    reportId:"legacy_chat",status:"under_review",
    reason:"مراجعة البلاغ",idempotencyKey:"warn_limited_review_123456",
  });
  await assert.rejects(() =>
    generalReportsTestHooks.resolveWithAccountAction(
      limitedDb,{}, {sub:"admin"},"admin", {
        reportId:"legacy_chat",accountAction:"warn",
        reason:"قرار دون صلاحية",idempotencyKey:"warn_limited_action_123456",
      }), /forbidden/);
  assert.equal(limitedDb.docs.get("reports/legacy_chat").status, "under_review");
  assert.equal(limitedDb.docs.has(
    "notifications/account_warning_warn_limited_action_123456_account"), false);
});

test("authorized report action actually bans account before reporter gets a ban notice", async () => {
  const db = new Db({
    ...cases(),
    "users/admin": {role:"owner",adminEnabled:true,accountStatus:"active"},
    "users/target": {role:"user",accountStatus:"active"},
  });
  await generalReportsTestHooks.reviewGeneralReport(db,"admin",{
    reportId:"legacy_chat",status:"under_review",
    reason:"بلاغ يحتاج مراجعة",idempotencyKey:"acct_review_11000000001",
  });
  const result = await generalReportsTestHooks.resolveWithAccountAction(
    db, {}, {sub:"admin"}, "admin", {
      reportId:"legacy_chat",accountAction:"ban",
      reason:"إساءة مثبتة تستوجب الحظر",
      idempotencyKey:"acct_action_11000000001",
    },
  );
  assert.equal(result.status, "actioned");
  assert.equal(db.docs.get("users/target").accountStatus, "banned");
  const note = db.docs.get(
    "notifications/report_result_acct_action_11000000001_resolution");
  assert.equal(note.userId,"reporter");
  assert.equal(note.actionKind,"account_banned");
  assert.match(note.body,/حظر الحساب/);
  const repeat = await generalReportsTestHooks.resolveWithAccountAction(
    db, {}, {sub:"admin"}, "admin", {
      reportId:"legacy_chat",accountAction:"ban",
      reason:"إساءة مثبتة تستوجب الحظر",
      idempotencyKey:"acct_action_11000000001",
    });
  assert.equal(repeat.code,"duplicate");
  assert.equal([...db.docs.keys()].filter(x => x ===
    "notifications/report_result_acct_action_11000000001_resolution").length,1);
});

test("reported user's owner protection blocks punishment and notification", async () => {
  const db = new Db({
    ...cases(),
    "users/admin": {role:"owner",adminEnabled:true,accountStatus:"active"},
    "users/target": {role:"owner",adminEnabled:true,accountStatus:"active"},
  });
  await generalReportsTestHooks.reviewGeneralReport(db,"admin",{
    reportId:"legacy_chat",status:"under_review",
    reason:"فحص",idempotencyKey:"acct_owner_review_12345",
  });
  await assert.rejects(
    () => generalReportsTestHooks.resolveWithAccountAction(
      db,{}, {sub:"admin"}, "admin", {
        reportId:"legacy_chat",accountAction:"ban",reason:"طلب حظر خاطئ",
        idempotencyKey:"acct_owner_action_123456",
      }),
    /owner_protected/,
  );
  assert.equal(db.docs.get("users/target").accountStatus,"active");
  assert.equal(db.docs.has(
    "notifications/report_result_acct_owner_action_123456_resolution"),false);
});


test("case-bound account receipts cannot be reused for another complaint", async () => {
  const db = new Db({
    ...cases(),
    "reports/second_chat": {
      type:"user", source:"private_chat", reporterUid:"reporter",
      targetUid:"target", reason:"harassment", status:"under_review",
      createdAt:new Date(7000),
    },
    "users/admin": {role:"owner",adminEnabled:true,accountStatus:"active"},
    "users/target": {role:"user",accountStatus:"active",warningCount:0},
  });
  await generalReportsTestHooks.reviewGeneralReport(db, "admin", {
    reportId:"legacy_chat", status:"under_review", reason:"مراجعة أولى",
    idempotencyKey:"case_bound_review_123456",
  });
  const sharedKey = "case_bound_action_123456";
  await generalReportsTestHooks.resolveWithAccountAction(
    db, {}, {sub:"admin"}, "admin", {
      reportId:"legacy_chat", accountAction:"warn",
      reason:"تحذير مثبت للأولى", idempotencyKey:sharedKey,
    });
  await assert.rejects(
    () => generalReportsTestHooks.resolveWithAccountAction(
      db, {}, {sub:"admin"}, "admin", {
        reportId:"second_chat", accountAction:"warn",
        reason:"محاولة إعادة استخدام الإيصال", idempotencyKey:sharedKey,
      }), /idempotency_key_conflict/,
  );
  // Simulate a successful sanction whose separate report-resolution write
  // did not complete: a retry with the same account receipt must still fail.
  db.docs.delete("control_operations/" + sharedKey + "_resolution");
  await assert.rejects(
    () => generalReportsTestHooks.resolveWithAccountAction(
      db, {}, {sub:"admin"}, "admin", {
        reportId:"second_chat", accountAction:"warn",
        reason:"محاولة إعادة استخدام إيصال منفرد", idempotencyKey:sharedKey,
      }), /unverified_account_action/,
  );
  await assert.rejects(
    () => generalReportsTestHooks.reviewGeneralReport(db, "admin", {
      reportId:"second_chat", status:"actioned", reason:"إيصال غير مرتبط",
      idempotencyKey:"case_bound_resolution_123456",
    }, {
      actionKind:"warning", operationKey:sharedKey + "_account",
    }), /unverified_account_action/,
  );
  await assert.rejects(
    () => generalReportsTestHooks.reviewGeneralReport(db, "admin", {
      reportId:"second_chat", status:"under_review", reason:"تكرار المفتاح",
      idempotencyKey:"case_bound_review_123456",
    }), /idempotency_key_conflict/,
  );
  assert.equal(db.docs.get("reports/second_chat").status, "under_review");
  assert.equal(db.docs.get("users/target").warningCount, 1);
  assert.equal(db.docs.has("notifications/report_result_case_bound_resolution_123456"), false);
});

test("public account management cannot forge a report-bound receipt", () => {
  const source = fs.readFileSync("cloudflare-worker/src/manage-user-account.js", "utf8");
  assert.match(source, /hasOwnProperty\.call\(body, "linkedReportId"\)/);
  assert.match(source, /throw new ApiError\("invalid_request", 400\)/);
});

test("account moderation preserves long legacy diary-comment report IDs", async () => {
  const reportId = "diary_comment_" + "a".repeat(320);
  const db = new Db({
    "users/admin": {role:"owner",adminEnabled:true,accountStatus:"active"},
    "users/target": {role:"user",accountStatus:"active",warningCount:0},
  });
  await mutateAccount(db, {}, {sub:"admin"}, {
    targetUid:"target", accountAction:"warn", linkedReportId:reportId,
    reason:"تحذير بعد مراجعة تعليق", idempotencyKey:"long_diary_receipt_123456",
  });
  const receipt = db.docs.get("control_operations/long_diary_receipt_123456");
  assert.equal(receipt.result.linkedReportId, reportId);
  assert.equal(db.docs.get("users/target").warningCount, 1);
});


test("U5 account DM restriction is executed before the reporter sees its outcome", async () => {
  const db = new Db({
    ...cases(),
    "users/admin": {role:"owner",adminEnabled:true,accountStatus:"active"},
    "users/target": {role:"user",accountStatus:"active"},
  });
  await generalReportsTestHooks.reviewGeneralReport(db, "admin", {
    reportId:"legacy_chat", status:"under_review", reason:"مراجعة البلاغ",
    idempotencyKey:"u5_review_123456789",
  });
  const key = "u5_restrict_123456789";
  const action = {
    reportId:"legacy_chat", accountAction:"restrictPrivateMessages",
    durationMinutes: 60, reason:"مضايقات برسائل خاصة", idempotencyKey:key,
  };
  const result = await generalReportsTestHooks.resolveWithAccountAction(
    db, {}, {sub:"admin"}, "admin", action);
  assert.equal(result.status,"actioned");
  assert.equal(result.moderationAction,"private_messages_restricted");
  const target = db.docs.get("users/target");
  assert.ok(new Date(target.privateMessagesRestrictedUntil).getTime() > Date.now());
  assert.equal(target.accountStatus, "active");
  const receipt = db.docs.get("control_operations/" + key + "_account");
  assert.equal(receipt.result.action, "restrictPrivateMessages");
  assert.equal(receipt.result.linkedReportId, "legacy_chat");
  assert.equal(db.docs.get("notifications/report_result_" + key + "_resolution")
    .actionKind, "private_messages_restricted");
  assert.equal(db.docs.get("notifications/account_private_messages_" + key + "_account")
    .userId, "target");
  const repeated = await generalReportsTestHooks.resolveWithAccountAction(
    db, {}, {sub:"admin"}, "admin", action);
  assert.equal(repeated.code,"duplicate");
  assert.equal([...db.docs.keys()].filter(k =>
    k.startsWith("notifications/account_private_messages_" + key)).length,1);
  await assert.rejects(() => generalReportsTestHooks.reviewGeneralReport(
    new Db(cases()),"admin",{
      reportId:"room_1",status:"actioned",reason:"ادعاء إجراء",
      idempotencyKey:"u5_fake_receipt_12345",
    },{actionKind:"private_messages_restricted",operationKey:"u5_missing_12345678"}),
    /unverified_account_action/);
});

test("U5 restricted messages reject invalid durations and protected targets", async () => {
  const seed = {
    "users/admin": {role:"owner",adminEnabled:true,accountStatus:"active"},
    "users/target": {role:"user",accountStatus:"active"},
  };
  for(const durationMinutes of [0, 9, 43201, "infinity"]) {
    await assert.rejects(() => mutateAccount(new Db(seed), {}, {sub:"admin"}, {
      targetUid:"target",accountAction:"restrictPrivateMessages",
      durationMinutes,reason:"تقييد بسبب إساءة",
      idempotencyKey:"u5_invalid_duration_123456",
    }), /invalid_restriction_duration/);
  }
  const blockedOwner = new Db({...seed,"users/target":{role:"owner",accountStatus:"active"}});
  await assert.rejects(() => mutateAccount(blockedOwner, {}, {sub:"admin"}, {
    targetUid:"target",accountAction:"restrictPrivateMessages",
    durationMinutes:60,reason:"تقييد بسبب إساءة",
    idempotencyKey:"u5_protected_owner_123456",
  }), /owner_protected/);
  const denied = new Db({...seed,
    "users/admin":{role:"moderator",adminEnabled:true,capabilities:["reviewReports"]}});
  await assert.rejects(() => mutateAccount(denied, {}, {sub:"admin"}, {
    targetUid:"target",accountAction:"restrictPrivateMessages",
    durationMinutes:60,reason:"تقييد بسبب إساءة",
    idempotencyKey:"u5_no_permission_123456",
  }), /forbidden/);
});

test("U5 Firestore image write and DM previews enforce active server restriction", () => {
  const rules = fs.readFileSync("firestore.rules", "utf8");
  const worker = fs.readFileSync("cloudflare-worker/src/chat-safety-actions.js", "utf8");
  const ui = fs.readFileSync("lib/admin/general_reports_control_page.dart", "utf8");
  const client = fs.readFileSync("lib/features/chat/screens/private_chat_screen.dart", "utf8");
  assert.match(rules, /function privateMessagesAllowed\(\)/);
  assert.match(rules, /request\.time >= userDoc\(\)\.data\.privateMessagesRestrictedUntil/);
  assert.match(rules, /allow create: if conversationParticipant\(conversationId\)\s*&& privateMessagesAllowed\(\)/);
  assert.match(rules, /&& \(privateMessagesAllowed\(\)\s*\|\| request\.resource\.data\.diff/);
  assert.match(worker, /throw new ApiError\("private_messages_restricted", 403\)/);
  assert.match(ui, /'restrictPrivateMessages'/);
  assert.match(client, /case 'private_messages_restricted':/);
});


test("U5-B1 room chat restriction requires real account operation, protects owner, and notifies", async () => {
  const db = new Db({
    ...cases(),
    "users/admin": { role:"owner", adminEnabled:true, accountStatus:"active" },
    "users/target": { role:"user", accountStatus:"active" },
  });
  await generalReportsTestHooks.reviewGeneralReport(db, "admin", {
    reportId:"room_msg", status:"under_review",
    reason:"فحص رسالة الغرفة", idempotencyKey:"u5b_review_12345678",
  });
  const action = {
    reportId:"room_msg", accountAction:"restrictRoomChat",
    durationMinutes:60, reason:"إساءة متكررة بالغرف",
    idempotencyKey:"u5b_room_action_12345678",
  };
  const applied = await generalReportsTestHooks.resolveWithAccountAction(
    db, {}, {sub:"admin"}, "admin", action);
  assert.equal(applied.status,"actioned");
  assert.equal(applied.moderationAction,"room_chat_restricted");
  const user = db.docs.get("users/target");
  assert.ok(new Date(user.roomChatRestrictedUntil).getTime()>Date.now());
  assert.equal(user.accountStatus,"active");
  const receipt = db.docs.get("control_operations/u5b_room_action_12345678_account");
  assert.equal(receipt.result.linkedReportId,"room_msg");
  assert.equal(receipt.result.action,"restrictRoomChat");
  const reporterNote = db.docs.get("notifications/report_result_u5b_room_action_12345678_resolution");
  assert.equal(reporterNote.userId,"reporter");
  assert.equal(reporterNote.actionKind,"room_chat_restricted");
  assert.match(reporterNote.body,/الكتابة|كتابة/);
  const targetNote = db.docs.get("notifications/account_room_chat_u5b_room_action_12345678_account");
  assert.equal(targetNote.userId,"target");
  assert.match(targetNote.body,/الغرف/);
  assert.equal((await generalReportsTestHooks.resolveWithAccountAction(
    db, {}, {sub:"admin"}, "admin", action)).code,"duplicate");

  const denied = new Db({
    "users/admin": {role:"moderator",adminEnabled:true,capabilities:["reviewReports"],accountStatus:"active"},
    "users/target": {role:"user",accountStatus:"active"},
  });
  await assert.rejects(() => mutateAccount(denied, {}, {sub:"admin"}, {
    targetUid:"target", accountAction:"restrictRoomChat",
    durationMinutes:60, reason:"إساءة في غرفة",
    idempotencyKey:"u5b_cap_denied_12345678",
  }), /forbidden/);
  const owner = new Db({
    "users/admin": {role:"owner",adminEnabled:true,accountStatus:"active"},
    "users/target": {role:"owner",accountStatus:"active"},
  });
  await assert.rejects(() => mutateAccount(owner, {}, {sub:"admin"}, {
    targetUid:"target", accountAction:"restrictRoomChat",
    durationMinutes:60, reason:"إساءة في غرفة",
    idempotencyKey:"u5b_owner_denied_12345678",
  }), /owner_protected/);
});

test("U5-B1 restriction duration is validated and does not shorten an active sanction", async () => {
  const db = new Db({
    "users/admin": {role:"owner",adminEnabled:true,accountStatus:"active"},
    "users/target": {
      role:"user",accountStatus:"active",
      roomChatRestrictedUntil: new Date(Date.now()+120*60_000),
    },
  });
  for (const durationMinutes of [0, 9, -1, 43201]) {
    await assert.rejects(() => mutateAccount(db,{}, {sub:"admin"},{
      targetUid:"target",accountAction:"restrictRoomChat",
      durationMinutes,reason:"مراجعة إساءة",
      idempotencyKey:"u5b_invalid_duration_1234",
    }), /invalid_restriction_duration/);
  }
  const old = new Date(db.docs.get("users/target").roomChatRestrictedUntil).getTime();
  await mutateAccount(db,{}, {sub:"admin"},{
    targetUid:"target",accountAction:"restrictRoomChat",
    durationMinutes:60,reason:"مراجعة إساءة",
    idempotencyKey:"u5b_extend_only_1234567",
  });
  assert.equal(new Date(db.docs.get("users/target").roomChatRestrictedUntil).getTime(),old);
});


test("U5-B2 confirmed room-entry ban links the right report and notifies both users", async () => {
  const db=new Db({
    ...cases(),
    "users/admin":{role:"owner",adminEnabled:true,accountStatus:"active"},
    "users/target":{role:"user",accountStatus:"active"},
  });
  await generalReportsTestHooks.reviewGeneralReport(db,"admin",{
    reportId:"room_msg",status:"under_review",reason:"تحقق بلاغ الغرفة",
    idempotencyKey:"u5b2_review_12345678",
  });
  const action={
    reportId:"room_msg",accountAction:"restrictRoomEntry",
    durationMinutes:60,reason:"منع دخول الغرف بسبب مضايقات",
    idempotencyKey:"u5b2_entry_action_12345678",
  };
  const result=await generalReportsTestHooks.resolveWithAccountAction(
    db,{}, {sub:"admin"},"admin",action);
  assert.equal(result.status,"actioned");
  assert.equal(result.moderationAction,"room_entry_restricted");
  const user=db.docs.get("users/target");
  assert.equal(user.accountStatus,"active");
  assert.ok(new Date(user.roomEntryRestrictedUntil).getTime()>Date.now());
  const receipt=db.docs.get("control_operations/u5b2_entry_action_12345678_account");
  assert.equal(receipt.result.linkedReportId,"room_msg");
  assert.equal(receipt.result.action,"restrictRoomEntry");
  const complainant=db.docs.get("notifications/report_result_u5b2_entry_action_12345678_resolution");
  assert.equal(complainant.userId,"reporter");
  assert.equal(complainant.actionKind,"room_entry_restricted");
  const targetNotice=db.docs.get("notifications/account_room_entry_u5b2_entry_action_12345678_account");
  assert.equal(targetNotice.userId,"target");
  assert.match(targetNotice.body,/الغرف/);
  assert.equal((await generalReportsTestHooks.resolveWithAccountAction(
    db,{}, {sub:"admin"},"admin",action)).code,"duplicate");
});

test("U5-B2 invalid durations, owner targets and unauthorized moderators remain blocked", async () => {
  const seed={
    "users/admin":{role:"owner",adminEnabled:true,accountStatus:"active"},
    "users/target":{role:"user",accountStatus:"active",
      roomEntryRestrictedUntil:new Date(Date.now()+2*60*60_000)},
  };
  for (const minutes of [0,-1,9,43201]) {
    await assert.rejects(() => mutateAccount(new Db(seed),{}, {sub:"admin"},{
      targetUid:"target",accountAction:"restrictRoomEntry",
      durationMinutes:minutes,reason:"بلاغ عن إساءة",
      idempotencyKey:"u5b2_bad_duration_123456",
    }), /invalid_restriction_duration/);
  }
  const live=new Db(seed);
  const before=new Date(live.docs.get("users/target").roomEntryRestrictedUntil).getTime();
  await mutateAccount(live,{}, {sub:"admin"},{
    targetUid:"target",accountAction:"restrictRoomEntry",
    durationMinutes:60,reason:"بلاغ عن إساءة",
    idempotencyKey:"u5b2_keep_longer_123456",
  });
  assert.equal(new Date(live.docs.get("users/target").roomEntryRestrictedUntil).getTime(),before);
  await assert.rejects(() => mutateAccount(new Db({
    ...seed,"users/target":{role:"owner",accountStatus:"active"},
  }),{}, {sub:"admin"},{
    targetUid:"target",accountAction:"restrictRoomEntry",
    durationMinutes:60,reason:"بلاغ عن إساءة",
    idempotencyKey:"u5b2_owner_protected_1234",
  }), /owner_protected/);
  await assert.rejects(() => mutateAccount(new Db({
    ...seed,"users/admin":{role:"moderator",adminEnabled:true,capabilities:["reviewReports"]},
  }),{}, {sub:"admin"},{
    targetUid:"target",accountAction:"restrictRoomEntry",
    durationMinutes:60,reason:"بلاغ عن إساءة",
    idempotencyKey:"u5b2_reviewer_denied_123",
  }), /forbidden/);
});


test("U5-B3 lifts only the selected active restriction, not other sanctions", async () => {
  const now = Date.now();
  const future = new Date(now + 2 * 60 * 60_000);
  const db = new Db({
    "users/admin": { role: "owner", adminEnabled: true, accountStatus: "active" },
    "users/target": {
      role: "user", accountStatus: "active",
      privateMessagesRestrictedUntil: future,
      privateMessageRestrictionMinutes: 120,
      roomChatRestrictedUntil: future,
      roomChatRestrictionMinutes: 120,
      roomEntryRestrictedUntil: future,
      roomEntryRestrictionMinutes: 120,
    },
  });
  const items = [
    ["liftPrivateMessagesRestriction", "privateMessagesRestrictedUntil",
      "privateMessageRestrictionMinutes"],
    ["liftRoomChatRestriction", "roomChatRestrictedUntil", "roomChatRestrictionMinutes"],
    ["liftRoomEntryRestriction", "roomEntryRestrictedUntil", "roomEntryRestrictionMinutes"],
  ];
  for (let i = 0; i < items.length; i++) {
    const [action, until, minutes] = items[i];
    const key = "u5b3_lift_unique_" + String(i + 100);
    const result = await mutateAccount(db, {}, { sub: "admin" }, {
      targetUid: "target", accountAction: action,
      reason: "مراجعة قرار التقييد", idempotencyKey: key,
    });
    assert.equal(result.ok, true);
    assert.equal(result.liftedRestriction, until);
    assert.equal(db.docs.get("users/target")[until], null);
    assert.equal(db.docs.get("users/target")[minutes], null);
    assert.equal(db.docs.get("users/target").accountStatus, "active");
    const note = db.docs.get("notifications/account_restriction_lifted_" + key);
    assert.equal(note.userId, "target");
    assert.match(note.body, /تم رفع التقييد/);
    assert.equal(db.docs.get("control_operations/" + key).result.action, action);
    const repeat = await mutateAccount(db, {}, { sub: "admin" }, {
      targetUid: "target", accountAction: action,
      reason: "مراجعة قرار التقييد", idempotencyKey: key,
    });
    assert.equal(repeat.code, "duplicate");
    assert.equal([...db.docs.keys()].filter(id =>
      id === "notifications/account_restriction_lifted_" + key).length, 1);
    for (const [, otherField] of items.slice(i + 1)) {
      assert.equal(new Date(db.docs.get("users/target")[otherField]).getTime(),
        future.getTime());
    }
  }
  assert.equal(db.docs.get("users/target").warningCount, undefined);
});

test("U5-B3 refuses expired restrictions, protected owners and unauthorized staff", async () => {
  const active = new Date(Date.now() + 60_000);
  const seed = {
    "users/admin": {role: "owner", adminEnabled: true, accountStatus: "active"},
    "users/target": {
      role: "user", accountStatus: "active",
      roomEntryRestrictedUntil: active,
    },
  };
  const action = {
    targetUid: "target",
    accountAction: "liftRoomEntryRestriction",
    reason: "رفع بعد التدقيق", idempotencyKey: "u5b3_no_action_12345",
  };
  const expired = new Db({
    ...seed,
    "users/target": {
      role: "user", accountStatus: "active",
      roomEntryRestrictedUntil: new Date(Date.now() - 1000),
    },
  });
  await assert.rejects(() => mutateAccount(expired, {}, {sub:"admin"}, action),
    /restriction_not_active/);
  assert.equal(expired.docs.has("control_operations/" + action.idempotencyKey), false);
  const owner = new Db({...seed,
    "users/target": {...seed["users/target"], role:"owner"},
  });
  await assert.rejects(() => mutateAccount(owner, {}, {sub:"admin"}, action),
    /owner_protected/);
  const staff = new Db({...seed, "users/admin": {
    role:"moderator", adminEnabled:true, capabilities:["reviewReports"],
    accountStatus:"active",
  }});
  await assert.rejects(() => mutateAccount(staff, {}, {sub:"admin"}, action),
    /forbidden/);
  const crossAction = new Db(seed);
  const key = "u5b3_key_conflict_123456";
  await mutateAccount(crossAction, {}, {sub:"admin"}, {
    ...action, idempotencyKey:key,
  });
  await assert.rejects(() => mutateAccount(crossAction, {}, {sub:"admin"}, {
    ...action, idempotencyKey:key, accountAction:"liftRoomChatRestriction",
  }), /idempotency_key_conflict/);
});


test("U5-B4 account microphone restriction is verified by report, audited and reversible", async () => {
  const future = new Date(Date.now()+2*60*60_000);
  const db = new Db({
    ...cases(),
    "users/admin": {role:"owner",adminEnabled:true,accountStatus:"active"},
    "users/target": {
      role:"user",accountStatus:"active",
      roomEntryRestrictedUntil:future,
    },
  });
  await generalReportsTestHooks.reviewGeneralReport(db,"admin",{
    reportId:"room_msg",status:"under_review",reason:"مراجعة بلاغ صوتي",
    idempotencyKey:"u5b4_review_12345678",
  });
  const action={
    reportId:"room_msg",accountAction:"restrictRoomMic",
    durationMinutes:60,reason:"إساءة متكررة عبر الميكروفون",
    idempotencyKey:"u5b4_mic_action_12345678",
  };
  const result=await generalReportsTestHooks.resolveWithAccountAction(
    db,{}, {sub:"admin"}, "admin",action);
  assert.equal(result.status,"actioned");
  assert.equal(result.moderationAction,"room_mic_restricted");
  const record=db.docs.get("users/target");
  assert.ok(new Date(record.roomMicRestrictedUntil).getTime()>Date.now());
  assert.equal(new Date(record.roomEntryRestrictedUntil).getTime(),future.getTime());
  assert.equal(record.accountStatus,"active");
  const receipt=db.docs.get("control_operations/u5b4_mic_action_12345678_account");
  assert.equal(receipt.result.linkedReportId,"room_msg");
  assert.equal(receipt.result.action,"restrictRoomMic");
  const reporter=db.docs.get("notifications/report_result_u5b4_mic_action_12345678_resolution");
  assert.equal(reporter.actionKind,"room_mic_restricted");
  const target=db.docs.get("notifications/account_room_mic_u5b4_mic_action_12345678_account");
  assert.equal(target.userId,"target");
  assert.match(target.body,/المايكروفون/);
  assert.equal((await generalReportsTestHooks.resolveWithAccountAction(
    db,{}, {sub:"admin"}, "admin",action)).code,"duplicate");

  const lifted=await mutateAccount(db,{}, {sub:"admin"},{
    targetUid:"target",accountAction:"liftRoomMicRestriction",
    reason:"مراجعة الإدارة ورفع الكتم",
    idempotencyKey:"u5b4_mic_lift_12345678",
  });
  assert.equal(lifted.liftedRestriction,"roomMicRestrictedUntil");
  assert.equal(db.docs.get("users/target").roomMicRestrictedUntil,null);
  assert.equal(new Date(db.docs.get("users/target").roomEntryRestrictedUntil).getTime(),future.getTime());
  const liftedNotice=db.docs.get("notifications/account_restriction_lifted_u5b4_mic_lift_12345678");
  assert.equal(liftedNotice.userId,"target");
});

test("U5-B4 microphone sanctions protect owner, scope, duration, and idempotency", async () => {
  const seed = {
    "users/admin": {role:"owner",adminEnabled:true,accountStatus:"active"},
    "users/target": {role:"user",accountStatus:"active",
      roomMicRestrictedUntil:new Date(Date.now()+120*60_000)},
  };
  for (const durationMinutes of [0,9,43201]) {
    await assert.rejects(()=>mutateAccount(new Db(seed),{}, {sub:"admin"},{
      targetUid:"target", accountAction:"restrictRoomMic",
      durationMinutes,reason:"مخالفة صوتية",
      idempotencyKey:"u5b4_invalid_mic_123456",
    }),/invalid_restriction_duration/);
  }
  const extended=new Db(seed);
  const old=new Date(extended.docs.get("users/target").roomMicRestrictedUntil).getTime();
  await mutateAccount(extended,{}, {sub:"admin"},{
    targetUid:"target",accountAction:"restrictRoomMic",
    durationMinutes:60,reason:"إساءة على المايك",
    idempotencyKey:"u5b4_no_shorten_123456",
  });
  assert.equal(new Date(extended.docs.get("users/target").roomMicRestrictedUntil).getTime(),old);
  await assert.rejects(()=>mutateAccount(new Db({...seed,
    "users/target":{role:"owner",accountStatus:"active"},
  }),{}, {sub:"admin"},{
    targetUid:"target",accountAction:"restrictRoomMic",
    durationMinutes:60,reason:"إساءة على المايك",
    idempotencyKey:"u5b4_owner_mic_123456",
  }),/owner_protected/);
  await assert.rejects(()=>mutateAccount(new Db({...seed,
    "users/admin":{role:"moderator",adminEnabled:true,capabilities:["reviewReports"]},
  }),{}, {sub:"admin"},{
    targetUid:"target",accountAction:"restrictRoomMic",
    durationMinutes:60,reason:"إساءة على المايك",
    idempotencyKey:"u5b4_unprivileged_mic_123456",
  }),/forbidden/);
});


test("U6-A room evidence is visible and account reports retain accurate review titles", async () => {
  const seed={
    ...cases(),
    "reports/direct_account_u6a": {
      targetType:"user",source:"profile",reporterUid:"reporter",
      targetUid:"target",reason:"spam",status:"new",
      createdAt:new Date(8000),
    },
    "reports/verified_room_u6a": {
      targetType:"room",reporterUid:"reporter",targetUid:"owner",
      roomId:"room1",reason:"abuse",status:"new",
      evidence: {
        source:"verified_room_document",
        roomState:{
          name:"غرفة المثال",
          ownerUid:"owner",occupiedSeats:[{uid:"speaker",seatIndex:2,muted:false}],
        },
      },
      createdAt:new Date(9000),
    },
  };
  const db=new Db(seed);
  const room=await generalReportsTestHooks.getGeneralReport(
    db,{reportId:"verified_room_u6a"});
  assert.equal(room.item.evidence,undefined);
  assert.equal(room.item.hasSensitiveEvidence,true);

  await generalReportsTestHooks.reviewGeneralReport(db,"admin",{
    reportId:"direct_account_u6a",status:"under_review",
    reason:"مراجعة حساب",idempotencyKey:"u6a_account_review_123456",
  });
  const item=db.docs.get("admin_inbox_items/account_report__direct_account_u6a");
  assert.equal(item.title,"بلاغ مباشر عن حساب");
  assert.equal(item.meta.targetUid,"target");
});


test("U6-C nonpunitive report triage follows verified reasons and manual override", () => {
  assert.equal(reportPriority("room_report","scam"),"urgent");
  assert.equal(reportPriority("room_message_report","abuse"),"high");
  assert.equal(reportPriority("user_report","spam"),"normal");
  assert.equal(reportPriority("user_report","unexpected"),"normal");
  assert.equal(reportPriority("room_report","spam","urgent"),"urgent");
  assert.equal(reportPriority("room_report","scam","normal"),"normal");

  const normalized=generalReportsTestHooks.normalizeGeneralReport("triage_1",{
    targetType:"room", reason:"spam", priorityOverride:"urgent",
    priorityReason:"خطر مُثبت من المراجعة", priorityChangedBy:"admin",
  });
  assert.equal(normalized.priority,"urgent");
  assert.equal(normalized.priorityReason,"خطر مُثبت من المراجعة");
  assert.equal(normalized.priorityChangedBy,"admin");
});

test("U6-C bounded inbox sorts urgent then important then normal", async () => {
  const db=new Db({
    ...cases(),
    "reports/urgent_u6c":{targetType:"user",reporterUid:"reporter",
      targetUid:"target",reason:"scam",status:"new",createdAt:new Date(1000)},
  });
  const page=await generalReportsTestHooks.listGeneralReports(db,{limit:25});
  assert.equal(db.queryCalls,4);
  assert.deepEqual(page.items.map(item=>item.priority),
    ["urgent","high","high","normal"]);
  assert.equal(page.items[0].reportId,"urgent_u6c");
});

test("U6-C override updates only priority/inbox, audits reason and guards idempotency", async () => {
  const db=new Db(cases());
  const action={
    reportId:"room_1",priority:"urgent",
    reason:"بلاغ مؤكد الاستعجال",idempotencyKey:"u6c_priority_update_12345",
  };
  const response=await generalReportsTestHooks.setReportPriority(db,"admin",action);
  assert.equal(response.ok,true);
  assert.equal(response.priority,"urgent");
  const report=db.docs.get("reports/room_1");
  assert.equal(report.priorityOverride,"urgent");
  assert.equal(report.status,"under_review");
  assert.equal(report.priorityReason,action.reason);
  assert.equal(report.priorityChangedBy,"admin");
  const inbox=db.docs.get("admin_inbox_items/room_report__room_1");
  assert.equal(inbox.priority,"urgent");
  assert.equal(inbox.meta.targetUid,"owner");
  const audit=db.docs.get("admin_audit_logs/general_report_priority_"+action.idempotencyKey);
  assert.equal(audit.action,"setReportPriority");
  assert.equal(audit.before.priority,"normal");
  assert.equal(audit.after.priority,"urgent");
  const repeat=await generalReportsTestHooks.setReportPriority(db,"admin",action);
  assert.equal(repeat.code,"duplicate");
  await assert.rejects(()=>generalReportsTestHooks.setReportPriority(db,"admin",{
    ...action,priority:"normal",
  }),/idempotency_key_conflict/);
  await assert.rejects(()=>generalReportsTestHooks.setReportPriority(db,"admin",{
    ...action,reportId:"room_msg",
  }),/idempotency_key_conflict/);
  assert.equal(db.docs.get("reports/room_1").status,"under_review");
  assert.equal([...db.docs.keys()].filter(key=>key.startsWith("notifications/")).length,0);
});

test("U6-C rejects invalid priority and terminal cases without mutating records", async () => {
  const db=new Db({...cases(),"reports/closed_u6c":{
    targetType:"room",reporterUid:"reporter",roomId:"room1",
    status:"closed",reason:"spam",createdAt:new Date(),
  }});
  for(const priority of ["highest","", "high;ban"]) {
    await assert.rejects(()=>generalReportsTestHooks.setReportPriority(db,"admin",{
      reportId:"room_1",priority,reason:"مراجعة الإدارة",
      idempotencyKey:"u6c_invalid_priority_123",
    }),/invalid_report_priority/);
  }
  await assert.rejects(()=>generalReportsTestHooks.setReportPriority(db,"admin",{
    reportId:"closed_u6c",priority:"urgent",reason:"مراجعة الإدارة",
    idempotencyKey:"u6c_closed_priority_123",
  }),/invalid_report_transition/);
  await assert.rejects(()=>generalReportsTestHooks.setReportPriority(db,"admin",{
    reportId:"room_1",priority:"urgent",reason:"ا",
    idempotencyKey:"u6c_invalid_reason_123",
  }),/invalid_reason/);
  assert.equal(db.docs.get("reports/closed_u6c").priorityOverride,undefined);
});


test("U6-D reporter context samples exactly two bounded existing index queries without penalties", async () => {
  const db=new Db({
    ...cases(),
    "reports/modern_context_1":{
      targetType:"room",reporterUid:"reporter",reporterId:"reporter",
      targetUid:"owner",reason:"spam",status:"rejected",
      createdAt:new Date(10000),
    },
    "reports/modern_context_2":{
      targetType:"room",reporterUid:"reporter",targetUid:"owner",
      reason:"harassment",status:"actioned",createdAt:new Date(12000),
    },
    "reports/modern_context_3":{
      targetType:"room",reporterUid:"reporter",targetUid:"owner",
      reason:"spam",status:"closed",createdAt:new Date(13000),
    },
  });
  const result=await generalReportsTestHooks.getReporterContext(
    db,{reportId:"legacy_chat"});
  assert.equal(result.ok,true);
  assert.equal(result.nonPunitive,true);
  assert.equal(result.reporterUid,"reporter");
  assert.equal(db.queryCalls,2);
  // modern_context_1 has both old and new reporter fields, but is one case.
  assert.equal(result.sampled,7);
  assert.deepEqual(result.counts,{
    rejected:1,actioned:1,pending:4,other:1,
  });
  assert.equal(result.capped,false);
  assert.equal([...db.docs.keys()].filter(key=>
    key.startsWith("admin_audit_logs/")||key.startsWith("notifications/")).length,0);
});

test("U6-D sample caps, legacy reporter id and missing report protection", async () => {
  const rows={...cases()};
  for(let i=0;i<28;i++){
    rows["reports/u6d_sample_"+i]={
      targetType:"user",reporterUid:"reporter",targetUid:"target",
      status:i%2?"rejected":"open",reason:"spam",
      createdAt:new Date(1000+i),
    };
  }
  const db=new Db(rows);
  const report=await generalReportsTestHooks.getReporterContext(
    db,{reportId:"legacy_chat"});
  assert.equal(db.queryCalls,2);
  assert.equal(report.capped,true);
  assert.ok(report.sampled<=40);
  assert.ok(report.sampled>=21);
  await assert.rejects(()=>generalReportsTestHooks.getReporterContext(
    db,{reportId:"does_not_exist"}),/report_not_found/);
  const absent=new Db({
    "reports/no_reporter":{targetType:"room",roomId:"room1",status:"new"},
  });
  await assert.rejects(()=>generalReportsTestHooks.getReporterContext(
    absent,{reportId:"no_reporter"}),/reporter_unavailable/);
});


test("U6-E1 account history only confirms a completed action tied to the reviewed case", async () => {
  const db=new Db({
    "control_operations/u6e_case_a":{
      action:"restrictRoomMic",actorUid:"admin",targetType:"user",
      targetId:"target",status:"completed",createdAt:new Date(5000),
      result:{targetUid:"target",action:"restrictRoomMic",
        linkedReportId:"u6e_report",roomMicRestrictedUntil:new Date(9000)},
    },
    "admin_audit_logs/account_u6e_case_a":{
      reason:"إساءة مؤكدة",actorUid:"admin",targetId:"target",
      action:"restrictRoomMic",createdAt:new Date(5000),
    },
    "reports/u6e_report":{
      targetType:"room_message",targetUid:"target",
      reporterUid:"reporter",status:"actioned",
      moderationAction:"room_mic_restricted",reviewedBy:"admin",
      evidence:{message:{text:"SECRET_EVIDENCE",other:"PRIVATE"}},
    },
    "control_operations/u6e_manual_b":{
      action:"warn",actorUid:"admin",targetType:"user",targetId:"target",
      status:"completed",createdAt:new Date(3000),
      result:{targetUid:"target",action:"warn"},
    },
    "admin_audit_logs/account_u6e_manual_b":{
      action:"warn",reason:"تنبيه إداري دون بلاغ",
    },
    "control_operations/u6e_fake_c":{
      action:"ban",actorUid:"admin",targetType:"user",targetId:"target",
      status:"pending",createdAt:new Date(2000),
      result:{targetUid:"target",action:"ban",linkedReportId:"u6e_report"},
    },
    "control_operations/u6e_other_d":{
      action:"warn",actorUid:"admin",targetType:"user",targetId:"someone_else",
      status:"completed",result:{targetUid:"someone_else",action:"warn"},
    },
  });
  const result=await generalReportsTestHooks.getAccountActionHistory(
    db,{targetUid:"target"});
  assert.equal(db.queryCalls,1);
  assert.equal(result.items.length,2);
  const confirmed=result.items.find(item=>item.action==="restrictRoomMic");
  assert.equal(confirmed.caseVerified,true);
  assert.equal(confirmed.reportId,"u6e_report");
  assert.equal(confirmed.reportSource,"general");
  assert.equal(confirmed.reason,"إساءة مؤكدة");
  assert.equal(confirmed.expired,true);
  assert.equal(confirmed.hasCaseEvidence,true);
  const manual=result.items.find(item=>item.action==="warn");
  assert.equal(manual.caseVerified,false);
  assert.equal(manual.reportId,"");
  assert.equal(manual.reportSource,"");
  assert.equal(result.confirmedInPage,1);
  assert.equal(JSON.stringify(result).includes("SECRET_EVIDENCE"),false);
  assert.equal([...db.docs.keys()].filter(k=>k.startsWith("notifications/")).length,0);
});

test("U6-E1 never marks an unfinished, mismatched or rejected case as proven", async () => {
  const db=new Db({
    ...Object.fromEntries(["rejected","under_review","actioned"].map((status,i)=>[
      "control_operations/u6e_op_"+i,{
        action:"warn",actorUid:"admin",targetType:"user",targetId:"target",
        status:"completed",createdAt:new Date(1000+i),
        result:{targetUid:"target",action:"warn",linkedReportId:"u6e_case_"+i},
      },
    ])),
    "reports/u6e_case_0":{targetType:"user",targetUid:"target",
      status:"rejected",moderationAction:"warning",reviewedBy:"admin"},
    "reports/u6e_case_1":{targetType:"user",targetUid:"target",
      status:"under_review",moderationAction:"warning",reviewedBy:"admin"},
    "reports/u6e_case_2":{targetType:"user",targetUid:"other",
      status:"actioned",moderationAction:"warning",reviewedBy:"admin"},
  });
  const out=await generalReportsTestHooks.getAccountActionHistory(
    db,{targetUid:"target"});
  assert.equal(out.items.length,3);
  assert.equal(out.confirmedInPage,0);
  assert.ok(out.items.every(item=>item.caseVerified===false &&
    item.reportId===""));
});

test("U6-E1 history paging caps reads, advances cursor, rejects arbitrary paths", async () => {
  const docs={};
  for(let i=0;i<47;i++){
    const id="u6e_"+String(i).padStart(3,"0");
    docs["control_operations/"+id]={
      action:"warn",targetType:"user",targetId:"target",status:"completed",
      actorUid:"admin",result:{action:"warn",targetUid:"target"},
      createdAt:new Date(1000+i),
    };
    docs["admin_audit_logs/account_"+id]={reason:"مراجعة يدوية"};
  }
  const db=new Db(docs);
  let cursor, count=0, pages=0;
  do {
    const result=await generalReportsTestHooks.getAccountActionHistory(
      db,{targetUid:"target",...(cursor?{cursor}:{})});
    assert.ok(result.items.length<=20);
    assert.equal(result.pageSize,20);
    count+=result.items.length;pages++;
    cursor=result.nextCursor;
    if(!result.hasMore)break;
  }while(pages<5);
  assert.equal(count,47);
  assert.equal(pages,3);
  assert.equal(db.queryCalls,3);
  await assert.rejects(()=>generalReportsTestHooks.getAccountActionHistory(
    db,{targetUid:"other/account"}),/invalid_target_uid/);
  await assert.rejects(()=>generalReportsTestHooks.getAccountActionHistory(
    db,{targetUid:"target",cursor:"../users"}),/invalid_cursor/);
});


test("U6-E1 account history is restricted to authorized active moderators", async () => {
  const db=new Db({
    "users/owner":{role:"owner",adminEnabled:true,accountStatus:"active"},
    "users/reviewer":{role:"moderator",adminEnabled:true,
      accountStatus:"active",capabilities:["reviewReports"]},
    "users/viewer":{role:"moderator",adminEnabled:true,
      accountStatus:"active",capabilities:["viewReports"]},
    "users/no_access":{role:"moderator",adminEnabled:true,
      accountStatus:"active",capabilities:[]},
    "users/disabled":{role:"admin",adminEnabled:false,
      accountStatus:"active",capabilities:["viewReports"]},
    "users/suspended":{role:"admin",adminEnabled:true,
      accountStatus:"suspended",capabilities:["viewReports"]},
    "users/regular":{role:"user",accountStatus:"active"},
  });
  for (const sub of ["owner","reviewer","viewer"]) {
    const actor=await generalReportsTestHooks.requireAdmin(db,{sub});
    assert.equal(actor.uid,sub);
  }
  for (const sub of ["no_access","disabled","regular","suspended"]) {
    await assert.rejects(
      ()=>generalReportsTestHooks.requireAdmin(db,{sub}),
      /forbidden|unauthorized/,
    );
  }
});


test("U6-E3 account history includes only confirmed content moderation, not sensitive evidence", async () => {
  const key="u6e3_verified_comment_123";
  const recordId="history_diary_"+key;
  const db=new Db({
    ["control_operations/"+recordId]:{
      action:"moderatorDeleteDiaryComment",targetType:"user",
      targetId:"comment_writer",actorUid:"admin",status:"completed",
      createdAt:new Date(5000),
      result:{targetUid:"comment_writer",action:"moderatorDeleteDiaryComment",
        linkedReportId:"u6e3_report",sourceOperationId:key},
    },
    ["admin_audit_logs/diary_comment_delete_"+key]:{
      reason:"تم إثبات المخالفة وحذف التعليق",
    },
    "reports/u6e3_report":{
      targetType:"diary_comment",targetOwnerUid:"diary_owner",
      targetAuthorUid:"comment_writer",status:"actioned",
      moderationAction:"diary_comment_deleted",
      evidence:{originalText:"PRIVATE_TEXT_ONLY_FOR_REVIEW"},
    },
  });
  const out=await generalReportsTestHooks.getAccountActionHistory(
    db,{targetUid:"comment_writer"});
  assert.equal(db.queryCalls,1);
  assert.equal(out.items.length,1);
  assert.equal(out.confirmedInPage,1);
  assert.equal(out.items[0].caseVerified,true);
  assert.equal(out.items[0].reason,"تم إثبات المخالفة وحذف التعليق");
  assert.equal(out.items[0].reportId,"u6e3_report");
  assert.equal(out.items[0].reportSource,"diary");
  assert.equal(JSON.stringify(out).includes("PRIVATE_TEXT_ONLY_FOR_REVIEW"),false);
  const unrelated=await generalReportsTestHooks.getAccountActionHistory(
    db,{targetUid:"diary_owner"});
  assert.equal(unrelated.items.length,0);
});

test("U6-E3 history cursors accept safe prefixed 180-character operation keys", async () => {
  const key="x".repeat(180);
  const cursor="history_diary_"+key;
  const db=new Db({});
  const out=await generalReportsTestHooks.getAccountActionHistory(
    db,{targetUid:"writer",cursor});
  assert.equal(out.items.length,0);
  await assert.rejects(()=>generalReportsTestHooks.getAccountActionHistory(
    db,{targetUid:"writer",cursor:cursor+"/malicious"}),/invalid_cursor/);
});


test("U6-E6 verified restriction lift links original receipt and shows who lifted it", async () => {
  const db = new Db({
    "users/admin": {role:"owner",adminEnabled:true,accountStatus:"active"},
    "users/target": {role:"user",accountStatus:"active"},
  });
  const issueKey = "u6e6_mic_issue_123456";
  const liftKey = "u6e6_mic_lift_123456";
  await mutateAccount(db, {}, {sub:"admin"}, {
    targetUid:"target",accountAction:"restrictRoomMic",
    durationMinutes:60,reason:"مخالفة المايك الموثقة",idempotencyKey:issueKey,
  });
  assert.equal(db.docs.get("users/target").roomMicRestrictionOperationId, issueKey);
  const first = (await generalReportsTestHooks.getAccountActionHistory(
    db,{targetUid:"target"})).items.find(x=>x.operationId===issueKey);
  assert.equal(first.lifecycleState,"active");
  await mutateAccount(db, {}, {sub:"admin"}, {
    targetUid:"target",accountAction:"liftRoomMicRestriction",
    reason:"رفع القيد بعد المراجعة",idempotencyKey:liftKey,
  });
  assert.equal(db.docs.get("users/target").roomMicRestrictionOperationId,null);
  const original = db.docs.get("control_operations/"+issueKey);
  assert.equal(original.lifecycle.type,"lifted");
  assert.equal(original.lifecycle.operationId,liftKey);
  assert.equal(original.lifecycle.actorUid,"admin");
  assert.equal(original.lifecycle.reason,"رفع القيد بعد المراجعة");
  assert.equal(db.docs.get("control_operations/"+liftKey).result.originalOperationId,issueKey);
  const out = await generalReportsTestHooks.getAccountActionHistory(
    db,{targetUid:"target"});
  const originalView = out.items.find(x=>x.operationId===issueKey);
  const liftView = out.items.find(x=>x.operationId===liftKey);
  assert.equal(originalView.lifecycleState,"lifted");
  assert.equal(originalView.changedByUid,"admin");
  assert.equal(originalView.changedByOperationId,liftKey);
  assert.equal(liftView.originalOperationId,issueKey);
  assert.equal(liftView.lifecycleState,"lift_recorded");
  assert.equal(db.queryCalls,2);
  assert.equal(JSON.stringify(out).includes("notifications/"),false);
  const repeat = await mutateAccount(db, {}, {sub:"admin"}, {
    targetUid:"target",accountAction:"liftRoomMicRestriction",
    reason:"رفع القيد بعد المراجعة",idempotencyKey:liftKey,
  });
  assert.equal(repeat.code,"duplicate");
  assert.equal(db.docs.get("control_operations/"+issueKey).lifecycle.operationId,liftKey);
});

test("U6-E6 successive restrictions supersede only the provably active source", async () => {
  const db = new Db({
    "users/admin": {role:"owner",adminEnabled:true,accountStatus:"active"},
    "users/target": {role:"user",accountStatus:"active"},
  });
  const a="u6e6_chat_first_1234",b="u6e6_chat_second_1234";
  for(const [key,duration] of [[a,60],[b,120]]) {
    await mutateAccount(db,{}, {sub:"admin"}, {
      targetUid:"target",accountAction:"restrictRoomChat",
      durationMinutes:duration,reason:"مراجعة واقعة محققة",idempotencyKey:key,
    });
  }
  assert.equal(db.docs.get("users/target").roomChatRestrictionOperationId,b);
  const before = db.docs.get("control_operations/"+a);
  assert.equal(before.lifecycle.type,"replaced");
  assert.equal(before.lifecycle.operationId,b);
  const after = (await generalReportsTestHooks.getAccountActionHistory(
    db,{targetUid:"target"})).items;
  assert.equal(after.find(x=>x.operationId===a).lifecycleState,"replaced");
  assert.equal(after.find(x=>x.operationId===b).lifecycleState,"active");
});

test("U6-E6 legacy or contradictory origin is never inferred for a lift", async () => {
  const future = new Date(Date.now()+60*60_000);
  const db = new Db({
    "users/admin": {role:"owner",adminEnabled:true,accountStatus:"active"},
    "users/target": {role:"user",accountStatus:"active",
      roomEntryRestrictedUntil:future},
    "control_operations/u6e6_old_unverified_123":{
      action:"restrictRoomEntry",targetType:"user",targetId:"target",
      actorUid:"admin",status:"completed",
      result:{action:"restrictRoomEntry",targetUid:"target",
        roomEntryRestrictedUntil:future},
      createdAt:new Date(Date.now()-1000),
    },
  });
  const liftKey = "u6e6_unlinked_lift_123";
  await mutateAccount(db,{}, {sub:"admin"}, {
    targetUid:"target",accountAction:"liftRoomEntryRestriction",
    reason:"رفع التقييد بعد المراجعة",idempotencyKey:liftKey,
  });
  assert.equal(db.docs.get("control_operations/"+liftKey).result.originalOperationId,undefined);
  assert.equal(db.docs.get("control_operations/u6e6_old_unverified_123").lifecycle,undefined);
  const items = (await generalReportsTestHooks.getAccountActionHistory(
    db,{targetUid:"target"})).items;
  assert.equal(items.find(x=>x.operationId==="u6e6_old_unverified_123")
    .lifecycleState,"unknown");
  assert.equal(items.find(x=>x.operationId===liftKey).originalOperationId,"");
});

test("U6-E6 time expiration and permanent ban remain distinct from an admin lift", async () => {
  const past=new Date(Date.now()-10_000);
  const db = new Db({
    "users/admin": {role:"owner",adminEnabled:true,accountStatus:"active"},
    "users/target": {role:"user",accountStatus:"active"},
    "control_operations/u6e6_expired_receipt":{
      action:"suspend",actorUid:"admin",targetType:"user",
      targetId:"target",status:"completed",createdAt:new Date(Date.now()-90_000),
      result:{targetUid:"target",action:"suspend",accountStatus:"suspended",suspendedUntil:past},
    },
  });
  let view=(await generalReportsTestHooks.getAccountActionHistory(
    db,{targetUid:"target"})).items.find(x=>x.operationId==="u6e6_expired_receipt");
  assert.equal(view.lifecycleState,"expired");
  assert.equal(view.expired,true);
  const banKey="u6e6_ban_forever_1234",releaseKey="u6e6_ban_release_1234";
  await mutateAccount(db,{}, {sub:"admin"}, {
    targetUid:"target",accountAction:"ban",reason:"قرار حظر إداري موثق",idempotencyKey:banKey,
  });
  view=(await generalReportsTestHooks.getAccountActionHistory(
    db,{targetUid:"target"})).items.find(x=>x.operationId===banKey);
  assert.equal(view.lifecycleState,"permanent");
  assert.equal(view.permanentSanction,true);
  // An unrelated earlier expiration must never be confused with a lift.
  assert.equal(view.originalOperationId,"");
  assert.equal(db.docs.get("control_operations/"+banKey).lifecycle,undefined);
});

test("U6-E6 history does not guess permanent legacy state or leak private proof", async () => {
  const db=new Db({
    "users/target":{accountStatus:"active"},
    "control_operations/u6e6_legacy_ban_123":{
      action:"ban",actorUid:"admin",targetId:"target",targetType:"user",
      status:"completed",createdAt:new Date(1000),
      result:{targetUid:"target",action:"ban",accountStatus:"banned",
        privateEvidence:"SECRET_NOT_ALLOWED"},
    },
    "admin_audit_logs/account_u6e6_legacy_ban_123":{
      reason:"قرار قديم",evidence:"PRIVATE_EVIDENCE",
    },
  });
  const out=await generalReportsTestHooks.getAccountActionHistory(
    db,{targetUid:"target"});
  assert.equal(out.items[0].lifecycleState,"unknown");
  assert.equal(out.items[0].permanentSanction,true);
  assert.equal(JSON.stringify(out).includes("PRIVATE_EVIDENCE"),false);
  assert.equal(JSON.stringify(out).includes("SECRET_NOT_ALLOWED"),false);
  assert.equal(db.queryCalls,1);
});

test("U6-E7 sensitive report evidence requires its own granted capability and is always audited", async () => {
  const db=new Db({
    ...cases(),
    "users/owner":{role:"owner",adminEnabled:true,accountStatus:"active"},
    "users/reviewer":{role:"moderator",adminEnabled:true,accountStatus:"active",capabilities:["reviewReports"]},
    "users/viewer":{role:"moderator",adminEnabled:true,accountStatus:"active",capabilities:["viewReports"]},
    "users/evidence_only":{role:"moderator",adminEnabled:true,accountStatus:"active",capabilities:["viewReportEvidence"]},
    "users/authorized":{role:"moderator",adminEnabled:true,accountStatus:"active",capabilities:["viewReports","viewReportEvidence"]},
  });
  const list=await generalReportsTestHooks.listGeneralReports(db,{limit:20});
  const details=await generalReportsTestHooks.getGeneralReport(db,{reportId:"room_msg"});
  const history=await generalReportsTestHooks.listReportHistory(db,{type:"room_message_report"});
  for(const page of [list, details, history]) {
    assert.equal(JSON.stringify(page).includes('"evidence"'),false);
    assert.equal(JSON.stringify(page).includes('"text":"bad"'),false);
  }
  const open=(actor,reportId="room_msg")=>
    generalReportsTestHooks.openGeneralSensitiveEvidence(db,actor,{reportId});
  for(const uid of ["viewer","reviewer"]) {
    const actor=await generalReportsTestHooks.requireAdmin(db,{sub:uid});
    assert.equal(actor.canViewSensitiveEvidence,false);
    await assert.rejects(()=>open(actor),/forbidden_evidence/);
  }
  await assert.rejects(()=>generalReportsTestHooks.requireAdmin(
    db,{sub:"evidence_only"}),/forbidden/);
  const granted=await generalReportsTestHooks.requireAdmin(db,{sub:"authorized"});
  assert.equal(granted.canViewSensitiveEvidence,true);
  const opened=await open(granted);
  assert.equal(opened.evidence.message.text,"bad");
  assert.equal(opened.reportId,"room_msg");
  const owner=await generalReportsTestHooks.requireAdmin(db,{sub:"owner"});
  assert.equal(owner.canViewSensitiveEvidence,true);
  await open(owner);
  const audit=[...db.docs.entries()].filter(([k])=>
    k.startsWith("admin_audit_logs/report_evidence_open_"));
  assert.equal(audit.length,2);
  assert.deepEqual(new Set(audit.map(([,v])=>v.actorUid)),
    new Set(["owner","authorized"]));
  for(const [,v] of audit) {
    assert.equal(v.action,"openSensitiveReportEvidence");
    assert.equal(v.sourceCollection,"reports");
    assert.equal(v.reportId,"room_msg");
    assert.equal(JSON.stringify(v).includes('"bad"'),false);
  }
  await assert.rejects(()=>open(granted,"../room_msg"),/invalid_report_id/);
  await assert.rejects(()=>open(granted,"diary_1"),/report_not_found/);
  assert.equal([...db.docs.keys()].filter(k=>
    k.startsWith("admin_audit_logs/report_evidence_open_")).length,2);
});

test("U6-E7 failure to write the audit fails closed before revealing evidence", async () => {
  const db=new Db(cases());
  db.commit=async()=>{throw new Error("audit_unavailable")};
  await assert.rejects(
    ()=>generalReportsTestHooks.openGeneralSensitiveEvidence(
      db,{uid:"owner",canViewSensitiveEvidence:true},{reportId:"room_msg"}),
    /audit_unavailable/,
  );
  assert.equal([...db.docs.keys()].some(k=>k.startsWith(
    "admin_audit_logs/report_evidence_open_")),false);
});

test("U6-E7 new evidence permission is owner-grantable but never bundled with ordinary review", () => {
  const granted=manageUserAccessInternals.normalizeCapabilities(
    ["viewReports","viewReportEvidence"]);
  assert.deepEqual(granted,["viewReportEvidence","viewReports"]);
  assert.deepEqual(manageUserAccessInternals.normalizeCapabilities(
    ["viewReports","reviewReports"]),["reviewReports","viewReports"]);
  assert.throws(()=>manageUserAccessInternals.normalizeCapabilities(
    ["viewSensitiveEverything"]),/invalid_capability/);
  const roles=fs.readFileSync("lib/admin/user_access_control_card.dart","utf8");
  assert.match(roles,/فتح أدلة البلاغات الحساسة/);
  assert.match(roles,/viewReportEvidence/);
  const controls=fs.readFileSync("cloudflare-worker/src/general-reports.js","utf8");
  assert.match(controls,/action === "openSensitiveEvidence"/);
  const diary=fs.readFileSync("cloudflare-worker/src/diary-moderation.js","utf8");
  assert.match(diary,/action === "openSensitiveEvidence"/);
});
