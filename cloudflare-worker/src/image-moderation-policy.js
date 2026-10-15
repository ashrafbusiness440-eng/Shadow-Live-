import { Buffer } from "node:buffer";

// Image safety providers are replaceable, but none is implicitly activated.
// Enabling publishing gates belongs to U6-L2; NEVER mistake a configured
// provider for a live moderation enforcement path.
// U6-L5/B: one server-side publication gate for owner settings AND uploads.
// A stored enabled=true value can never authorize AI usage before acceptance.
export const IMAGE_MODERATION_PUBLICATION_GATE_READY = false;
export const IMAGE_MODERATION_PATH = "system_config/image_moderation";
export const IMAGE_MODERATION_PROVIDERS = Object.freeze({
  cloudflare_vision: Object.freeze({
    mode: "free", model: "@cf/meta/llama-3.2-11b-vision-instruct",
    label: "فحص الصور عبر Cloudflare",
    billingUrl: "https://dash.cloudflare.com/",
  }),
  google_safesearch: Object.freeze({
    mode: "paid", model: "SAFE_SEARCH_DETECTION",
    label: "فحص الصور عبر Google Cloud Vision",
    billingUrl: "https://console.cloud.google.com/billing",
  }),
});
const SCOPES = Object.freeze(["public", "public_and_private"]);
const STATUSES = Object.freeze(["approved", "needs_review", "blocked"]);
const clean = (v) => String(v ?? "").trim();
export function defaultImageModerationPolicy() {
  return {
    enabled: false, scope: "public", mode: "free",
    provider: "cloudflare_vision", dailyLimit: 20,
    version: 0,
  };
}
export function validateImageModerationPolicy(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw Error("invalid_image_moderation_policy");
  const provider = clean(raw.provider);
  const spec = IMAGE_MODERATION_PROVIDERS[provider];
  const mode = clean(raw.mode);
  const scope = clean(raw.scope);
  const dailyLimit = Number(raw.dailyLimit);
  if (typeof raw.enabled !== "boolean" ||
      !spec || mode !== spec.mode || !SCOPES.includes(scope) ||
      !Number.isSafeInteger(dailyLimit) || dailyLimit < 1 ||
      dailyLimit > (mode === "free" ? 100 : 500) ||
      (mode === "paid" && raw.paidAcknowledged !== true && raw.enabled)) {
    throw Error("invalid_image_moderation_policy");
  }
  return { enabled: raw.enabled, scope, mode, provider, dailyLimit };
}

export function imageModerationProviderReady(env, provider) {
  if (provider === "cloudflare_vision")
    return typeof env?.AI?.run === "function";
  if (provider === "google_safesearch")
    return clean(env?.GOOGLE_VISION_API_KEY).length > 20;
  return false;
}

export function imageModerationApplies(policy, scope) {
  if (policy?.enabled !== true) return false;
  if (scope === "chat_image")
    return policy.scope === "public_and_private";
  return [
    "profile_image", "profile_avatar_animation", "profile_cover",
    "room_cover", "diary_image", "agency_logo", "agency_background",
    "agency_room_image",
  ].includes(scope);
}

// A provider result is advisory: no automatic account penalty. GIF/video
// require limited-frame review in U6-L2 and never silently pass.
export function moderatedImageDecision(input) {
  const status = clean(input?.status);
  if (!STATUSES.includes(status)) return {
    status: "needs_review", reason: "unrecognized_provider_response",
  };
  return { status, reason: clean(input.reason).slice(0, 90) || "image_policy" };
}

function parseVisionResponse(raw) {
  const output = clean(raw?.response || raw?.result?.response || "");
  // Exact single-token decision only; explanatory or conflicting text is review.
  const m = /^(SAFE|REVIEW|BLOCK)$/.exec(output);
  if (!m) return moderatedImageDecision({ status: "needs_review",
    reason: "uncertain_visual_assessment" });
  return moderatedImageDecision({
    status: m[1] === "SAFE" ? "approved"
      : m[1] === "BLOCK" ? "blocked" : "needs_review",
    reason: "provider_visual_assessment",
  });
}

export function classifyGoogleSafeSearch(raw) {
  const result = raw?.responses?.[0];
  if (result?.error || !result?.safeSearchAnnotation) {
    return moderatedImageDecision({ status: "needs_review",
      reason: "provider_unavailable_or_incomplete" });
  }
  const ann = result.safeSearchAnnotation;
  const isVery = (key) => ann[key] === "VERY_LIKELY";
  const isLikely = (key) => ann[key] === "LIKELY";
  // Only image content categories supported by Google SafeSearch.
  if (isVery("adult") || isVery("violence")) {
    return moderatedImageDecision({ status: "blocked",
      reason: "adult_or_violent_image_high_confidence" });
  }
  if (isLikely("adult") || isLikely("violence") ||
      isVery("racy") || isLikely("racy") ||
      ["POSSIBLE", "UNKNOWN", undefined, null].includes(ann.adult) ||
      ["POSSIBLE", "UNKNOWN", undefined, null].includes(ann.violence)) {
    return moderatedImageDecision({ status: "needs_review",
      reason: "possible_sensitive_visual_content" });
  }
  return moderatedImageDecision({ status: "approved", reason: "safe_search_clear" });
}

export async function runImageModerationProvider(env, policy, {
  bytes, mimeType,
}) {
  const mime = clean(mimeType).toLowerCase();
  const provider = clean(policy?.provider);
  if (!imageModerationProviderReady(env, provider))
    return moderatedImageDecision({ status: "needs_review",
      reason: "provider_not_configured" });
  if (!["image/jpeg", "image/png", "image/webp"].includes(mime) ||
      !bytes?.byteLength || bytes.byteLength > 3 * 1024 * 1024) {
    return moderatedImageDecision({ status: "needs_review",
      reason: "unsupported_image_or_animation" });
  }
  const encoded = Buffer.from(bytes).toString("base64");
  try {
    if (provider === "cloudflare_vision") {
      const raw = await env.AI.run(
        IMAGE_MODERATION_PROVIDERS.cloudflare_vision.model, {
          messages: [
            { role: "system", content: "You classify user-uploaded images for platform moderation. Return ONLY SAFE, REVIEW, or BLOCK. BLOCK only for clear explicit sexual imagery or graphic violence; REVIEW when uncertain, partial, medical, or ambiguous. SAFE only when visibly appropriate. Never infer account wrongdoing." },
            { role: "user", content: "Classify this image for publication." },
          ],
          image: `data:${mime};base64,${encoded}`,
          max_tokens: 16, temperature: 0,
        },
      );
      return parseVisionResponse(raw);
    }
    if (provider === "google_safesearch") {
      const response = await fetch(
        "https://vision.googleapis.com/v1/images:annotate", {
          method: "POST",
          headers: { "content-type": "application/json",
            "x-goog-api-key": clean(env.GOOGLE_VISION_API_KEY) },
          body: JSON.stringify({ requests: [{
            image: { content: encoded },
            features: [{ type: "SAFE_SEARCH_DETECTION", maxResults: 1 }],
          }] }),
          signal: AbortSignal.timeout(12_000),
        });
      if (!response.ok) throw Error("vision_unavailable");
      return classifyGoogleSafeSearch(await response.json());
    }
  } catch {
    return moderatedImageDecision({ status: "needs_review",
      reason: "provider_unavailable" });
  }
  return moderatedImageDecision({ status: "needs_review",
    reason: "unsupported_provider" });
}
