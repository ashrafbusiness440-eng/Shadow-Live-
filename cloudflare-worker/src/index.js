// Pressure Root Fix Step 11 observability marker
import { corsHeaders, json } from "./http.js";
import { adjustBalance } from "./adjust-balance.js";
import { appAssets } from "./app-assets.js";
import { changePublicId } from "./change-public-id.js";
import { setIdManagementPermission } from "./set-id-management-permission.js";
import { manageUserAccess } from "./manage-user-access.js";
import { manageUserAccount, releaseExpiredSuspensions } from "./manage-user-account.js";
import { controlUserDetails } from "./control-user-details.js";
import { walletActions } from "./wallet-actions.js";
import { chatSafetyActions } from "./chat-safety-actions.js";
import { storageHealth } from "./storage-health.js";
import { roomGift } from "./room-gift.js";
import { voiceSession } from "./voice-session.js";
import { roomRealtime } from "./room-realtime.js";
import { googlePlayPurchase } from "./google-play-purchase.js";
import { manageAppAsset } from "./manage-app-asset.js";
import { economyRouter } from "./economy-router.js";
import { configureLegacyEnv, getFirestore } from "./legacy-firebase-admin-shim.js";
import { settleDueGameOperations } from "./legacy-games/game-runtime.js";
import {
  annotatePressureRequest,
  recordRequestTelemetry,
  writePressureDataPoint,
} from "./pressure-telemetry.js";

export { RoomRealtimeObject } from "./room-realtime-object.js";

async function dispatchRequest(request, env) {
  const url = new URL(request.url);
  annotatePressureRequest(request, { route: url.pathname });

  if (request.method === "OPTIONS") {
    annotatePressureRequest(request, { action: "cors_preflight" });
    return new Response(null, {
      status: 204,
      headers: corsHeaders(request, env),
    });
  }

  if (url.pathname === "/" || url.pathname === "/health") {
    annotatePressureRequest(request, { action: "health" });
    return json(request, env, {
      ok: true,
      service: "shadow-live-cloudflare-worker",
      version: 29,
      buildSha: env.BUILD_SHA || null,
      firebaseConfigured: Boolean(String(env.FIREBASE_SERVICE_ACCOUNT || "").trim()),
      pressureAnalyticsConfigured: Boolean(env.PRESSURE_ANALYTICS),
      realtimeAdmissionConfigured: Boolean(
        String(env.ZEGO_SERVER_SECRET || "").trim(),
      ),
    });
  }

  if (url.pathname === "/api/adjust-balance") {
    annotatePressureRequest(request, { action: "adjustBalance" });
    return adjustBalance(request, env);
  }
  if (url.pathname === "/api/app-assets") {
    return appAssets(request, env);
  }
  if (url.pathname === "/api/change-public-id") {
    annotatePressureRequest(request, { action: "changePublicId" });
    return changePublicId(request, env);
  }
  if (url.pathname === "/api/set-id-management-permission") {
    annotatePressureRequest(request, { action: "setIdManagementPermission" });
    return setIdManagementPermission(request, env);
  }
  if (url.pathname === "/api/manage-user-access") {
    return manageUserAccess(request, env);
  }
  if (url.pathname === "/api/manage-user-account") {
    return manageUserAccount(request, env);
  }
  if (url.pathname === "/api/control-user-details") {
    return controlUserDetails(request, env);
  }
  if (url.pathname === "/api/wallet-actions") {
    return walletActions(request, env);
  }
  if (url.pathname === "/api/chat-actions") {
    return chatSafetyActions(request, env);
  }
  if (url.pathname === "/api/storage-health") {
    annotatePressureRequest(request, { action: "storageHealth" });
    return storageHealth(request, env);
  }
  if (url.pathname === "/api/room-gift") {
    annotatePressureRequest(request, { action: "sendRoomGift" });
    return roomGift(request, env);
  }
  if (url.pathname === "/api/voice-session") {
    return voiceSession(request, env);
  }
  if (url.pathname === "/api/room-realtime") {
    return roomRealtime(request, env);
  }
  if (url.pathname === "/api/google-play-purchase") {
    annotatePressureRequest(request, { action: "googlePlayPurchase" });
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
    annotatePressureRequest(request, { action: economyAliases[url.pathname] });
    return economyRouter(request, env, economyAliases[url.pathname]);
  }

  annotatePressureRequest(request, { action: "route_not_found" });
  return json(request, env, { ok: false, code: "route_not_found" }, 404);
}

export default {
  async fetch(request, env) {
    const startedAtMs = Date.now();
    try {
      const response = await dispatchRequest(request, env);
      recordRequestTelemetry(request, env, response, startedAtMs);
      return response;
    } catch (error) {
      recordRequestTelemetry(request, env, null, startedAtMs, error);
      throw error;
    }
  },

  async scheduled(event, env, ctx) {
    configureLegacyEnv(env);
    const startedAtMs = Date.now();
    try {
      const moderation = await releaseExpiredSuspensions(env);
      if (moderation.released > 0) {
        console.log("Released expired suspensions", JSON.stringify(moderation));
      }
    } catch (error) {
      console.error("Expired suspension release failed", String(error?.message || error));
    }

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
      writePressureDataPoint(env, {
        kind: "cron",
        primary: "game_settlement",
        action: "sweep",
        outcome: "ok",
        durationMs: Date.now() - startedAtMs,
        fanout: Number(result.checked || 0),
      });
      console.log("Cloudflare game settlement cron", JSON.stringify(result));
    } catch (error) {
      const code = String(error?.message || "cron_failed");
      writePressureDataPoint(env, {
        kind: "cron",
        primary: "game_settlement",
        action: "sweep",
        outcome: code.slice(0, 80),
        durationMs: Date.now() - startedAtMs,
        error: 1,
        quota: code.includes("quota") || code.includes("RESOURCE_EXHAUSTED"),
      });
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
