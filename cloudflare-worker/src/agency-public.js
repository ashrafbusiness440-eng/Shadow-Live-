import { json, readJson, firestoreQuotaResponse } from "./http.js";
import { verifyFirebaseIdToken } from "./firebase-auth.js";
import { firestoreClient } from "./firestore.js";
import { boundedAgencyPageSize } from "./agency-data-model.js";
import { annotatePressureRequest } from "./pressure-telemetry.js";

const clean = (value) => String(value ?? "").trim();
const PUBLIC_HOST_PAGE_DEFAULT = 20;
export const PUBLIC_HOST_PAGE_MAX = 24;

class ApiError extends Error {
  constructor(code, status = 400, details = null) {
    super(code);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function validAgencyId(value) {
  return /^\d{6}$/.test(clean(value));
}

function validCursor(value) {
  const cursor = clean(value);
  return !cursor || (cursor.length <= 180 && !cursor.includes("/"));
}

function publicPersonSummary(uidInput, userSnap, extra = {}) {
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
    ...extra,
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

  const agencySnap = await db.get("agencies/" + agencyId);
  if (!agencySnap.exists) throw new ApiError("agency_not_found", 404);

  const agency = agencySnap.data || {};
  if (clean(agency.status) !== "active") {
    throw new ApiError("agency_unavailable", 404);
  }

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

  const [ownerSnap, ...hostUserSnaps] = await Promise.all([
    db.get("users/" + ownerUid),
    ...activeHostRows.map((row) => {
      const uid = clean(row?.data?.uid) || membershipCursor(agencyId, row);
      return db.get("users/" + uid);
    }),
  ]);
  if (!ownerSnap.exists) throw new ApiError("agency_owner_missing", 409);

  const hosts = activeHostRows.map((row, index) => {
    const membership = row.data || {};
    const uid = clean(membership.uid) || membershipCursor(agencyId, row);
    return publicPersonSummary(uid, hostUserSnaps[index], {
      joinedAt: membership.joinedAt || null,
    });
  });

  return {
    ok: true,
    agency: {
      agencyId,
      publicId: clean(agency.publicId) || agencyId,
      name: clean(agency.name) || "Shadow Live Agency",
      country: clean(agency.country) || null,
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

export async function agencyPublic(request, env) {
  if (request.method !== "POST") {
    return json(request, env, { ok: false, code: "method_not_allowed" }, 405);
  }

  try {
    await verifyFirebaseIdToken(request, env);
    const body = await readJson(request);
    annotatePressureRequest(request, { action: "agencyPublic:load" });
    const result = await loadPublicAgencyPage(firestoreClient(env), body);
    return json(request, env, result);
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
