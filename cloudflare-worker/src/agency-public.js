import { json, readJson, firestoreQuotaResponse } from "./http.js";
import { verifyFirebaseIdToken } from "./firebase-auth.js";
import { firestoreClient } from "./firestore.js";
import { boundedAgencyPageSize } from "./agency-data-model.js";
import {
  agencyPublicRankingPrefix,
  currentAgencyMonthKey,
  normalizeAgencyMonthKey,
} from "./agency-policy.js";
import { annotatePressureRequest } from "./pressure-telemetry.js";

const clean = (value) => String(value ?? "").trim();
const PUBLIC_HOST_PAGE_DEFAULT = 12;
export const PUBLIC_HOST_PAGE_MAX = 12;
const PUBLIC_USER_READ_CONCURRENCY = 4;
const PUBLIC_ARCHIVE_READ_CONCURRENCY = 3;
export const PUBLIC_RANKING_MAX = 10;
export const PUBLIC_ARCHIVE_MONTHS_MAX = 6;
export const PUBLIC_AGENCY_SEARCH_MAX = 20;
export const PUBLIC_AGENCY_DISCOVERY_WINDOW = 80;

class ApiError extends Error {
  constructor(code, status = 400, details = null) {
    super(code);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function validAgencyId(value) {
  return /^\d{3,8}$/.test(clean(value));
}

function validCursor(value) {
  const cursor = clean(value);
  return !cursor || (cursor.length <= 180 && !cursor.includes("/"));
}

function publicAgencyTopValue(agency = {}) {
  for (const value of [
    agency.publicTopValue,
    agency.topValue,
    agency.topSupportCoins,
    agency.supportCoins,
  ]) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed) && parsed >= 0) return parsed;
  }
  return 0;
}

function publicAgencySummary(row, rank = null) {
  const agency = row?.data || {};
  return {
    agencyId: clean(agency.agencyId || row?.id),
    publicId: clean(agency.publicId || agency.agencyId || row?.id),
    name: clean(agency.name) || "Shadow Live Agency",
    country: clean(agency.country) || null,
    logoUrl:
      clean(agency.logoUrl || agency.imageUrl || agency.profileImageUrl) ||
      null,
    coverUrl:
      clean(agency.coverUrl || agency.backgroundUrl || agency.roomCoverUrl) ||
      null,
    description: clean(agency.description) || null,
    publicContact: clean(agency.publicContact) || null,
    memberCount: Math.max(0, Number(agency.memberCount || 0)),
    hostCount: Math.max(0, Number(agency.hostCount || 0)),
    topValue: publicAgencyTopValue(agency),
    rank: Number.isInteger(rank) && rank > 0 ? rank : null,
  };
}

function normalizeAgencySearchText(value) {
  return clean(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "")
    .replace(/ـ/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ")
    .trim();
}

function comparePublicAgencyRows(left, right) {
  const a = left?.data || {};
  const b = right?.data || {};
  const topDelta = publicAgencyTopValue(b) - publicAgencyTopValue(a);
  if (topDelta !== 0) return topDelta;
  const membersDelta =
    Math.max(0, Number(b.memberCount || 0)) -
    Math.max(0, Number(a.memberCount || 0));
  if (membersDelta !== 0) return membersDelta;
  return clean(a.publicId || a.agencyId || left?.id).localeCompare(
    clean(b.publicId || b.agencyId || right?.id),
    "en",
    { numeric: true },
  );
}

function discoveryOffset(value) {
  const parsed = Number(value || 0);
  if (!Number.isInteger(parsed) || parsed < 0) return 0;
  return Math.min(PUBLIC_AGENCY_DISCOVERY_WINDOW, parsed);
}

async function discoveryRows(db) {
  const rows = await db.runQuery("agencies", {
    orderBy: [{ field: "__name__", direction: "asc" }],
    limit: PUBLIC_AGENCY_DISCOVERY_WINDOW + 1,
  });
  const truncated = rows.length > PUBLIC_AGENCY_DISCOVERY_WINDOW;
  return {
    rows: rows
      .slice(0, PUBLIC_AGENCY_DISCOVERY_WINDOW)
      .filter((row) => clean(row?.data?.status) === "active")
      .sort(comparePublicAgencyRows),
    truncated,
  };
}

function pagedDiscoveryResult(rows, body = {}, truncated = false) {
  const limit = Math.min(
    PUBLIC_AGENCY_SEARCH_MAX,
    boundedAgencyPageSize(body.limit, PUBLIC_AGENCY_SEARCH_MAX),
  );
  const offset = discoveryOffset(body.cursor);
  const pageRows = rows.slice(offset, offset + limit);
  const nextOffset = offset + pageRows.length;
  const hasMore = nextOffset < rows.length;
  return {
    ok: true,
    results: pageRows.map((row, index) =>
      publicAgencySummary(row, offset + index + 1)
    ),
    page: {
      limit,
      hasMore,
      nextCursor: hasMore ? String(nextOffset) : null,
      truncated,
    },
  };
}

export async function browsePublicAgencies(db, body = {}) {
  const discovery = await discoveryRows(db);
  return pagedDiscoveryResult(
    discovery.rows,
    body,
    discovery.truncated,
  );
}

export async function searchPublicAgencies(db, body = {}) {
  const query = clean(body.query);
  const mode = clean(body.mode) || (validAgencyId(query) ? "id" : "name");
  if (!query || query.length > 80 || !["id", "name", "country"].includes(mode)) {
    throw new ApiError("invalid_agency_search", 400);
  }

  if (mode === "id") {
    if (!validAgencyId(query)) throw new ApiError("invalid_agency_id", 400);

    const registrySnap = await db.get(`agency_ids/${query}`);
    const resolvedAgencyId =
      registrySnap.exists && registrySnap.data?.reserved !== true
        ? clean(registrySnap.data?.agencyId)
        : "";

    if (validAgencyId(resolvedAgencyId)) {
      const snap = await db.get(`agencies/${resolvedAgencyId}`);
      const active =
        snap.exists &&
        clean(snap.data?.status) === "active" &&
        clean(snap.data?.publicId || resolvedAgencyId) === query;
      return {
        ok: true,
        results: active ? [publicAgencySummary(snap, 1)] : [],
        page: {
          limit: 1,
          hasMore: false,
          nextCursor: null,
          truncated: false,
        },
      };
    }

    // Legacy fallback is valid only while the immutable Agency document key
    // is still the Agency's current public ID. A changed key must not shadow
    // a public ID that can now be reused by another Agency.
    const directSnap = await db.get(`agencies/${query}`);
    const directPublicId = clean(directSnap.data?.publicId || query);
    const active =
      directSnap.exists &&
      clean(directSnap.data?.status) === "active" &&
      directPublicId === query;
    return {
      ok: true,
      results: active ? [publicAgencySummary(directSnap, 1)] : [],
      page: {
        limit: 1,
        hasMore: false,
        nextCursor: null,
        truncated: false,
      },
    };
  }

  const normalized = normalizeAgencySearchText(query);
  if (normalized.length < 2) {
    throw new ApiError("agency_search_too_short", 400);
  }

  if (mode === "country") {
    const rows = await db.runQuery("agencies", {
      filters: [{ field: "country", op: "==", value: query }],
      orderBy: [{ field: "__name__", direction: "asc" }],
      limit: PUBLIC_AGENCY_DISCOVERY_WINDOW + 1,
    });
    const truncated = rows.length > PUBLIC_AGENCY_DISCOVERY_WINDOW;
    const filtered = rows
      .slice(0, PUBLIC_AGENCY_DISCOVERY_WINDOW)
      .filter((row) => clean(row?.data?.status) === "active")
      .sort(comparePublicAgencyRows);
    return pagedDiscoveryResult(filtered, body, truncated);
  }

  const discovery = await discoveryRows(db);
  const filtered = discovery.rows.filter((row) =>
    normalizeAgencySearchText(row?.data?.name).includes(normalized)
  );
  return pagedDiscoveryResult(filtered, body, discovery.truncated);
}

function previousAgencyMonths(currentMonth, count = PUBLIC_ARCHIVE_MONTHS_MAX) {
  const [yearText, monthText] = currentMonth.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year, monthIndex - index - 1, 1));
    return date.toISOString().slice(0, 7);
  });
}

function allowedRankingMonths(now = new Date()) {
  const current = currentAgencyMonthKey(now);
  return new Set([current, ...previousAgencyMonths(current)]);
}

async function readActiveAgency(db, agencyId) {
  const agencySnap = await db.get("agencies/" + agencyId);
  if (!agencySnap.exists) throw new ApiError("agency_not_found", 404);
  const agency = agencySnap.data || {};
  if (clean(agency.status) !== "active") {
    throw new ApiError("agency_unavailable", 404);
  }
  return agency;
}

function rankingSupportCoins(value) {
  const parsed = Number(value ?? 0);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new ApiError("agency_ranking_corrupt", 409);
  }
  return parsed;
}

async function readPublicPeople(db, rows, uidResolver) {
  const snapshots = [];
  for (
    let offset = 0;
    offset < rows.length;
    offset += PUBLIC_USER_READ_CONCURRENCY
  ) {
    const batch = rows.slice(offset, offset + PUBLIC_USER_READ_CONCURRENCY);
    const readBatch = await Promise.all(
      batch.map((row) => db.get("users/" + uidResolver(row))),
    );
    snapshots.push(...readBatch);
  }
  return snapshots;
}

function publicPersonSummary(uidInput, userSnap) {
  const uid = clean(uidInput);
  const user = userSnap?.exists ? userSnap.data || {} : {};
  return {
    uid,
    publicId: clean(user.publicId) || null,
    displayName:
      clean(user.displayName || user.name || user.username) ||
      "Shadow Live",
    profileImageUrl:
      clean(user.profileImageUrl || user.photoUrl || user.avatarUrl) || null,
  };
}

function membershipCursor(agencyId, row) {
  const prefix = agencyId + "__";
  const id = clean(row?.id);
  if (!id.startsWith(prefix) || id.length <= prefix.length) {
    throw new ApiError("agency_membership_cursor_corrupt", 409);
  }
  return id.slice(prefix.length);
}

export async function loadPublicAgencyPage(db, body = {}) {
  const agencyId = clean(body.agencyId);
  if (!validAgencyId(agencyId)) {
    throw new ApiError("invalid_agency_id", 400);
  }

  const cursor = clean(body.cursor);
  if (!validCursor(cursor)) {
    throw new ApiError("invalid_cursor", 400);
  }

  const limit = Math.min(
    PUBLIC_HOST_PAGE_MAX,
    boundedAgencyPageSize(body.limit, PUBLIC_HOST_PAGE_DEFAULT),
  );

  const agency = await readActiveAgency(db, agencyId);

  const ownerUid = clean(agency.ownerUid);
  if (!ownerUid) throw new ApiError("agency_owner_missing", 409);

  const lowerPath = "agency_memberships/" +
    agencyId + "__" + (cursor || "");
  const upperPath = "agency_memberships/" + agencyId + "__\uf8ff";
  const rows = await db.runQuery("agency_memberships", {
    filters: [
      {
        field: "__name__",
        op: cursor ? ">" : ">=",
        referencePath: lowerPath,
      },
      {
        field: "__name__",
        op: "<",
        referencePath: upperPath,
      },
    ],
    orderBy: [{ field: "__name__", direction: "asc" }],
    limit: limit + 1,
  });

  const pageRows = rows.slice(0, limit);
  const hasMore = rows.length > limit;
  const nextCursor = hasMore && pageRows.length
    ? membershipCursor(agencyId, pageRows[pageRows.length - 1])
    : null;

  const activeHostRows = pageRows.filter((row) => {
    const membership = row?.data || {};
    return clean(membership.agencyId) === agencyId &&
      clean(membership.role) === "host" &&
      clean(membership.status) === "active";
  });

  const ownerSnap = await db.get("users/" + ownerUid);
  if (!ownerSnap.exists) throw new ApiError("agency_owner_missing", 409);

  const hostUserSnaps = [];
  for (
    let offset = 0;
    offset < activeHostRows.length;
    offset += PUBLIC_USER_READ_CONCURRENCY
  ) {
    const batch = activeHostRows.slice(
      offset,
      offset + PUBLIC_USER_READ_CONCURRENCY,
    );
    const snapshots = await Promise.all(
      batch.map((row) => {
        const uid =
          clean(row?.data?.uid) || membershipCursor(agencyId, row);
        return db.get("users/" + uid);
      }),
    );
    hostUserSnaps.push(...snapshots);
  }

  const hosts = activeHostRows.map((row, index) => {
    const membership = row.data || {};
    const uid = clean(membership.uid) || membershipCursor(agencyId, row);
    return publicPersonSummary(uid, hostUserSnaps[index]);
  });

  return {
    ok: true,
    agency: {
      agencyId,
      publicId: clean(agency.publicId) || agencyId,
      name: clean(agency.name) || "Shadow Live Agency",
      country: clean(agency.country) || null,
      logoUrl:
        clean(agency.logoUrl || agency.imageUrl || agency.profileImageUrl) ||
        null,
      coverUrl:
        clean(agency.coverUrl || agency.backgroundUrl || agency.roomCoverUrl) ||
        null,
      description: clean(agency.description) || null,
      publicContact: clean(agency.publicContact) || null,
      memberCount: Math.max(0, Number(agency.memberCount || 0)),
      hostCount: Math.max(0, Number(agency.hostCount || 0)),
    },
    owner: publicPersonSummary(ownerUid, ownerSnap),
    hosts,
    page: {
      limit,
      hasMore,
      nextCursor,
    },
  };
}


export async function loadPublicAgencyRanking(
  db,
  body = {},
  now = new Date(),
) {
  const agencyId = clean(body.agencyId);
  if (!validAgencyId(agencyId)) {
    throw new ApiError("invalid_agency_id", 400);
  }
  await readActiveAgency(db, agencyId);

  const currentMonth = currentAgencyMonthKey(now);
  let month = currentMonth;
  if (clean(body.month)) {
    try {
      month = normalizeAgencyMonthKey(body.month);
    } catch (_) {
      throw new ApiError("invalid_agency_month", 400);
    }
  }
  if (!allowedRankingMonths(now).has(month)) {
    throw new ApiError("agency_ranking_month_out_of_range", 400);
  }

  const rankingPrefix = agencyPublicRankingPrefix(agencyId, month);
  const rows = await db.runQuery("agency_host_monthly", {
    filters: [
      {
        field: "publicRankingKey",
        op: ">=",
        value: rankingPrefix,
      },
      {
        field: "publicRankingKey",
        op: "<",
        value: rankingPrefix + "\uf8ff",
      },
    ],
    orderBy: [
      { field: "publicRankingKey", direction: "asc" },
    ],
    limit: PUBLIC_RANKING_MAX,
  });

  const normalizedRows = rows.map((row) => {
    const monthly = row?.data || {};
    const hostUid = clean(monthly.hostUid);
    if (
      !hostUid ||
      clean(monthly.agencyId) !== agencyId ||
      clean(monthly.month) !== month ||
      !clean(monthly.publicRankingKey).startsWith(rankingPrefix)
    ) {
      throw new ApiError("agency_ranking_corrupt", 409);
    }
    return {
      hostUid,
      supportCoins: rankingSupportCoins(monthly.publicSupportCoins),
    };
  });

  const userSnaps = await readPublicPeople(
    db,
    normalizedRows,
    (row) => row.hostUid,
  );

  return {
    ok: true,
    month,
    currentMonth,
    top10: normalizedRows.map((row, index) => ({
      rank: index + 1,
      supportCoins: row.supportCoins,
      ...publicPersonSummary(row.hostUid, userSnaps[index]),
    })),
  };
}

export async function loadPublicAgencyArchive(
  db,
  body = {},
  now = new Date(),
) {
  const agencyId = clean(body.agencyId);
  if (!validAgencyId(agencyId)) {
    throw new ApiError("invalid_agency_id", 400);
  }
  await readActiveAgency(db, agencyId);

  const currentMonth = currentAgencyMonthKey(now);
  const candidates = previousAgencyMonths(currentMonth);
  const months = [];

  for (
    let offset = 0;
    offset < candidates.length;
    offset += PUBLIC_ARCHIVE_READ_CONCURRENCY
  ) {
    const batch = candidates.slice(
      offset,
      offset + PUBLIC_ARCHIVE_READ_CONCURRENCY,
    );
    const snaps = await Promise.all(
      batch.map((month) =>
        db.get("agency_support_stats/" + agencyId + "/monthly/" + month),
      ),
    );
    for (let index = 0; index < batch.length; index += 1) {
      if (snaps[index]?.exists) months.push(batch[index]);
    }
  }

  return {
    ok: true,
    currentMonth,
    months,
    maxMonths: PUBLIC_ARCHIVE_MONTHS_MAX,
  };
}

export async function agencyPublic(request, env) {
  if (request.method !== "POST") {
    return json(request, env, { ok: false, code: "method_not_allowed" }, 405);
  }

  try {
    await verifyFirebaseIdToken(request, env);
    const body = await readJson(request);
    const action = clean(body.action) || "page";
    const db = firestoreClient(env);

    if (action === "ranking") {
      annotatePressureRequest(request, { action: "agencyPublic:ranking" });
      return json(
        request,
        env,
        await loadPublicAgencyRanking(db, body),
      );
    }
    if (action === "archive") {
      annotatePressureRequest(request, { action: "agencyPublic:archive" });
      return json(
        request,
        env,
        await loadPublicAgencyArchive(db, body),
      );
    }
    if (action === "browse") {
      annotatePressureRequest(request, { action: "agencyPublic:browse" });
      return json(request, env, await browsePublicAgencies(db, body));
    }
    if (action === "search") {
      annotatePressureRequest(request, { action: "agencyPublic:search" });
      return json(request, env, await searchPublicAgencies(db, body));
    }
    if (action !== "page") {
      throw new ApiError("invalid_agency_public_action", 400);
    }

    annotatePressureRequest(request, { action: "agencyPublic:page" });
    return json(
      request,
      env,
      await loadPublicAgencyPage(db, body),
    );
  } catch (error) {
    if (error instanceof ApiError) {
      return json(
        request,
        env,
        {
          ok: false,
          code: error.code,
          ...(error.details ? { details: error.details } : {}),
        },
        error.status,
      );
    }

    const quota = firestoreQuotaResponse(request, env, error);
    if (quota) return quota;

    const code = clean(error?.message);
    if (code === "unauthorized") {
      return json(request, env, { ok: false, code }, 401);
    }
    if (
      code === "server_not_configured" ||
      code === "invalid_service_account_json"
    ) {
      return json(request, env, { ok: false, code }, 503);
    }
    return json(request, env, { ok: false, code: "agency_public_failed" }, 500);
  }
}
