import { json, readJson } from "./http.js";
import { verifyFirebaseIdToken } from "./firebase-auth.js";
import { firestoreClient } from "./firestore.js";
import { googleAccessToken, parseServiceAccount } from "./google-auth.js";

class ApiError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

const clean = (value) => String(value ?? "").trim();

function pick(source, keys) {
  const out = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source || {}, key)) {
      out[key] = source[key];
    }
  }
  return out;
}

async function lookupAuthUser(env, uid) {
  const { projectId } = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT);
  const token = await googleAccessToken(
    env,
    "https://www.googleapis.com/auth/identitytoolkit",
  );
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/accounts:lookup`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ localId: [uid] }),
    },
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(
      clean(body?.error?.status || body?.error?.message || "identity_lookup_failed"),
      response.status || 500,
    );
  }
  const user = Array.isArray(body.users) ? body.users[0] : null;
  if (!user) return null;

  return {
    uid: clean(user.localId),
    email: clean(user.email),
    emailVerified: user.emailVerified === true,
    phoneNumber: clean(user.phoneNumber),
    displayName: clean(user.displayName),
    photoUrl: clean(user.photoUrl),
    disabled: user.disabled === true,
    createdAt: clean(user.createdAt),
    lastLoginAt: clean(user.lastLoginAt),
    lastRefreshAt: clean(user.lastRefreshAt),
    validSince: clean(user.validSince),
    providers: Array.isArray(user.providerUserInfo)
      ? user.providerUserInfo.map((provider) => ({
          providerId: clean(provider.providerId),
          rawId: clean(provider.rawId),
          email: clean(provider.email),
          phoneNumber: clean(provider.phoneNumber),
          displayName: clean(provider.displayName),
          photoUrl: clean(provider.photoUrl),
        }))
      : [],
  };
}

const safeUserKeys = [
  "displayName",
  "name",
  "username",
  "email",
  "phone",
  "publicId",
  "profileImageUrl",
  "profileImage",
  "avatarUrl",
  "profileAvatarAsset",
  "coverImageUrl",
  "coverImage",
  "bio",
  "gender",
  "birthDate",
  "country",
  "location",
  "interests",
  "role",
  "adminEnabled",
  "capabilities",
  "accountStatus",
  "suspendedUntil",
  "bannedAt",
  "disabledAt",
  "authDeleted",
  "deletedAt",
  "createdAt",
  "updatedAt",
  "lastSeenAt",
  "isOnline",
  "coins",
  "diamonds",
  "balance",
  "level",
  "vipLevel",
  "wealth",
  "wealthLevel",
  "popularity",
  "popularityLevel",
  "charisma",
  "charismaLevel",
  "appeal",
  "appealLevel",
  "agencyId",
  "agencyRole",
  "roomId",
  "personalRoomId",
  "giftDiamondsLifetime",
  "giftEarningCoinsLifetime",
  "giftSupportReceivedCoins",
  "totalGiftsSent",
  "totalGiftsReceived",
  "totalValueReceived",
];

const safeProfileKeys = [
  "displayName",
  "username",
  "publicId",
  "profileImageUrl",
  "profileAvatarAsset",
  "coverImageUrl",
  "bio",
  "location",
  "interests",
  "level",
  "vipLevel",
  "badges",
  "isOnline",
  "createdAt",
  "updatedAt",
  "wealth",
  "wealthLevel",
  "popularity",
  "popularityLevel",
  "charisma",
  "charismaLevel",
  "appeal",
  "appealLevel",
];

const safeRoomKeys = [
  "publicId",
  "name",
  "title",
  "roomType",
  "type",
  "systemOwned",
  "officialRoom",
  "ownerUid",
  "hostUid",
  "category",
  "description",
  "coverImageUrl",
  "visibility",
  "level",
  "roomLevel",
  "micCount",
  "seatCount",
  "moderatorCount",
  "createdAt",
  "updatedAt",
];

const safeAgencyKeys = [
  "name",
  "displayName",
  "agencyName",
  "publicId",
  "ownerUid",
  "status",
  "level",
  "country",
  "logoUrl",
  "imageUrl",
  "createdAt",
  "updatedAt",
];

async function firstRoomForUser(db, uid, user) {
  const directRoomId = clean(user.personalRoomId || user.roomId);
  if (directRoomId) {
    const direct = await db.get(`rooms/${directRoomId}`);
    if (direct.exists) {
      return { id: directRoomId, ...pick(direct.data || {}, safeRoomKeys) };
    }
  }

  for (const field of ["ownerUid", "createdBy", "userId"]) {
    const rows = await db.runQuery("rooms", {
      filters: [{ field, op: "==", value: uid }],
      limit: 1,
    }).catch(() => []);
    if (rows.length) {
      return { id: rows[0].id, ...pick(rows[0].data || {}, safeRoomKeys) };
    }
  }
  return null;
}

async function agencyForUser(db, user) {
  const agencyId = clean(user.agencyId);
  if (!agencyId) return null;

  for (const collection of ["agencies", "agency_profiles"]) {
    const snap = await db.get(`${collection}/${agencyId}`).catch(() => ({ exists: false }));
    if (snap.exists) {
      return {
        id: agencyId,
        source: collection,
        ...pick(snap.data || {}, safeAgencyKeys),
      };
    }
  }
  return { id: agencyId };
}

export async function controlUserDetails(request, env) {
  if (request.method !== "POST") {
    return json(request, env, { ok: false, code: "method_not_allowed" }, 405);
  }

  try {
    const decoded = await verifyFirebaseIdToken(request, env);
    const body = await readJson(request);
    const targetUid = clean(body.targetUid);
    if (!targetUid) throw new ApiError("invalid_request", 400);

    const db = firestoreClient(env);
    const actorSnap = await db.get(`users/${decoded.sub}`);
    const actor = actorSnap.data || {};
    const caps = Array.isArray(actor.capabilities) ? actor.capabilities : [];
    const canRead =
      actorSnap.exists &&
      actor.adminEnabled === true &&
      (actor.role === "owner" || caps.includes("viewUsers"));
    if (!canRead) throw new ApiError("forbidden", 403);

    const userSnap = await db.get(`users/${targetUid}`);
    if (!userSnap.exists) throw new ApiError("not_found", 404);
    const user = userSnap.data || {};

    const [auth, profileSnap, room, agency] = await Promise.all([
      lookupAuthUser(env, targetUid).catch((error) => {
        if (clean(error?.code).includes("USER_NOT_FOUND")) return null;
        throw error;
      }),
      db.get(`public_profiles/${targetUid}`).catch(() => ({ exists: false, data: null })),
      firstRoomForUser(db, targetUid, user),
      agencyForUser(db, user),
    ]);

    return json(request, env, {
      ok: true,
      uid: targetUid,
      auth,
      user: pick(user, safeUserKeys),
      publicProfile: profileSnap.exists ? pick(profileSnap.data || {}, safeProfileKeys) : null,
      room,
      agency,
    }, 200);
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
      { ok: false, code: code || "control_user_details_failed" },
      500,
    );
  }
}
