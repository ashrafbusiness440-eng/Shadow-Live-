const clean = (value) => String(value ?? "").trim();

export const PUBLIC_PROFILE_PRESENTATION_MAX = 80;
export const PUBLIC_PROFILE_PRESENTATION_CONCURRENCY = 8;

export function publicProfilePresentation(uidInput, data = {}) {
  const uid = clean(uidInput);
  return {
    uid,
    publicId: clean(data.publicId) || null,
    displayName:
      clean(data.displayName || data.name || data.username) ||
      "Shadow Live",
    profileImageUrl:
      clean(data.profileImageUrl || data.photoUrl || data.avatarUrl) || null,
    profileAvatarAsset: clean(data.profileAvatarAsset) || null,
    activeProfileFrameRewardId:
      clean(data.activeProfileFrameRewardId) || null,
    activeProfileFrameAssetKey:
      clean(data.activeProfileFrameAssetKey) || null,
    activeProfileFrameImageUrl:
      clean(data.activeProfileFrameImageUrl) || null,
    activeProfileFrameExpiresAtMs:
      Math.max(0, Number(data.activeProfileFrameExpiresAtMs || 0)),
    activeProfileFramePermanent:
      data.activeProfileFramePermanent === true,
    effectiveVipLevel: Math.max(
      0,
      Math.min(
        10,
        Number(data.effectiveVipLevel ?? data.vipLevel ?? 0) || 0,
      ),
    ),
  };
}

export async function loadPublicProfilePresentation(db, uidInput) {
  const uid = clean(uidInput);
  if (!uid) return publicProfilePresentation("", {});
  const snapshot = await db.get("public_profiles/" + uid);
  return publicProfilePresentation(
    uid,
    snapshot?.exists ? snapshot.data || {} : {},
  );
}

export async function loadPublicProfilePresentations(
  db,
  uidInputs = [],
  {
    limit = PUBLIC_PROFILE_PRESENTATION_MAX,
    concurrency = PUBLIC_PROFILE_PRESENTATION_CONCURRENCY,
  } = {},
) {
  const boundedLimit = Math.max(
    1,
    Math.min(PUBLIC_PROFILE_PRESENTATION_MAX, Number(limit || 1)),
  );
  const boundedConcurrency = Math.max(
    1,
    Math.min(
      PUBLIC_PROFILE_PRESENTATION_CONCURRENCY,
      Number(concurrency || 1),
    ),
  );
  const uids = [...new Set(
    (Array.isArray(uidInputs) ? uidInputs : [])
      .map(clean)
      .filter(Boolean),
  )].slice(0, boundedLimit);

  const result = new Map();
  for (let offset = 0; offset < uids.length; offset += boundedConcurrency) {
    const batch = uids.slice(offset, offset + boundedConcurrency);
    const snapshots = await Promise.all(
      batch.map((uid) => db.get("public_profiles/" + uid)),
    );
    for (let index = 0; index < batch.length; index += 1) {
      const uid = batch[index];
      const snapshot = snapshots[index];
      result.set(
        uid,
        publicProfilePresentation(
          uid,
          snapshot?.exists ? snapshot.data || {} : {},
        ),
      );
    }
  }
  return result;
}

export function mergePublicProfilePresentation(target = {}, profile = {}) {
  return {
    ...target,
    uid: clean(profile.uid || target.uid),
    publicId: profile.publicId ?? target.publicId ?? null,
    displayName:
      clean(profile.displayName || target.displayName) || "Shadow Live",
    profileImageUrl:
      profile.profileImageUrl ?? target.profileImageUrl ?? null,
    profileAvatarAsset:
      profile.profileAvatarAsset ?? target.profileAvatarAsset ?? null,
    activeProfileFrameRewardId:
      profile.activeProfileFrameRewardId ??
      target.activeProfileFrameRewardId ??
      null,
    activeProfileFrameAssetKey:
      profile.activeProfileFrameAssetKey ??
      target.activeProfileFrameAssetKey ??
      null,
    activeProfileFrameImageUrl:
      profile.activeProfileFrameImageUrl ??
      target.activeProfileFrameImageUrl ??
      null,
    activeProfileFrameExpiresAtMs: Math.max(
      0,
      Number(
        profile.activeProfileFrameExpiresAtMs ??
        target.activeProfileFrameExpiresAtMs ??
        0,
      ),
    ),
    activeProfileFramePermanent:
      profile.activeProfileFramePermanent === true ||
      target.activeProfileFramePermanent === true,
    effectiveVipLevel: Math.max(
      0,
      Number(
        profile.effectiveVipLevel ??
        target.effectiveVipLevel ??
        0,
      ),
    ),
  };
}
