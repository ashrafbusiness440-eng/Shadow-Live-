import { corsHeaders, json } from "./http.js";
import { adjustBalance } from "./adjust-balance.js";
import { appAssets } from "./app-assets.js";
import { changePublicId } from "./change-public-id.js";
import { setIdManagementPermission } from "./set-id-management-permission.js";
import { walletActions } from "./wallet-actions.js";
import { chatSafetyActions } from "./chat-safety-actions.js";
import { storageHealth } from "./storage-health.js";
import { roomGift } from "./room-gift.js";
import { voiceSession } from "./voice-session.js";

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(request, env),
      });
    }

    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/health") {
      return json(request, env, {
        ok: true,
        service: "shadow-live-cloudflare-worker",
        version: 8,
        buildSha: env.BUILD_SHA || null,
        firebaseConfigured: Boolean(String(env.FIREBASE_SERVICE_ACCOUNT || "").trim()),
      });
    }

    if (url.pathname === "/api/adjust-balance") {
      return adjustBalance(request, env);
    }
    if (url.pathname === "/api/app-assets") {
      return appAssets(request, env);
    }
    if (url.pathname === "/api/change-public-id") {
      return changePublicId(request, env);
    }
    if (url.pathname === "/api/set-id-management-permission") {
      return setIdManagementPermission(request, env);
    }
    if (url.pathname === "/api/wallet-actions") {
      return walletActions(request, env);
    }
    if (url.pathname === "/api/chat-actions") {
      return chatSafetyActions(request, env);
    }
    if (url.pathname === "/api/storage-health") {
      return storageHealth(request, env);
    }
    if (url.pathname === "/api/room-gift") {
      return roomGift(request, env);
    }
    if (url.pathname === "/api/voice-session") {
      return voiceSession(request, env);
    }

    return json(request, env, { ok: false, code: "route_not_found" }, 404);
  },
};
