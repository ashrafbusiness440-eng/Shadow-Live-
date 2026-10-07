import { json, readJson } from "./http.js";
import { verifyFirebaseIdToken } from "./firebase-auth.js";
import { firestoreClient } from "./firestore.js";
import { annotatePressureRequest } from "./pressure-telemetry.js";
import { activeEffectiveVipLevelFromUser } from "./vip-runtime.js";
import { vipEntitlementsFromUser } from "./vip-entitlements.js";
import {
  loadPublicProfilePresentation,
  loadPublicProfilePresentations,
  publicProfilePresentation,
} from "./public-profile-presentation.js";

const clean = (value) => String(value ?? "").trim();
const UID_PATTERN = /^[A-Za-z0-9_-]{1,180}$/;
const HISTORY_LIMIT = 50;

class ApiError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

async function actor(request, env) {
  const decoded = await verifyFirebaseIdToken(request, env);
  if (decoded.firebase?.sign_in_provider === "anonymous") {
    throw new ApiError("account_required", 403);
  }
  return decoded;
}

function canInspectPrivateVisits(user = {}) {
  if (clean(user.role) === "owner") return true;
  if (user.adminEnabled !== true) return false;
  const capabilities = new Set(
    Array.isArray(user.capabilities)
      ? user.capabilities.map(clean).filter(Boolean)
      : [],
  );
  return (
    capabilities.has("reviewReports") ||
    capabilities.has("manageUsers") ||
    capabilities.has("viewUsers")
  );
}

async function loadActorState(db, uid) {
  const snap = await db.get(`users/${uid}`);
  if (!snap.exists) throw new ApiError("user_not_found", 404);
  return snap.data || {};
}

export async function recordProfileVisit(db, visitorUid, body, nowMs = Date.now()) {
  const targetUid = clean(body?.targetUid);
  if (!UID_PATTERN.test(targetUid)) throw new ApiError("invalid_target", 400);
  if (targetUid === visitorUid) return { ok: true, recorded: false, self: true };

  const [visitorUserSnap, publicProfiles] = await Promise.all([
    db.get(`users/${visitorUid}`),
    loadPublicProfilePresentations(db, [visitorUid, targetUid], {
      limit: 2,
      concurrency: 2,
    }),
  ]);
  if (!visitorUserSnap.exists) throw new ApiError("user_not_found", 404);
  if (!publicProfiles.has(targetUid)) throw new ApiError("target_not_found", 404);

  const visitorUser = visitorUserSnap.data || {};
  const entitlements = vipEntitlementsFromUser(visitorUser, nowMs);
  const hidden =
    visitorUser.hideProfileVisits === true && entitlements.hideProfileVisits;
  const now = new Date(nowMs);
  const visitor =
    publicProfiles.get(visitorUid) || publicProfilePresentation(visitorUid);
  const target =
    publicProfiles.get(targetUid) || publicProfilePresentation(targetUid);

  if (hidden) {
    await db.commit(null, [
      db.writeUpdate(
        `profile_visit_private/${targetUid}/items/${visitorUid}`,
        {
          ...visitor,
          targetUid,
          hidden: true,
          lastVisitedAt: now,
        },
        [
          "uid",
          "publicId",
          "displayName",
          "profileImageUrl",
          "effectiveVipLevel",
          "targetUid",
          "hidden",
          "lastVisitedAt",
        ],
      ),
      db.writeUpdate(
        `profile_visited/${visitorUid}/items/${targetUid}`,
        {
          ...target,
          visitorUid,
          hidden: true,
          lastVisitedAt: now,
        },
        [
          "uid",
          "publicId",
          "displayName",
          "profileImageUrl",
          "effectiveVipLevel",
          "visitorUid",
          "hidden",
          "lastVisitedAt",
        ],
      ),
    ]);
    return { ok: true, recorded: true, hidden: true };
  }

  await db.commit(null, [
    db.writeUpdate(
      `profile_visitors/${targetUid}/items/${visitorUid}`,
      {
        ...visitor,
        targetUid,
        hidden: false,
        lastVisitedAt: now,
      },
      [
        "uid",
        "publicId",
        "displayName",
        "profileImageUrl",
        "effectiveVipLevel",
        "targetUid",
        "hidden",
        "lastVisitedAt",
      ],
    ),
    db.writeUpdate(
      `profile_visited/${visitorUid}/items/${targetUid}`,
      {
        ...target,
        visitorUid,
        hidden: false,
        lastVisitedAt: now,
      },
      [
        "uid",
        "publicId",
        "displayName",
        "profileImageUrl",
        "effectiveVipLevel",
        "visitorUid",
        "hidden",
        "lastVisitedAt",
      ],
    ),
  ]);

  return { ok: true, recorded: true, hidden: false };
}

export async function profileVisitHistory(db, uid, body, nowMs = Date.now()) {
  const actorUser = await loadActorState(db, uid);
  if (activeEffectiveVipLevelFromUser(actorUser, nowMs) < 1) {
    throw new ApiError("profile_visit_history_requires_vip1", 403);
  }

  const mode = clean(body?.mode) === "visited" ? "visited" : "visitors";
  const collectionPath =
    mode === "visited"
      ? `profile_visited/${uid}/items`
      : `profile_visitors/${uid}/items`;

  const rows = await db.runQuery(collectionPath, {
    orderBy: [{ field: "lastVisitedAt", direction: "desc" }],
    limit: HISTORY_LIMIT,
  });

  const uids = rows.map((row) => clean(row.data?.uid || row.id));
  const profiles = await loadPublicProfilePresentations(db, uids, {
    limit: HISTORY_LIMIT,
    concurrency: 8,
  });

  return {
    ok: true,
    mode,
    limit: HISTORY_LIMIT,
    items: rows.map((row) => {
      const targetUid = clean(row.data?.uid || row.id);
      return {
        ...row.data,
        ...(profiles.get(targetUid) || publicProfilePresentation(targetUid)),
        id: row.id,
      };
    }),
  };
}

export async function inspectPrivateVisits(db, uid, body) {
  const actorUser = await loadActorState(db, uid);
  if (!canInspectPrivateVisits(actorUser)) {
    throw new ApiError("forbidden", 403);
  }
  const targetUid = clean(body?.targetUid);
  if (!UID_PATTERN.test(targetUid)) throw new ApiError("invalid_target", 400);

  const rows = await db.runQuery(`profile_visit_private/${targetUid}/items`, {
    orderBy: [{ field: "lastVisitedAt", direction: "desc" }],
    limit: HISTORY_LIMIT,
  });
  const uids = rows.map((row) => clean(row.data?.uid || row.id));
  const profiles = await loadPublicProfilePresentations(db, uids, {
    limit: HISTORY_LIMIT,
    concurrency: 8,
  });
  return {
    ok: true,
    targetUid,
    items: rows.map((row) => {
      const visitorUid = clean(row.data?.uid || row.id);
      return {
        ...row.data,
        ...(profiles.get(visitorUid) || publicProfilePresentation(visitorUid)),
        id: row.id,
      };
    }),
  };
}

export async function profileVisits(request, env) {
  if (request.method !== "POST") {
    return json(request, env, { ok: false, code: "method_not_allowed" }, 405);
  }
  try {
    const decoded = await actor(request, env);
    const body = await readJson(request);
    const action = clean(body?.action);
    annotatePressureRequest(request, { action: `profileVisits:${action}` });
    const db = firestoreClient(env);

    if (action === "record") {
      return json(
        request,
        env,
        await recordProfileVisit(db, decoded.sub, body),
      );
    }
    if (action === "history") {
      return json(
        request,
        env,
        await profileVisitHistory(db, decoded.sub, body),
      );
    }
    if (action === "inspectHidden") {
      return json(
        request,
        env,
        await inspectPrivateVisits(db, decoded.sub, body),
      );
    }
    throw new ApiError("invalid_action", 400);
  } catch (error) {
    if (error instanceof ApiError) {
      return json(request, env, { ok: false, code: error.code }, error.status);
    }
    const code = clean(error?.message);
    if (code === "unauthorized") {
      return json(request, env, { ok: false, code }, 401);
    }
    return json(
      request,
      env,
      { ok: false, code: "server_profile_visits_failed" },
      500,
    );
  }
}
