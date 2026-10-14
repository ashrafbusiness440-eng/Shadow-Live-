import {
  IMAGE_MODERATION_PATH, defaultImageModerationPolicy,
  imageModerationApplies, runImageModerationProvider,
} from "./image-moderation-policy.js";

// Only the private staging key is writeable by a moderated upload ticket.
// Public R2 paths do not exist until the server has approved the image.
export function moderatedStagingKey(publicKey) {
  if (!publicKey || publicKey.startsWith("moderation-staging/")) {
    throw Error("invalid_publication_key");
  }
  return "moderation-staging/" + publicKey;
}

export async function uploadModerationSnapshot(db, scope) {
  const doc = await db.get(IMAGE_MODERATION_PATH);
  const policy = doc.exists
    ? { ...defaultImageModerationPolicy(), ...(doc.data || {}) }
    : defaultImageModerationPolicy();
  return imageModerationApplies(policy, scope) ? {
    enabled: true, provider: policy.provider, mode: policy.mode,
    scope: policy.scope, dailyLimit: policy.dailyLimit,
    version: Number(policy.version || 0),
  } : null;
}

// Atomic fixed-day reservation BEFORE contacting any provider.
// A receipt per object prevents replay from charging or running inference again.
// Recovery after a failed call is manual: fail closed, never silently retry paid AI.
export async function reserveModerationAttempt(db, objectId, policy,
  now = new Date()) {
  const day = now.toISOString().slice(0, 10).replaceAll("-", "");
  const receiptPath = "image_moderation_attempts/" + objectId;
  const counterPath = "image_moderation_usage/" + day + "_" + policy.provider;
  const tx = await db.beginTransaction();
  try {
    const [receipt, usage] = await Promise.all([
      db.get(receiptPath, tx), db.get(counterPath, tx),
    ]);
    if (receipt.exists) {
      await db.rollback(tx);
      return { reserved: false, reason: "already_reserved" };
    }
    const count = Number(usage.data?.attempted || 0);
    const limit = Number(policy.dailyLimit || 0);
    if (!Number.isSafeInteger(limit) || limit < 1 ||
        count >= limit) {
      await db.rollback(tx);
      return { reserved: false, reason: "daily_quota_reached" };
    }
    await db.commit(tx, [
      usage.exists
        ? db.writeUpdate(counterPath, { attempted: count + 1,
            updatedAt: now }, ["attempted", "updatedAt"])
        : db.writeCreate(counterPath, {
            day, provider: policy.provider, attempted: 1, updatedAt: now,
          }),
      db.writeCreate(receiptPath, {
        objectId, provider: policy.provider, day,
        createdAt: now, status: "reserved",
      }),
    ]);
    return { reserved: true, reason: "reserved" };
  } catch (error) {
    await db.rollback(tx).catch(() => {});
    throw error;
  }
}

export async function classifyModeratedUpload({
  db, bucket, env, ticket, objectId,
}) {
  const policy = ticket.moderationPolicy;
  if (!policy?.enabled) return { status: "approved", reason: "not_in_scope" };
  const reservation = await reserveModerationAttempt(db, objectId, policy);
  if (!reservation.reserved) {
    return { status: "needs_review", reason: reservation.reason };
  }
  try {
    // The HEAD check in confirmUpload already verified size; read remains
    // bounded by the existing 3 MiB image limit. GIF is never auto-approved.
    const object = await bucket.get(ticket.storageKey);
    if (!object || Number(object.size || 0) > 3 * 1024 * 1024 ||
        Number(object.size || 0) <= 0) {
      return { status: "needs_review", reason: "image_unavailable" };
    }
    if (ticket.mimeType === "image/gif") {
      return { status: "needs_review", reason: "animation_manual_review" };
    }
    const bytes = await object.arrayBuffer();
    return await runImageModerationProvider(env, policy, {
      bytes, mimeType: ticket.mimeType,
    });
  } catch {
    return { status: "needs_review", reason: "provider_unavailable" };
  }
}

// Never hand a pending asset a public R2 location. A failed copy leaves the
// ticket for operator intervention; this function does not approve on failure.
export async function publishModeratedUpload(bucket, stagingKey, publicKey,
  mimeType) {
  if (stagingKey !== moderatedStagingKey(publicKey)) {
    throw Error("publication_key_mismatch");
  }
  const staged = await bucket.get(stagingKey);
  if (!staged || Number(staged.size || 0) <= 0 ||
      Number(staged.size || 0) > 3 * 1024 * 1024) {
    throw Error("moderation_staged_object_unavailable");
  }
  await bucket.put(publicKey, staged.body, {
    httpMetadata: { contentType: mimeType },
  });
  // Staging removal is best-effort: leaving private bytes cannot publish them.
  await bucket.delete(stagingKey).catch(() => {});
}
