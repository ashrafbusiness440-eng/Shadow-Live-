import { Buffer } from "node:buffer";
import { verifyFirebaseIdToken, assertUserDocumentSessionState } from "./firebase-auth.js";
import { firestoreClient } from "./firestore.js";
import { json, firestoreQuotaResponse } from "./http.js";
import { readProtectedReportEvidence } from "./report-evidence-access.js";

const MAX_SCREENSHOT_BYTES = 150_000;
const MAX_REQUEST_BYTES = 215_000;
const REPORT_ATTACHMENT_WINDOW_MS = 5 * 60_000;
const safeId = (id) => /^[A-Za-z0-9_-]{1,512}$/.test(String(id || ""));
const clean = (v) => String(v ?? "").trim();

export class ReportScreenshotError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

// The image is a user-originated visual illustration, NOT a verified
// statement of room or chat history. Verified chat/room data stays on its
// existing server path and is never replaced with client supplied metadata.
export function parseReportScreenshot(input) {
  if (typeof input !== "string" || input.length < 8 ||
      input.length > Math.ceil(MAX_SCREENSHOT_BYTES / 3) * 4 + 8 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(input)) {
    throw new ReportScreenshotError("invalid_report_screenshot");
  }
  const bytes = Buffer.from(input, "base64");
  const canonical = bytes.toString("base64");
  if (!bytes.length || bytes.length > MAX_SCREENSHOT_BYTES ||
      canonical !== input ||
      bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff ||
      bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) {
    throw new ReportScreenshotError("invalid_report_screenshot");
  }
  return bytes;
}

function timeMs(v) {
  if (v instanceof Date) return v.getTime();
  if (typeof v === "number") return v;
  return Date.parse(String(v || "")) || 0;
}

export function validateReportScreenshotTarget(record, uid, nowMs = Date.now()) {
  if (!record || clean(record.reporterUid || record.reporterId) !== uid) {
    throw new ReportScreenshotError("forbidden", 403);
  }
  const status = clean(record.status || "new");
  if (!["new", "open", "under_review"].includes(status)) {
    throw new ReportScreenshotError("report_already_closed", 409);
  }
  const createdAtMs = timeMs(record.createdAt);
  if (!createdAtMs || createdAtMs > nowMs + 30_000 ||
      nowMs - createdAtMs > REPORT_ATTACHMENT_WINDOW_MS) {
    throw new ReportScreenshotError("report_attachment_expired", 410);
  }
  if (record.evidence?.clientScreenshot || record.screenshotObjectId) {
    throw new ReportScreenshotError("report_screenshot_exists", 409);
  }
  const t = clean(record.targetType);
  const isPrivate = clean(record.source) === "private_chat" &&
    Boolean(clean(record.conversationId));
  const isRoom = ["room_message", "room"].includes(t) &&
    Boolean(clean(record.roomId));
  if (!isPrivate && !isRoom) {
    throw new ReportScreenshotError("invalid_report_source", 400);
  }
}

// R2 data never receives a public URL or presigned GET, and only one
// capture can be linked to a report. Transaction re-check protects concurrent
// attempts; failed commits delete the unused blob best-effort.
export async function attachReportScreenshot(db, bucket, uid, {
  reportId, imageBase64,
}, now = new Date()) {
  if (!safeId(reportId)) throw new ReportScreenshotError("invalid_report_id");
  if (!bucket?.put || !bucket?.delete) {
    throw new ReportScreenshotError("r2_not_configured", 503);
  }
  const bytes = parseReportScreenshot(imageBase64);
  const tx = await db.beginTransaction();
  let storageKey = "";
  let committed = false;
  try {
    const path = "reports/" + reportId;
    const snapshot = await db.get(path, tx);
    if (!snapshot.exists) throw new ReportScreenshotError("report_not_found", 404);
    const record = snapshot.data || {};
    validateReportScreenshotTarget(record, uid, now.getTime());
    const objectId = crypto.randomUUID();
    storageKey = `report-evidence/${reportId}/${objectId}.jpg`;
    await bucket.put(storageKey, bytes, {
      httpMetadata: { contentType: "image/jpeg" },
    });
    const receipt = {
      objectId,
      storageKey,
      mimeType: "image/jpeg",
      byteLength: bytes.length,
      capturedBy: uid,
      source: "client_capture_unverified",
      addedAt: now,
    };
    await db.commit(tx, [
      db.writeUpdate(path, {
        evidence: {
          ...(record.evidence && typeof record.evidence === "object"
            ? record.evidence : {}),
          clientScreenshot: receipt,
        },
        updatedAt: now,
      }, ["evidence", "updatedAt"]),
      db.writeCreate("admin_audit_logs/report_screenshot_attach_" + objectId, {
        action: "attachClientReportScreenshot",
        actorUid: uid,
        reportId,
        objectId,
        createdAt: now,
        provenance: "client_capture_unverified",
      }),
    ]);
    committed = true;
    return { ok: true, reportId, screenshotAttached: true };
  } catch (error) {
    await db.rollback(tx).catch(() => {});
    if (storageKey && !committed) {
      await bucket.delete(storageKey).catch(() => {});
    }
    throw error;
  }
}

// Call ONLY after the existing recent-auth and viewReportEvidence gate.
// readProtectedReportEvidence performs a mandatory audit BEFORE any R2 GET.
export async function openReportScreenshot(db, env, actorUid, reportId) {
  if (!safeId(reportId)) throw new ReportScreenshotError("invalid_report_id");
  const proof = await readProtectedReportEvidence(db, {
    collection: "reports", reportId, actorUid,
  });
  const stored = proof.evidence?.clientScreenshot;
  if (!stored || stored.source !== "client_capture_unverified" ||
      !/^[a-f0-9-]{36}$/.test(clean(stored.objectId)) ||
      stored.storageKey !==
        `report-evidence/${reportId}/${stored.objectId}.jpg` ||
      stored.mimeType !== "image/jpeg" ||
      !(Number(stored.byteLength) > 0) ||
      Number(stored.byteLength) > MAX_SCREENSHOT_BYTES) {
    throw new ReportScreenshotError("report_screenshot_not_found", 404);
  }
  if (!env?.USER_STORAGE?.get) {
    throw new ReportScreenshotError("r2_not_configured", 503);
  }
  const object = await env.USER_STORAGE.get(stored.storageKey);
  if (!object || Number(object.size) !== Number(stored.byteLength)) {
    throw new ReportScreenshotError("report_screenshot_unavailable", 404);
  }
  const bytes = Buffer.from(await object.arrayBuffer());
  if (bytes.length !== Number(stored.byteLength)) {
    throw new ReportScreenshotError("report_screenshot_unavailable", 404);
  }
  return {
    ok: true, reportId, imageBase64: bytes.toString("base64"),
    mimeType: "image/jpeg", source: "client_capture_unverified",
  };
}

export async function reportScreenshot(request, env) {
  if (request.method !== "POST") {
    return json(request, env, { ok: false, code: "method_not_allowed" }, 405);
  }
  try {
    const len = Number(request.headers.get("content-length") || 0);
    if (len > MAX_REQUEST_BYTES) {
      throw new ReportScreenshotError("screenshot_too_large", 413);
    }
    const raw = await request.text();
    if (raw.length > MAX_REQUEST_BYTES) {
      throw new ReportScreenshotError("screenshot_too_large", 413);
    }
    let body = {};
    try { body = JSON.parse(raw); } catch {
      throw new ReportScreenshotError("invalid_request");
    }
    if (body?.action !== "attach") {
      throw new ReportScreenshotError("invalid_action");
    }
    const decoded = await verifyFirebaseIdToken(request, env, {
      checkUserState: false,
    });
    const uid = clean(decoded.sub);
    if (!uid) throw new ReportScreenshotError("unauthorized", 401);
    const db = firestoreClient(env);
    const user = await db.get("users/" + uid);
    if (!user.exists) throw new ReportScreenshotError("unauthorized", 401);
    assertUserDocumentSessionState(decoded, user.data || {});
    const result = await attachReportScreenshot(db, env.USER_STORAGE, uid, {
      reportId: body.reportId, imageBase64: body.imageBase64,
    });
    return json(request, env, result);
  } catch (error) {
    const quota = firestoreQuotaResponse(request, env, error);
    if (quota) return quota;
    const code = clean(error?.code || error?.message);
    const status = error instanceof ReportScreenshotError
      ? error.status : code === "unauthorized" ? 401 : 500;
    return json(request, env, {
      ok: false,
      code: error instanceof ReportScreenshotError ? error.code
        : code === "unauthorized" ? "unauthorized" : "report_screenshot_failed",
    }, status);
  }
}

export const reportScreenshotTestHooks = Object.freeze({
  validateReportScreenshotTarget, parseReportScreenshot,
  attachReportScreenshot, openReportScreenshot,
});
