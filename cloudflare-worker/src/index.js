// Phase 8 comprehensive E2E deployment marker v2
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
import { googlePlayPurchase } from "./google-play-purchase.js";
import { manageAppAsset } from "./manage-app-asset.js";
import { economyRouter } from "./economy-router.js";
import { configureLegacyEnv, getFirestore } from "./legacy-firebase-admin-shim.js";
import { settleDueGameOperations } from "./legacy-games/game-runtime.js";

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
        version: 14,
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
    if (url.pathname === "/api/google-play-purchase") {
      return googlePlayPurchase(request, env);
    }
    if (url.pathname === "/api/manage-app-asset") {
      return manageAppAsset(request, env);
    }
    if (url.pathname === "/api/economy-router") {
      return economyRouter(request, env);
    }
    const economyAliases = {
      "/api/economy-control": "economy-control",
      "/api/gift-catalog": "gift-catalog",
      "/api/gift-economy-config": "gift-economy-config",
      "/api/recharge-config": "recharge-config",
      "/api/room-rocket-config": "room-rocket-config",
      "/api/room-rocket": "room-rocket",
      "/api/reward-inventory": "reward-inventory",
      "/api/game-runtime": "game-runtime",
      "/api/game-control": "game-control",
    };
    if (economyAliases[url.pathname]) {
      return economyRouter(request, env, economyAliases[url.pathname]);
    }

    return json(request, env, { ok: false, code: "route_not_found" }, 404);
  },
  async scheduled(event, env, ctx) {
    configureLegacyEnv(env);
    const db = getFirestore();
    const marker = db.collection("system_runtime").doc("game_settlement_cron");
    try {
      const result = await settleDueGameOperations(db, {
        nowMs: Date.now(),
        limit: 100,
        workerTag: "cloudflare_cron",
      });
      if (result.checked > 0) {
        await marker.set({
          lastRunAtMs: Date.now(),
          checked: Number(result.checked || 0),
          settled: Number(result.settled || 0),
          lastError: "",
        }, { merge: true });
      }
      console.log("Cloudflare game settlement cron", JSON.stringify(result));
    } catch (error) {
      const code = String(error?.message || "cron_failed");
      try {
        await marker.set({
          lastRunAtMs: Date.now(),
          checked: 0,
          settled: 0,
          lastError: code.slice(0, 240),
        }, { merge: true });
      } catch (_) {}
      console.error("Cloudflare game settlement cron failed", code);
      throw error;
    }
  },
};
