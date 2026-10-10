import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { generalReportsTestHooks, generalReportType } from "../../cloudflare-worker/src/general-reports.js";
import { adminInboxTestHooks } from "../../cloudflare-worker/src/admin-inbox.js";

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
    )).slice(0, options.limit || 100);
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
  assert.equal(db.queryCalls,3);
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

test("review changes are idempotent, guarded and audit-logged", async () => {
  const db = new Db(cases());
  const call = (status,key) => generalReportsTestHooks.reviewGeneralReport(
    db,"admin",{reportId:"legacy_chat",status,
      reason:"قرار إشرافي واضح",idempotencyKey:key});
  await assert.rejects(() => call("actioned","invalid_step_123456"),
    /invalid_report_transition/);
  const updated = await call("under_review","review_case_1234567");
  assert.equal(updated.status,"under_review");
  assert.equal(db.docs.get("reports/legacy_chat").reviewedBy,"admin");
  assert.equal(db.docs.get("admin_inbox_items/user_report__legacy_chat").meta.status,
    "under_review");
  assert.equal(db.docs.has("admin_audit_logs/general_report_review_case_1234567"),
    true);
  const repeated = await call("under_review","review_case_1234567");
  assert.equal(repeated.code,"duplicate");
  await call("rejected","reject_case_1234567");
  assert.equal(db.docs.get("reports/legacy_chat").status,"rejected");
  assert.equal(db.docs.has("admin_inbox_items/user_report__legacy_chat"),false);
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
