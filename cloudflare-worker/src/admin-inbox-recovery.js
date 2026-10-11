import {
  ADMIN_INBOX_INDEX_COLLECTION,
  adminInboxIndexPath,
  adminInboxLegacyIndexPath,
  adminInboxUpsertWrite,
} from "./admin-inbox-index.js";

// This is an OWNER-initiated administrative repair, never a background scan.
// One user action reads at most 13 report rows and processes at most 12.
// Progress and the matching writes are committed in the same transaction.
const META_PATH = ADMIN_INBOX_INDEX_COLLECTION + "/__meta";
const PAGE_SIZE = 12;
const ACTIVE = new Set(["new", "under_review"]);
const clean = (value) => String(value ?? "").trim();

function reportCreatedAt(data = {}) {
  const ms = Number(data.createdAtMs || 0);
  if (Number.isSafeInteger(ms) && ms > 0) return new Date(ms);
  const value = data.createdAt;
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  const seconds = Number(value?.seconds ?? value?._seconds ?? 0);
  if (Number.isFinite(seconds) && seconds > 0) return new Date(seconds * 1000);
  const parsed = Date.parse(String(value ?? ""));
  return new Date(Number.isFinite(parsed) ? parsed : 0);
}

function eligibleLegacyReport(id, data = {}) {
  return id.length > 160 &&
    id.length <= 512 &&
    /^[A-Za-z0-9_-]+$/.test(id) &&
    clean(data.targetType) === "diary_comment";
}

export async function recoverLongDiaryAlertsPage(db) {
  const transaction = await db.beginTransaction();
  try {
    const snapshot = await db.get(META_PATH, transaction);
    const meta = snapshot.data || {};
    if (!snapshot.exists || Number(meta.schemaVersion || 0) < 2) {
      await db.rollback(transaction);
      return { ok: false, code: "inbox_index_not_ready" };
    }
    if (meta.diaryLongRepairDone === true) {
      await db.rollback(transaction);
      return {
        ok: true,
        done: true,
        processed: Number(meta.diaryLongRepairProcessed || 0),
        reindexed: Number(meta.diaryLongRepairReindexed || 0),
        pageSize: 0,
      };
    }

    const cursor = clean(meta.diaryLongRepairCursor);
    // The document-name cursor is server-stored only; validate before using
    // it in a reference path. No user-supplied cursor and no unrestricted scan.
    if (cursor && (!/^[A-Za-z0-9_-]{1,512}$/.test(cursor))) {
      throw new Error("invalid_saved_repair_cursor");
    }
    const rows = await db.runQuery("diary_reports", {
      orderBy: [{ field: "__name__", direction: "asc" }],
      limit: PAGE_SIZE + 1,
      startAfter: cursor
        ? [{ referencePath: "diary_reports/" + cursor }]
        : [],
      transaction,
    });
    const selected = rows.slice(0, PAGE_SIZE);
    const hasMore = rows.length > PAGE_SIZE;
    const writes = [];
    let reindexed = 0;

    for (const row of selected) {
      const id = clean(row?.id);
      const data = row?.data || {};
      if (!eligibleLegacyReport(id, data)) continue;
      const fullPath = adminInboxIndexPath("diary_report", id);
      const oldPath = adminInboxLegacyIndexPath("diary_report", id);
      const oldIndex = oldPath !== fullPath
        ? await db.get(oldPath, transaction)
        : null;
      const ownsOldIndex = oldIndex?.exists === true &&
        clean(oldIndex.data?.targetId) === id;

      if (ACTIVE.has(clean(data.status || "new"))) {
        writes.push(adminInboxUpsertWrite(db, {
          type: "diary_report",
          title: "بلاغ على تعليق يومية",
          body: clean(data.reasonLabel || data.reason) || "بلاغ محتوى",
          targetId: id,
          route: "diary_reports",
          createdAt: reportCreatedAt(data),
          priority: "high",
          meta: {
            diaryId: clean(data.diaryId) || null,
            commentId: clean(data.commentId) || null,
            reporterUid: clean(data.reporterUid) || null,
            targetUid: clean(data.targetAuthorUid) || null,
            ownerUid: clean(data.targetOwnerUid) || null,
            status: clean(data.status || "new"),
          },
        }));
        reindexed += 1;
      } else {
        // Never resurrect already rejected/actioned/closed complaints.
        writes.push(db.writeDelete(fullPath));
      }
      // A legacy path may belong to another reporter. Only remove it when
      // its stored full target ID proves that this report owned the row.
      if (ownsOldIndex) writes.push(db.writeDelete(oldPath));
    }

    const processed = Math.max(0, Number(meta.diaryLongRepairProcessed || 0)) +
      selected.length;
    const totalReindexed = Math.max(0, Number(meta.diaryLongRepairReindexed || 0)) +
      reindexed;
    const updatedAt = new Date();
    const fields = {
      diaryLongRepairCursor: hasMore && selected.length
        ? clean(selected[selected.length - 1].id)
        : "",
      diaryLongRepairDone: !hasMore,
      diaryLongRepairProcessed: processed,
      diaryLongRepairReindexed: totalReindexed,
      diaryLongRepairUpdatedAt: updatedAt,
    };
    writes.push(db.writeUpdate(META_PATH, fields, Object.keys(fields)));
    await db.commit(transaction, writes);
    return {
      ok: true,
      done: !hasMore,
      processed,
      reindexed: totalReindexed,
      pageSize: selected.length,
      repairedThisPage: reindexed,
    };
  } catch (error) {
    await db.rollback(transaction);
    throw error;
  }
}

export function longDiaryAlertRecoveryStatus(meta = {}, owner = false) {
  return {
    available: owner && Number(meta.schemaVersion || 0) >= 2,
    done: meta.diaryLongRepairDone === true,
    processed: Math.max(0, Number(meta.diaryLongRepairProcessed || 0)),
    reindexed: Math.max(0, Number(meta.diaryLongRepairReindexed || 0)),
  };
}
