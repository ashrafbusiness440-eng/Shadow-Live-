import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { generalReportsTestHooks, generalReportType } from "../../cloudflare-worker/src/general-reports.js";
import { adminInboxTestHooks } from "../../cloudflare-worker/src/admin-inbox.js";
import { mutateAccount } from "../../cloudflare-worker/src/manage-user-account.js";

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
  assert.equal(out.items[1].evidence.message.text,"bad");
  assert.equal(out.items[2].targetProfile.displayName,"صاحب الغرفة");
  const detail = await generalReportsTestHooks.getGeneralReport(db,{reportId:"room_msg"});
  assert.equal(detail.item.evidence.context.length,1);
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
      }), /idempotency_key_conflict/,
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
