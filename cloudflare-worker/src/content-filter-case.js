import { adminInboxUpsertWrite } from "./admin-inbox-index.js";

// An actor-scoped, 24-hour review hint; it is NEVER a proven offence.
// One point read and one point write per *flagged event*, with no queries,
// listeners or client-visible sensitive content in the aggregated record.
export const FILTER_CASE_WINDOW_MS = 86_400_000;
export const FILTER_CASE_RECENT_MAX = 12;
const ID = /^[A-Za-z0-9_-]{1,180}$/;
const clean = (v) => String(v ?? "").trim();

export function filterCaseTier(count) {
  return count >= 10 ? 3 : count >= 6 ? 2 : count >= 3 ? 1 : 0;
}
export function filterCasePriority(tier) {
  return tier >= 3 ? "urgent" : tier >= 2 ? "high" : "normal";
}
export function nextFilterCase(previous = {}, {
  actorUid, sourceId, surface, createdAtMs = Date.now(),
}) {
  if (!ID.test(actorUid) || !ID.test(sourceId) ||
      !["private_chat", "diary_post", "diary_comment", "room_chat"].includes(surface) ||
      !Number.isFinite(createdAtMs) || createdAtMs <= 0) {
    throw Error("invalid_filter_case_event");
  }
  const oldStart = Number(previous.windowStartMs || 0);
  const sameWindow = oldStart > 0 && createdAtMs >= oldStart &&
    createdAtMs - oldStart < FILTER_CASE_WINDOW_MS;
  const count = (sameWindow ? Math.max(0,Number(previous.count||0)) : 0) + 1;
  const tier = filterCaseTier(count);
  const notifiedTier = sameWindow ?
    Math.max(0, Number(previous.notifiedTier || 0)) : 0;
  const ref = surface === "room_chat" ? "room_" + sourceId : "saved_" + sourceId;
  const recent = sameWindow && Array.isArray(previous.recentFlagIds)
    ? previous.recentFlagIds.filter(v => typeof v === "string").slice(-11) : [];
  // The immutable original stays in the independent private flag record.
  const result = {
    actorUid, windowStartMs: sameWindow ? oldStart : createdAtMs,
    lastSeenAtMs: createdAtMs, count, tier,
    notifiedTier: Math.max(notifiedTier,tier),
    recentFlagIds: [...recent,ref].slice(-FILTER_CASE_RECENT_MAX),
    evidenceIsAllegation: true, verifiedOffences: 0,
  };
  return { caseData: result, escalated: tier > notifiedTier,
    alertTier: tier > notifiedTier ? tier : 0 };
}

export async function filterCaseWrites(db, transaction, event) {
  const uid = clean(event.actorUid);
  if (!ID.test(uid)) throw Error("invalid_filter_case_actor");
  const docPath = "content_filter_cases/" + uid;
  const snap = await db.get(docPath,transaction);
  const createdAtMs = Number(event.createdAtMs || Date.now());
  const {caseData,escalated,alertTier} = nextFilterCase(snap.data || {}, {
    ...event, actorUid:uid, createdAtMs,
  });
  const now = new Date(createdAtMs);
  const writes = [
    db.writeUpdate(docPath, { ...caseData, updatedAt:now,
      createdAt:snap.data?.createdAt || now }),
  ];
  if (escalated) {
    writes.push(adminInboxUpsertWrite(db, {
      type:"system_filter_case",
      title:"تنبيهات كلمات متكررة — مراجعة مطلوبة",
      body:"تنبيهات متعددة لنفس الحساب، من دون إدانة أو عقوبة تلقائية.",
      targetId:uid, route:"general_reports",
      priority:filterCasePriority(alertTier),
      createdAt:now,
      meta:{ actorUid:uid, count:caseData.count, tier:alertTier,
        caseType:"content_filter", alleged:true },
    }));
  }
  return { writes, escalated, caseData };
}

// Room coordinator invokes the same transactional updater once per
// committed room flag. It cannot receive private original text.
export async function commitRoomFilterCase(db,event) {
  const tx = await db.beginTransaction();
  try {
    const marker = "content_filter_case_events/" + clean(event.sourceId);
    if (!ID.test(clean(event.sourceId))) throw Error("invalid_filter_case_event");
    const previous = await db.get(marker,tx);
    if (previous.exists) {
      await db.rollback(tx);
      return {ok:true,duplicate:true};
    }
    const result = await filterCaseWrites(db,tx,event);
    await db.commit(tx,[
      ...result.writes,
      db.writeCreate(marker, {
        actorUid:event.actorUid, sourceId:event.sourceId,
        surface:"room_chat", createdAt:new Date(event.createdAtMs),
        expireAt:new Date(event.createdAtMs + 90 * FILTER_CASE_WINDOW_MS),
      }),
    ]);
    return {ok:true,escalated:result.escalated};
  } catch(error) {
    await db.rollback(tx).catch(()=>{});
    throw error;
  }
}

// The room coordinator has a bounded 1000-slot evidence ring. Its
// idempotency receipts are purged after 90 days, with no unbounded scan.
export async function cleanupOldRoomFilterCaseMarkers(db, nowMs = Date.now(),
  limit = 20) {
  const bound = Math.max(1, Math.min(20, Math.trunc(limit || 20)));
  const rows = await db.runQuery("content_filter_case_events", {
    filters:[{field:"expireAt",op:"<=",value:new Date(nowMs)}],
    orderBy:[{field:"expireAt",direction:"asc"}],
    limit:bound,
  });
  let deleted = 0;
  for(const row of rows) {
    if(!ID.test(String(row.id||""))) continue;
    await db.commit(null,[db.writeDelete("content_filter_case_events/"+row.id)]);
    deleted++;
  }
  return {checked:rows.length,deleted};
}
