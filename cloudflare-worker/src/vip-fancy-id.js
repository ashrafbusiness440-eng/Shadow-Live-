import { json, readJson } from "./http.js";
import { verifyFirebaseIdToken } from "./firebase-auth.js";
import { firestoreClient } from "./firestore.js";
import { annotatePressureRequest } from "./pressure-telemetry.js";
import {
  activeEffectiveVipLevelFromUser,
  timestampToEpochMs,
} from "./vip-runtime.js";

const clean = (value) => String(value ?? "").trim();
const ASSIGNMENT_ID = /^[A-Za-z0-9_-]{12,180}$/;

class ApiError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function digitsForLevel(level) {
  if (level >= 10) return { min: 3, max: 7 };
  if (level >= 8) return { min: 4, max: 7 };
  if (level >= 3) return { min: 6, max: 7 };
  return null;
}

function validFancyId(value, level) {
  const range = digitsForLevel(level);
  const id = clean(value);
  return (
    range != null &&
    /^\d+$/.test(id) &&
    id.length >= range.min &&
    id.length <= range.max
  );
}

function activeVipExpiryMs(user = {}, nowMs = Date.now()) {
  const candidates = [
    timestampToEpochMs(user.earnedVipExpiresAt),
    timestampToEpochMs(user.adminGrantExpiresAt),
    timestampToEpochMs(user.vipExpiresAt),
  ].filter((value) => Number.isFinite(value) && value > nowMs);
  return candidates.length ? Math.max(...candidates) : 0;
}

function assignmentId(uid, nowMs) {
  return `fancy_${uid}_${nowMs}_${crypto.randomUUID().replace(/-/g, "")}`;
}

function publicState(user = {}, nowMs = Date.now()) {
  const level = activeEffectiveVipLevelFromUser(user, nowMs);
  const fancyId = clean(user.activeFancyId);
  const expiresAtMs = timestampToEpochMs(user.fancyIdExpiresAt);
  const active =
    level >= 3 &&
    fancyId.length > 0 &&
    expiresAtMs > nowMs;
  return {
    active,
    fancyId: active ? fancyId : "",
    assignmentId: active ? clean(user.fancyIdAssignmentId) : "",
    expiresAtMs: active ? expiresAtMs : 0,
    effectiveVipLevel: level,
    allowedRange: digitsForLevel(level),
  };
}

async function endAssignment(
  db,
  transaction,
  user,
  uid,
  reason,
  nowMs,
) {
  const current = clean(user.activeFancyId);
  const currentAssignmentId = clean(user.fancyIdAssignmentId);
  if (!current || !currentAssignmentId) return [];

  const now = new Date(nowMs);
  const writes = [
    db.writeUpdate(
      `fancy_id_assignments/${currentAssignmentId}`,
      {
        status: reason === "expired" ? "expired" : "ended",
        endedAt: now,
        endReason: reason,
      },
      ["status", "endedAt", "endReason"],
    ),
    db.writeDelete(`fancy_id_active/${current}`),
  ];
  return writes;
}

export async function fancyIdState(db, uid, nowMs = Date.now()) {
  const userSnap = await db.get(`users/${uid}`);
  if (!userSnap.exists) throw new ApiError("user_not_found", 404);
  const user = userSnap.data || {};
  const state = publicState(user, nowMs);
  if (
    clean(user.activeFancyId) &&
    (!state.active || state.fancyId !== clean(user.activeFancyId))
  ) {
    const transaction = await db.beginTransaction();
    try {
      const freshSnap = await db.get(`users/${uid}`, transaction);
      const fresh = freshSnap.data || {};
      const freshState = publicState(fresh, nowMs);
      if (!freshState.active && clean(fresh.activeFancyId)) {
        const writes = await endAssignment(
          db,
          transaction,
          fresh,
          uid,
          "expired",
          nowMs,
        );
        const now = new Date(nowMs);
        writes.push(
          db.writeUpdate(
            `users/${uid}`,
            {
              activeFancyId: "",
              fancyIdAssignmentId: "",
              fancyIdExpiresAt: null,
              fancyIdUpdatedAt: now,
            },
            [
              "activeFancyId",
              "fancyIdAssignmentId",
              "fancyIdExpiresAt",
              "fancyIdUpdatedAt",
            ],
          ),
          db.writeUpdate(
            `public_profiles/${uid}`,
            {
              activeFancyId: "",
              fancyIdAssignmentId: "",
              fancyIdExpiresAt: null,
              updatedAt: now,
            },
            [
              "activeFancyId",
              "fancyIdAssignmentId",
              "fancyIdExpiresAt",
              "updatedAt",
            ],
          ),
        );
        await db.commit(transaction, writes);
      } else {
        await db.rollback(transaction);
      }
      return freshState.active
        ? freshState
        : { ...freshState, fancyId: "", assignmentId: "", expiresAtMs: 0 };
    } catch (error) {
      await db.rollback(transaction);
      throw error;
    }
  }
  return state;
}

export async function assignFancyId(db, uid, body, nowMs = Date.now()) {
  const requested = clean(body?.fancyId);
  const operationId = clean(body?.idempotencyKey);
  if (!ASSIGNMENT_ID.test(operationId)) {
    throw new ApiError("invalid_idempotency_key", 400);
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const transaction = await db.beginTransaction();
    try {
      const [
        userSnap,
        profileSnap,
        activeSnap,
        basicIdSnap,
        opSnap,
      ] = await Promise.all([
        db.get(`users/${uid}`, transaction),
        db.get(`public_profiles/${uid}`, transaction),
        db.get(`fancy_id_active/${requested}`, transaction),
        db.get(`public_ids/${requested}`, transaction),
        db.get(`vip_operations/${uid}__${operationId}`, transaction),
      ]);

      if (!userSnap.exists) throw new ApiError("user_not_found", 404);
      if (opSnap.exists) {
        await db.rollback(transaction);
        return {
          ok: true,
          code: "duplicate",
          ...(opSnap.data?.result || {}),
        };
      }

      const user = userSnap.data || {};
      const level = activeEffectiveVipLevelFromUser(user, nowMs);
      if (level < 3) throw new ApiError("fancy_id_requires_vip3", 403);
      if (!validFancyId(requested, level)) {
        throw new ApiError("invalid_fancy_id_for_vip", 400);
      }
      if (basicIdSnap.exists) throw new ApiError("fancy_id_taken", 409);

      const currentId = clean(user.activeFancyId);
      const currentAssignmentId = clean(user.fancyIdAssignmentId);
      if (
        activeSnap.exists &&
        clean(activeSnap.data?.uid) !== uid
      ) {
        throw new ApiError("fancy_id_taken", 409);
      }
      if (
        activeSnap.exists &&
        clean(activeSnap.data?.uid) === uid &&
        currentId === requested
      ) {
        const state = publicState(user, nowMs);
        await db.rollback(transaction);
        return { ok: true, code: "already_active", ...state };
      }

      const expiryMs = activeVipExpiryMs(user, nowMs);
      if (expiryMs <= nowMs) throw new ApiError("vip_expired", 403);

      const id = assignmentId(uid, nowMs);
      const now = new Date(nowMs);
      const expiresAt = new Date(expiryMs);
      const publicId = clean(
        profileSnap.data?.publicId || user.publicId,
      );
      const writes = [];

      if (currentId && currentAssignmentId) {
        writes.push(
          ...(await endAssignment(
            db,
            transaction,
            user,
            uid,
            "replaced",
            nowMs,
          )),
        );
      }

      writes.push(
        db.writeCreate(`fancy_id_assignments/${id}`, {
          assignmentId: id,
          assignmentVersion: nowMs,
          fancyId: requested,
          uid,
          publicIdSnapshot: publicId,
          assignedAt: now,
          expiresAt,
          endedAt: null,
          status: "active",
        }),
        db.writeUpdate(
          `fancy_id_active/${requested}`,
          {
            fancyId: requested,
            uid,
            assignmentId: id,
            assignmentVersion: nowMs,
            expiresAt,
            updatedAt: now,
          },
          [
            "fancyId",
            "uid",
            "assignmentId",
            "assignmentVersion",
            "expiresAt",
            "updatedAt",
          ],
        ),
        db.writeUpdate(
          `users/${uid}`,
          {
            activeFancyId: requested,
            fancyIdAssignmentId: id,
            fancyIdExpiresAt: expiresAt,
            fancyIdUpdatedAt: now,
          },
          [
            "activeFancyId",
            "fancyIdAssignmentId",
            "fancyIdExpiresAt",
            "fancyIdUpdatedAt",
          ],
        ),
      );
      if (profileSnap.exists) {
        writes.push(
          db.writeUpdate(
            `public_profiles/${uid}`,
            {
              activeFancyId: requested,
              fancyIdAssignmentId: id,
              fancyIdExpiresAt: expiresAt,
              updatedAt: now,
            },
            [
              "activeFancyId",
              "fancyIdAssignmentId",
              "fancyIdExpiresAt",
              "updatedAt",
            ],
          ),
        );
      }

      const result = {
        fancyId: requested,
        assignmentId: id,
        assignmentVersion: nowMs,
        expiresAtMs: expiryMs,
        effectiveVipLevel: level,
      };
      writes.push(
        db.writeCreate(`vip_operations/${uid}__${operationId}`, {
          uid,
          action: "assignFancyId",
          status: "completed",
          result,
          createdAt: now,
        }),
        db.writeCreate(
          `vip_audit_logs/${uid}__${operationId}__fancy`,
          {
            actorUid: uid,
            targetUserId: uid,
            action: "assignFancyId",
            beforeFancyId: currentId || null,
            afterFancyId: requested,
            assignmentId: id,
            publicIdSnapshot: publicId,
            createdAt: now,
          },
        ),
      );

      await db.commit(transaction, writes);
      return { ok: true, code: "ok", ...result };
    } catch (error) {
      await db.rollback(transaction);
      if (error instanceof ApiError) throw error;
      if (
        (error?.message === "ABORTED" || error?.status === 409) &&
        attempt < 2
      ) {
        continue;
      }
      throw error;
    }
  }
  throw new ApiError("transaction_failed", 500);
}

export async function resolveUserId(db, rawId, nowMs = Date.now()) {
  const id = clean(rawId);
  if (!/^\d{3,8}$/.test(id)) throw new ApiError("invalid_user_id", 400);

  if (id.length <= 7) {
    const fancy = await db.get(`fancy_id_active/${id}`);
    if (fancy.exists) {
      const data = fancy.data || {};
      const expiresAtMs = timestampToEpochMs(data.expiresAt);
      if (expiresAtMs > nowMs && clean(data.uid)) {
        return {
          ok: true,
          source: "fancy",
          uid: clean(data.uid),
          fancyId: id,
          assignmentId: clean(data.assignmentId),
          assignmentVersion: Number(data.assignmentVersion || 0),
          expiresAtMs,
        };
      }
    }
  }

  const basic = await db.get(`public_ids/${id}`);
  const uid = clean(basic.data?.uid);
  if (!basic.exists || !uid) throw new ApiError("user_id_not_found", 404);
  return {
    ok: true,
    source: "basic",
    uid,
    publicId: id,
  };
}

export async function validateFancyResolution(
  db,
  body,
  nowMs = Date.now(),
) {
  const fancyId = clean(body?.fancyId);
  const uid = clean(body?.uid);
  const assignmentIdValue = clean(body?.assignmentId);
  const assignmentVersion = Number(body?.assignmentVersion || 0);
  const snap = await db.get(`fancy_id_active/${fancyId}`);
  const data = snap.data || {};
  const valid =
    snap.exists &&
    clean(data.uid) === uid &&
    clean(data.assignmentId) === assignmentIdValue &&
    Number(data.assignmentVersion || 0) === assignmentVersion &&
    timestampToEpochMs(data.expiresAt) > nowMs;
  if (!valid) throw new ApiError("fancy_id_resolution_stale", 409);
  return { ok: true, uid, fancyId, assignmentId: assignmentIdValue };
}

export async function vipFancyId(request, env) {
  if (request.method !== "POST") {
    return json(request, env, { ok: false, code: "method_not_allowed" }, 405);
  }
  try {
    const decoded = await verifyFirebaseIdToken(request, env);
    if (decoded.firebase?.sign_in_provider === "anonymous") {
      throw new ApiError("account_required", 403);
    }
    const body = await readJson(request);
    const action = clean(body?.action);
    annotatePressureRequest(request, { action: `vipFancyId:${action}` });
    const db = firestoreClient(env);

    if (action === "state") {
      return json(request, env, {
        ok: true,
        ...(await fancyIdState(db, decoded.sub)),
      });
    }
    if (action === "assign") {
      return json(
        request,
        env,
        await assignFancyId(db, decoded.sub, body),
      );
    }
    if (action === "resolve") {
      return json(
        request,
        env,
        await resolveUserId(db, body?.id),
      );
    }
    if (action === "validateResolution") {
      return json(
        request,
        env,
        await validateFancyResolution(db, body),
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
    return json(request, env, { ok: false, code: "server_fancy_id_failed" }, 500);
  }
}
