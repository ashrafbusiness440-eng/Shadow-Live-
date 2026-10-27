// Availability policy for the existing Gift Catalog. Checked on authoritative
// transaction-time server reads, without polling, cron or client-trusted clocks.
export const GIFT_CONTEXTS = Object.freeze(["room", "chat", "diary"]);
const maxDateMs = 8640000000000000;

export function validateGiftAvailability(item = {}) {
  const raw = item.allowedContexts;
  const allowedContexts = raw === undefined || raw === null
    ? [...GIFT_CONTEXTS] : raw;
  if (!Array.isArray(allowedContexts) || allowedContexts.length === 0 ||
      allowedContexts.length > GIFT_CONTEXTS.length ||
      new Set(allowedContexts).size !== allowedContexts.length ||
      allowedContexts.some((value) => !GIFT_CONTEXTS.includes(value))) {
    throw Error("invalid_gift_contexts");
  }

  const fromMs = item.visibleFromMs == null ? 0 : Number(item.visibleFromMs);
  const untilMs = item.visibleUntilMs == null ? 0 : Number(item.visibleUntilMs);
  for (const value of [fromMs, untilMs]) {
    if (!Number.isSafeInteger(value) || value < 0 || value > maxDateMs) {
      throw Error("invalid_gift_schedule");
    }
  }
  if (untilMs > 0 && fromMs > 0 && untilMs <= fromMs) {
    throw Error("invalid_gift_schedule");
  }
  return { allowedContexts: [...allowedContexts], visibleFromMs: fromMs, visibleUntilMs: untilMs };
}

export function giftAvailableFor(gift = {}, context = null, nowMs = Date.now()) {
  if (gift?.enabled === false) return false;
  if (typeof context === "string" && !GIFT_CONTEXTS.includes(context)) return false;
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) return false;
  // Fail closed for malformed published availability rather than bypassing it.
  let policy;
  try { policy = validateGiftAvailability(gift); }
  catch { return false; }
  if (context && !policy.allowedContexts.includes(context)) return false;
  if (policy.visibleFromMs > 0 && nowMs < policy.visibleFromMs) return false;
  if (policy.visibleUntilMs > 0 && nowMs >= policy.visibleUntilMs) return false;
  return true;
}
