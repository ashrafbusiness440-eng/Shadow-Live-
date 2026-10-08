import {
  applyMysteriousIdentityPresentation,
} from "./mysterious-identity.js";

const clean = (value) => String(value ?? "").trim();
const UID_PATTERN = /^[A-Za-z0-9_-]{1,180}$/;
const MAX_PAGE_SIZE = 20;
const MAX_RESULTS = 100;

function safePoints(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function safeSnapshot(raw = {}) {
  return {
    displayName: clean(
      raw.displayName || raw.username || raw.name || "مستخدم Shadow Live",
    ),
    profileImageUrl: clean(raw.profileImageUrl),
    publicId: clean(raw.publicId),
  };
}

export function userLevelSupportAggregateWrites(
  db,
  {
    senderUid,
    receiverUid,
    sender = {},
    receiver = {},
    wealthPoints = 0,
    attractionPoints = 0,
    giftCount = 1,
    now = new Date(),
  } = {},
) {
  const senderId = clean(senderUid);
  const receiverId = clean(receiverUid);
  if (!UID_PATTERN.test(senderId) || !UID_PATTERN.test(receiverId)) return [];

  const wealth = safePoints(wealthPoints);
  const attraction = safePoints(attractionPoints);
  const count = Math.max(1, Number(giftCount || 1));
  const writes = [];
  const senderSnapshot = safeSnapshot(sender);
  const receiverSnapshot = safeSnapshot(receiver);

  if (wealth > 0) {
    writes.push(
      db.writeUpdate(
        `user_level_support/${senderId}/wealth/${receiverId}`,
        {
          counterpartUid: receiverId,
          ...receiverSnapshot,
          updatedAt: now,
        },
        [
          "counterpartUid",
          "displayName",
          "profileImageUrl",
          "publicId",
          "updatedAt",
        ],
        [
          db.increment("points", wealth),
          db.increment("giftCount", count),
        ],
      ),
    );
  }

  if (attraction > 0) {
    writes.push(
      db.writeUpdate(
        `user_level_support/${receiverId}/attraction/${senderId}`,
        {
          counterpartUid: senderId,
          ...senderSnapshot,
          updatedAt: now,
        },
        [
          "counterpartUid",
          "displayName",
          "profileImageUrl",
          "publicId",
          "updatedAt",
        ],
        [
          db.increment("points", attraction),
          db.increment("giftCount", count),
        ],
      ),
    );
  }
  return writes;
}

function decodeCursor(raw) {
  const value = clean(raw);
  if (!value) return { loaded: 0, points: null, uid: "" };
  const parts = value.split(".");
  if (parts.length !== 3) return { loaded: 0, points: null, uid: "" };
  const loaded = Number(parts[0]);
  const points = Number(parts[1]);
  const uid = parts[2];
  if (
    !Number.isSafeInteger(loaded) ||
    loaded < 0 ||
    loaded > MAX_RESULTS ||
    !Number.isSafeInteger(points) ||
    points < 0 ||
    !UID_PATTERN.test(uid)
  ) {
    return { loaded: 0, points: null, uid: "" };
  }
  return { loaded, points, uid };
}

function encodeCursor(loaded, points, uid) {
  return `${loaded}.${safePoints(points)}.${clean(uid)}`;
}

export async function loadUserLevelSupportPage(
  db,
  targetUid,
  metric,
  { cursor = "", limit = MAX_PAGE_SIZE, nowMs = Date.now() } = {},
) {
  const uid = clean(targetUid);
  const normalizedMetric = clean(metric);
  if (
    !UID_PATTERN.test(uid) ||
    !["wealth", "attraction"].includes(normalizedMetric)
  ) {
    throw new Error("invalid_support_metric");
  }

  const decoded = decodeCursor(cursor);
  if (cursor && decoded.points === null) throw new Error("invalid_cursor");
  if (decoded.loaded >= MAX_RESULTS) {
    return { metric: normalizedMetric, items: [], nextCursor: null, totalCap: MAX_RESULTS };
  }

  const pageSize = Math.max(
    1,
    Math.min(
      MAX_PAGE_SIZE,
      Number(limit || MAX_PAGE_SIZE),
      MAX_RESULTS - decoded.loaded,
    ),
  );
  const collectionPath = `user_level_support/${uid}/${normalizedMetric}`;
  const rows = await db.runQuery(collectionPath, {
    orderBy: [
      { field: "points", direction: "desc" },
      { field: "__name__", direction: "asc" },
    ],
    limit: pageSize + 1,
    startAfter: decoded.points === null
      ? []
      : [
          decoded.points,
          { referencePath: `${collectionPath}/${decoded.uid}` },
        ],
  });

  const pageRows = rows.slice(0, pageSize);
  const counterpartUids = pageRows
    .map((row) => clean(row.data?.counterpartUid || row.id))
    .filter((id) => UID_PATTERN.test(id));

  // One bounded Firestore batch for the current identity of max 20 rows.
  const currentUsers = await db.getMany(
    counterpartUids.map((counterpartUid) => `users/${counterpartUid}`),
  );
  const byUid = new Map();
  counterpartUids.forEach((counterpartUid, index) => {
    if (currentUsers[index]?.exists) {
      byUid.set(counterpartUid, currentUsers[index].data || {});
    }
  });

  const items = pageRows.map((row, index) => {
    const data = row.data || {};
    const counterpartUid = clean(data.counterpartUid || row.id);
    const currentUser = byUid.get(counterpartUid) || {};
    const presentation = applyMysteriousIdentityPresentation(
      {
        uid: counterpartUid,
        displayName: clean(
          currentUser.displayName ||
          currentUser.username ||
          data.displayName ||
          "مستخدم Shadow Live",
        ),
        profileImageUrl: clean(
          currentUser.profileImageUrl || data.profileImageUrl,
        ),
        publicId: clean(currentUser.publicId || data.publicId),
      },
      currentUser,
      nowMs,
    );
    return {
      rank: decoded.loaded + index + 1,
      points: safePoints(data.points),
      giftCount: safePoints(data.giftCount),
      ...presentation,
    };
  });

  const hasMore =
    rows.length > pageSize &&
    decoded.loaded + items.length < MAX_RESULTS &&
    items.length > 0;
  const last = pageRows[pageRows.length - 1];
  const nextCursor = hasMore && last
    ? encodeCursor(
        decoded.loaded + items.length,
        last.data?.points,
        clean(last.data?.counterpartUid || last.id),
      )
    : null;

  return {
    metric: normalizedMetric,
    items,
    nextCursor,
    totalCap: MAX_RESULTS,
    pageSize: MAX_PAGE_SIZE,
  };
}

export const userLevelSupportInternals = Object.freeze({
  decodeCursor,
  encodeCursor,
  MAX_PAGE_SIZE,
  MAX_RESULTS,
});
