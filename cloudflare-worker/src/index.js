// Pressure Root Fix Step 11 observability marker
import { corsHeaders, json } from "./http.js";
import { adjustBalance } from "./adjust-balance.js";
import { appAssets } from "./app-assets.js";
import { authConfig } from "./auth-config.js";
import { runDueAccountDeletionReviews } from "./account-deletion-review.js";
import { accountDeletion } from "./account-deletion.js";
import { privateVoiceControl } from "./private-voice-control.js";
import { contentFilterControl } from "./content-filter-control.js";
import { imageModerationControl } from "./image-moderation-control.js";
import { CONTENT_FILTER_COORDINATOR_ID } from "./content-filter.js";
import { changePublicId } from "./change-public-id.js";
import { setIdManagementPermission } from "./set-id-management-permission.js";
import { manageUserAccess } from "./manage-user-access.js";
import { manageUserLevel } from "./manage-user-level.js";
import { manageVipLevel } from "./manage-vip-level.js";
import { manageVipInformation } from "./manage-vip-information.js";
import { manageUserAccount, releaseExpiredSuspensions } from "./manage-user-account.js";
import { controlUserDetails } from "./control-user-details.js";
import { walletActions } from "./wallet-actions.js";
import { vipActions } from "./vip-actions.js";
import { vipFancyId } from "./vip-fancy-id.js";
import { profileVisits } from "./profile-visits.js";
import { mysteriousPerson } from "./mysterious-person.js";
import { manageMysteriousPerson } from "./manage-mysterious-person.js";
import { chatSafetyActions } from "./chat-safety-actions.js";
import { privateVoiceMedia, runPrivateVoiceDraftCleanup } from "./private-voice-media.js";
import { privateCallSignaling, runPrivateCallTimeoutCleanup } from "./private-call-signaling.js";
import { privateCallPushDevices } from "./private-call-push.js";
import { storageHealth } from "./storage-health.js";
import { systemHealth } from "./system-health.js";
import { publicMediaRedirect } from "./public-media.js";
import { runDueStorageCleanup, userStorage } from "./user-storage.js";
import { runDueReportEvidenceCleanup } from "./report-evidence-retention.js";
import { roomGift } from "./room-gift.js";
import { voiceSession } from "./voice-session.js";
import { roomRealtime } from "./room-realtime.js";
import { googlePlayPurchase } from "./google-play-purchase.js";
import { manageAppAsset } from "./manage-app-asset.js";
import { manageStoreCatalog } from "./manage-store-catalog.js";
import { publicStoreCatalog } from "./public-store-catalog.js";
import { storePurchase, myStoreItems } from "./store-entitlements.js";
import { manageStoreInventory } from "./manage-store-inventory.js";
import { manageStoreAudit } from "./manage-store-audit.js";
import { manageStorePurchases } from "./manage-store-purchases.js";
import { manageStoreGrantPreview } from "./manage-store-grant-preview.js";
import { manageStoreGrantIssue } from "./manage-store-grant-issue.js";
import { economyRouter } from "./economy-router.js";
import { agencyApplication } from "./agency-application.js";
import { agencyControl } from "./agency-control.js";
import { agencyMembership } from "./agency-membership.js";
import { agencyPublic } from "./agency-public.js";
import { agencyHost } from "./agency-host.js";
import { agencyOwner } from "./agency-owner.js";
import { agencyPackages } from "./agency-packages.js";
import { relationships } from "./relationships.js";
import { diaries } from "./diaries.js";
import { diaryModeration } from "./diary-moderation.js";
import { adminInbox } from "./admin-inbox.js";
import { generalReports } from "./general-reports.js";
import { reportScreenshot } from "./report-screenshot.js";
import { userLevelSummary } from "./user-level-summary.js";
import { configureLegacyEnv, getFirestore } from "./legacy-firebase-admin-shim.js";
import { firestoreClient } from "./firestore.js";
import { settleDueGameOperations } from "./legacy-games/game-runtime.js";
import {
  annotatePressureRequest,
  recordRequestTelemetry,
  writePressureDataPoint,
} from "./pressure-telemetry.js";

export { RoomRealtimeObject } from "./room-realtime-object.js";

async function dispatchRequest(request, env, ctx) {
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
      version: 28,
      buildSha: env.BUILD_SHA || null,
      firebaseConfigured: Boolean(String(env.FIREBASE_SERVICE_ACCOUNT || "").trim()),
      pressureAnalyticsConfigured: Boolean(env.PRESSURE_ANALYTICS),
    });
  }

  if (url.pathname === "/api/adjust-balance") {
    annotatePressureRequest(request, { action: "adjustBalance" });
    return adjustBalance(request, env);
  }
  if (url.pathname === "/api/app-assets") {
    return appAssets(request, env);
  }
  if (url.pathname === "/api/auth-config") {
    return authConfig(request, env);
  }
  if (url.pathname === "/api/account-deletion") {
    annotatePressureRequest(request, { action: "accountDeletion" });
    return accountDeletion(request, env);
  }
  if (url.pathname === "/api/private-voice-control") {
    return privateVoiceControl(request, env);
  }
  if (url.pathname === "/api/content-filter-control") {
    return contentFilterControl(request, env);
  }
  if (url.pathname === "/api/image-moderation-control") {
    return imageModerationControl(request, env);
  }
  if (url.pathname === "/api/change-public-id") {
    annotatePressureRequest(request, { action: "changePublicId" });
    return changePublicId(request, env);
  }
  if (url.pathname === "/api/set-id-management-permission") {
    annotatePressureRequest(request, { action: "setIdManagementPermission" });
    return setIdManagementPermission(request, env);
  }
  if (url.pathname === "/api/manage-store-catalog") {
    return manageStoreCatalog(request, env);
  }
  if (url.pathname === "/api/store-catalog") {
    return publicStoreCatalog(request, env);
  }
  if (url.pathname === "/api/store-purchase") {
    return storePurchase(request, env);
  }
  if (url.pathname === "/api/my-store-items") {
    return myStoreItems(request, env);
  }
  if (url.pathname === "/api/manage-store-inventory") {
    return manageStoreInventory(request, env);
  }
  if (url.pathname === "/api/manage-store-audit") {
    return manageStoreAudit(request, env);
  }
  if (url.pathname === "/api/manage-store-purchases") {
    return manageStorePurchases(request, env);
  }
  if (url.pathname === "/api/manage-store-grant-preview") {
    return manageStoreGrantPreview(request, env);
  }
  if (url.pathname === "/api/manage-store-grant-issue") {
    return manageStoreGrantIssue(request, env);
  }
  if (url.pathname === "/api/manage-user-access") {
    return manageUserAccess(request, env);
  }
  if (url.pathname === "/api/manage-user-level") {
    annotatePressureRequest(request, { action: "manageUserLevel" });
    return manageUserLevel(request, env);
  }
  if (url.pathname === "/api/manage-vip-level") {
    annotatePressureRequest(request, { action: "manageVipLevel" });
    return manageVipLevel(request, env);
  }
  if (url.pathname === "/api/manage-vip-information") {
    annotatePressureRequest(request, { action: "manageVipInformation" });
    return manageVipInformation(request, env);
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
  if (url.pathname === "/api/vip") {
    annotatePressureRequest(request, { action: "vip" });
    return vipActions(request, env);
  }
  if (url.pathname === "/api/vip-fancy-id") {
    annotatePressureRequest(request, { action: "vipFancyId" });
    return vipFancyId(request, env);
  }
  if (url.pathname === "/api/profile-visits") {
    annotatePressureRequest(request, { action: "profileVisits" });
    return profileVisits(request, env);
  }
  if (url.pathname === "/api/mysterious-person") {
    annotatePressureRequest(request, { action: "mysteriousPerson" });
    return mysteriousPerson(request, env);
  }
  if (url.pathname === "/api/manage-mysterious-person") {
    annotatePressureRequest(request, { action: "manageMysteriousPerson" });
    return manageMysteriousPerson(request, env);
  }
  if (url.pathname === "/api/chat-actions") {
    return chatSafetyActions(request, env, ctx);
  }
  if (url.pathname === "/api/private-voice-media") {
    return privateVoiceMedia(request, env);
  }
  if (url.pathname === "/api/private-call-signaling") {
    return privateCallSignaling(request, env, ctx);
  }
  if (url.pathname === "/api/private-call-push-devices") {
    return privateCallPushDevices(request, env);
  }
  if (url.pathname === "/api/storage-health") {
    annotatePressureRequest(request, { action: "storageHealth" });
    return storageHealth(request, env);
  }
  if (url.pathname === "/api/system-health") {
    annotatePressureRequest(request, { action: "systemHealth" });
    return systemHealth(request, env);
  }
  if (url.pathname === "/api/user-storage") {
    annotatePressureRequest(request, { action: "userStorage" });
    return userStorage(request, env);
  }
  if (url.pathname.startsWith("/api/public-media/")) {
    annotatePressureRequest(request, { action: "publicMediaRedirect" });
    return publicMediaRedirect(request, env);
  }
  if (url.pathname === "/api/room-gift") {
    annotatePressureRequest(request, { action: "sendRoomGift" });
    return roomGift(request, env, ctx);
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
  if (url.pathname === "/api/agency-application") {
    annotatePressureRequest(request, { action: "agencyApplication" });
    return agencyApplication(request, env);
  }
  if (url.pathname === "/api/agency-control") {
    annotatePressureRequest(request, { action: "agencyControl" });
    return agencyControl(request, env);
  }
  if (url.pathname === "/api/agency-membership") {
    annotatePressureRequest(request, { action: "agencyMembership" });
    return agencyMembership(request, env);
  }
  if (url.pathname === "/api/agency-public") {
    annotatePressureRequest(request, { action: "agencyPublic" });
    return agencyPublic(request, env);
  }
  if (url.pathname === "/api/agency-host") {
    annotatePressureRequest(request, { action: "agencyHost" });
    return agencyHost(request, env);
  }
  if (url.pathname === "/api/agency-owner") {
    annotatePressureRequest(request, { action: "agencyOwner" });
    return agencyOwner(request, env);
  }
  if (url.pathname === "/api/agency-packages") {
    annotatePressureRequest(request, { action: "agencyPackages" });
    return agencyPackages(request, env);
  }
  if (url.pathname === "/api/relationships") {
    annotatePressureRequest(request, { action: "relationships" });
    return relationships(request, env);
  }
  if (url.pathname === "/api/diaries") {
    annotatePressureRequest(request, { action: "diaries" });
    return diaries(request, env);
  }
  if (url.pathname === "/api/diary-moderation") {
    annotatePressureRequest(request, { action: "diaryModeration" });
    return diaryModeration(request, env);
  }
  if (url.pathname === "/api/report-screenshot") {
    return reportScreenshot(request, env);
  }
  if (url.pathname === "/api/general-reports") {
    return generalReports(request, env);
  }
  if (url.pathname === "/api/admin-inbox") {
    annotatePressureRequest(request, { action: "adminInbox" });
    return adminInbox(request, env);
  }
  if (url.pathname === "/api/user-level") {
    annotatePressureRequest(request, { action: "userLevelSummary" });
    return userLevelSummary(request, env);
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
  async fetch(request, env, ctx) {
    const startedAtMs = Date.now();
    try {
      const response = await dispatchRequest(request, env, ctx);
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

    try {
      const storageCleanup = await runDueStorageCleanup(env, {
        nowMs: Date.now(),
        limit: 25,
      });
      if (storageCleanup.checked > 0) {
        console.log(
          "Cloudflare R2 delayed cleanup",
          JSON.stringify(storageCleanup),
        );
      }
      writePressureDataPoint(env, {
        kind: "cron",
        primary: "r2_storage_cleanup",
        action: "delete_due",
        outcome: storageCleanup.failed > 0 ? "partial" : "ok",
        durationMs: Date.now() - startedAtMs,
        fanout: Number(storageCleanup.checked || 0),
        error: Number(storageCleanup.failed || 0),
      });
    } catch (error) {
      console.error(
        "Cloudflare R2 delayed cleanup failed",
        String(error?.message || error),
      );
    }

    // Bounded orphan prevention for never-sent private R2 voice drafts.
    // Sent messages remove the queue item transactionally.
    try {
      const drafts = await runPrivateVoiceDraftCleanup(env, {
        nowMs: Date.now(), limit: 10,
      });
      if (drafts.checked || drafts.failed) {
        console.log("Private voice orphan cleanup", JSON.stringify(drafts));
      }
    } catch (error) {
      console.error("Private voice cleanup failed", String(error?.message || error));
    }

    // Call routing remains disabled by default. Skip even the one bounded
    // Firestore cron query until the private media rollout is ready.
    if (env.PRIVATE_CALL_MEDIA_READY === "true") {
      try {
        const calls = await runPrivateCallTimeoutCleanup(env, Date.now());
        if (calls.checked || calls.failed) {
          console.log("Private call ring cleanup", JSON.stringify(calls));
        }
      } catch (error) {
        console.error("Private call ring cleanup failed", String(error?.message || error));
      }
    }

    // U6: reuse existing 5-minute cron only at the hourly boundary.
    // Each run makes three bounded index queries (max 20 each), never a scan.
    const schedule = new Date(Number(event?.scheduledTime || Date.now()));
    if (schedule.getUTCMinutes() === 0) {
      try {
        const reports = await runDueReportEvidenceCleanup(env, {
          nowMs: Date.now(), limit: 20,
        });
        if (reports.checked || reports.failed) {
          console.log("Evidence retention hourly cleanup",
            JSON.stringify(reports));
        }
      } catch (error) {
        console.error("Evidence retention cleanup failed",
          String(error?.message || "failed").slice(0, 100));
      }
    }

    // Manual rollout gate: no extra Firestore scan or user-data mutation in
    // production before retention-policy review and composite-index readiness.
    // Reuse the existing hourly cron; never create a new timer or listener.
    if (schedule.getUTCMinutes() === 0 &&
        env.ACCOUNT_DELETION_REVIEW_READY === "true") {
      try {
        const review = await runDueAccountDeletionReviews(
          firestoreClient(env), { nowMs: Date.now(), limit: 6 },
        );
        if (review.checked || review.failed) {
          console.log("Account deletion review queue",
            JSON.stringify(review));
        }
      } catch (error) {
        console.error("Account deletion review unavailable",
          String(error?.message || "failed").slice(0, 100));
      }
    }

    if (schedule.getUTCMinutes() === 0 && env?.ROOM_REALTIME) {
      try {
        const coordinator = env.ROOM_REALTIME.get(
          env.ROOM_REALTIME.idFromName(CONTENT_FILTER_COORDINATOR_ID));
        const response = await coordinator.fetch(
          "https://internal/filter/flag/purge", { method: "POST" });
        if (!response.ok) throw new Error("room_flag_purge_failed");
        const result = await response.json();
        if (result.purged) {
          console.log("Room filtered evidence expired",
            JSON.stringify({ checked: result.checked, purged: result.purged }));
        }
      } catch (error) {
        console.error("Room filtered evidence cleanup failed",
          String(error?.message || "failed").slice(0, 80));
      }
    }

    const db = getFirestore();
    const marker = db.collection("system_runtime").doc("game_settlement_cron");
    try {
      const result = await settleDueGameOperations(db, {
        nowMs: Date.now(),
        limit: 25,
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
