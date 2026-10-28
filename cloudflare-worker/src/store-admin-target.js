// Shared authorized Store admin target resolution.
// Caller MUST authenticate and authorize the actor before invoking this helper.
export const cleanStoreId = value => String(value ?? "").trim();
export const validStoreUid = value =>
  /^[A-Za-z0-9_-]{1,128}$/.test(cleanStoreId(value));

export function hasRecentStoreAdminLogin(payload, nowMs=Date.now()) {
  const age=Math.floor(nowMs/1000)-Number(payload?.auth_time || 0);
  return Number.isFinite(age) && age>=0 && age<=1800;
}

export async function resolveStoreAdminTarget(db, rawId) {
  const searchedId=cleanStoreId(rawId);
  const normalizedId=searchedId
    .replace(/[٠-٩]/g,ch=>String(ch.charCodeAt(0)-0x0660))
    .replace(/[۰-۹]/g,ch=>String(ch.charCodeAt(0)-0x06F0));
  if (!validStoreUid(normalizedId)) throw Error("invalid_target_id");
  const byPublicId=/^[0-9]{3,8}$/.test(normalizedId);
  let targetUid=normalizedId;
  if (byPublicId) {
    const registry=await db.get(`public_ids/${normalizedId}`);
    targetUid=cleanStoreId(registry.data?.uid);
    if (!registry.exists || !validStoreUid(targetUid)) throw Error("not_found");
  }
  const target=await db.get(`users/${targetUid}`);
  if (!target.exists ||
      (byPublicId && cleanStoreId(target.data?.publicId)!==normalizedId)) {
    throw Error("not_found");
  }
  return {targetUid,searchedId};
}
