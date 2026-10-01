import { firestoreQuotaResponse, json, readJson } from "./http.js";
import { verifyFirebaseIdToken } from "./firebase-auth.js";
import {
  firestoreClient,
  firestoreErrorRetryDelayMs,
  isTransientFirestoreError,
} from "./firestore.js";
import { platformAgencyPermissions } from "./agency-permissions.js";

const clean = (value) => String(value ?? "").trim();
const TEMPLATE_LIMIT = 100;
const LINE_LIMIT = 40;
const LIST_LIMIT = 25;
const MAX_DURATION_HOURS = 24 * 365;
const MAX_LINE_QUANTITY = 1000;
const COSMETIC_TYPES = new Set(["frame", "entrance", "room_background"]);

export class AgencyPackageError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function validKey(value) {
  return /^[A-Za-z0-9_-]{12,180}$/.test(clean(value));
}

function validEntityId(value) {
  return /^[A-Za-z0-9_.-]{1,180}$/.test(clean(value));
}

function validPublicId(value) {
  return /^\d{3,8}$/.test(clean(value));
}

function rewardDocId(type, id) {
  return (clean(type) + "__" + clean(id))
    .replace(/[^A-Za-z0-9_.-]/g, "_")
    .slice(0, 220);
}

function integerInRange(value, min, max, code) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new AgencyPackageError(code, 400);
  }
  return number;
}

function normalizeLineItems(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > LINE_LIMIT) {
    throw new AgencyPackageError("invalid_package_items", 400);
  }
  const seenLineIds = new Set();
  return value.map((raw, index) => {
    const type = clean(raw?.type);
    const assetKey = clean(raw?.assetKey);
    const lineId = clean(raw?.lineId) || `line_${index + 1}`;
    const nameAr = clean(raw?.nameAr).slice(0, 80);
    if (
      !COSMETIC_TYPES.has(type) ||
      !validEntityId(assetKey) ||
      !validEntityId(lineId) ||
      seenLineIds.has(lineId)
    ) {
      throw new AgencyPackageError("invalid_package_item", 400);
    }
    seenLineIds.add(lineId);
    return {
      lineId,
      type,
      assetKey,
      nameAr,
      entitlementDurationHours: integerInRange(
        raw?.entitlementDurationHours,
        1,
        MAX_DURATION_HOURS,
        "invalid_entitlement_duration",
      ),
      quantity: integerInRange(
        raw?.quantity,
        1,
        MAX_LINE_QUANTITY,
        "invalid_package_quantity",
      ),
    };
  });
}

async function validateAssets(db, lines, transaction = null) {
  const uniqueKeys = [...new Set(lines.map((item) => item.assetKey))];
  const snapshots = await Promise.all(
    uniqueKeys.map((key) => db.get(`app_asset_registry/${key}`, transaction)),
  );
  const byKey = new Map();
  uniqueKeys.forEach((key, index) => {
    const snap = snapshots[index];
    if (!snap?.exists || snap.data?.published !== true) {
      throw new AgencyPackageError("package_asset_not_published", 409);
    }
    byKey.set(key, snap.data || {});
  });
  return lines.map((line) => {
    const asset = byKey.get(line.assetKey) || {};
    return {
      ...line,
      rewardId: line.assetKey,
      imageUrl: clean(asset.rawUrl) || null,
    };
  });
}

async function loadActor(db, uid) {
  const snap = await db.get(`users/${uid}`);
  if (!snap.exists) throw new AgencyPackageError("forbidden", 403);
  const user = snap.data || {};
  const permissions = platformAgencyPermissions(user);
  return { user, permissions };
}

async function resolveAgencyId(db, input, transaction = null) {
  const lookupId = clean(input);
  if (!validPublicId(lookupId)) {
    throw new AgencyPackageError("invalid_agency_id", 400);
  }
  const registry = await db.get(`agency_ids/${lookupId}`, transaction);
  const resolved = clean(registry.data?.agencyId);
  if (
    registry.exists &&
    registry.data?.reserved !== true &&
    validPublicId(resolved)
  ) {
    return resolved;
  }
  const direct = await db.get(`agencies/${lookupId}`, transaction);
  const directPublicId = clean(direct.data?.publicId || lookupId);
  if (direct.exists && directPublicId === lookupId) return lookupId;
  throw new AgencyPackageError("agency_not_found", 404);
}

function packageOperationPath(key) {
  return `agency_package_operations/${clean(key)}`;
}

function requestFingerprint(action, fields) {
  return JSON.stringify({ action, ...fields });
}

async function runTransaction(db, work) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let transaction = null;
    try {
      transaction = await db.beginTransaction();
      return await work(transaction);
    } catch (error) {
      if (transaction) await db.rollback(transaction);
      if (
        error instanceof AgencyPackageError ||
        attempt >= 2 ||
        !isTransientFirestoreError(error)
      ) {
        throw error;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, firestoreErrorRetryDelayMs(attempt)),
      );
    }
  }
  throw new AgencyPackageError("transaction_failed", 500);
}

function serializeTemplate(row) {
  const data = row?.data || {};
  return {
    templateId: clean(data.templateId || row?.id),
    name: clean(data.name),
    packageDurationHours: Number(data.packageDurationHours || 0),
    status: clean(data.status || "active"),
    lineItems: Array.isArray(data.lineItems) ? data.lineItems : [],
    updatedAt: data.updatedAt || null,
  };
}

export async function listAgencyPackageAssets(db, actorUid) {
  const actor = await loadActor(db, actorUid);
  if (!actor.permissions.canManageAgencyPackages) {
    throw new AgencyPackageError("forbidden", 403);
  }
  const rows = await db.list("app_asset_registry", 200);
  return {
    ok: true,
    assets: rows
      .filter((row) => row.data?.published === true)
      .map((row) => ({
        assetKey: clean(row.data?.assetKey || row.id),
        rawUrl: clean(row.data?.rawUrl) || null,
        mode: clean(row.data?.mode || "remote"),
      })),
    limit: 200,
  };
}

export async function listAgencyPackageTemplates(db, actorUid) {
  const actor = await loadActor(db, actorUid);
  if (
    !actor.permissions.canManageAgencyPackages &&
    !actor.permissions.canGrantAgencyPackages
  ) {
    throw new AgencyPackageError("forbidden", 403);
  }
  const rows = await db.runQuery("agency_package_templates", {
    orderBy: [{ field: "updatedAt", direction: "desc" }],
    limit: TEMPLATE_LIMIT,
  });
  return {
    ok: true,
    templates: rows.map(serializeTemplate),
    limit: TEMPLATE_LIMIT,
  };
}

export async function saveAgencyPackageTemplate(
  db,
  actorUid,
  body = {},
  { now = new Date() } = {},
) {
  const actor = await loadActor(db, actorUid);
  if (!actor.permissions.canManageAgencyPackages) {
    throw new AgencyPackageError("forbidden", 403);
  }
  const templateId = clean(body.templateId) ||
    `pkg_${crypto.randomUUID().replace(/-/g, "")}`;
  const name = clean(body.name);
  const key = clean(body.idempotencyKey);
  if (
    !validEntityId(templateId) ||
    name.length < 2 ||
    name.length > 80 ||
    !validKey(key)
  ) {
    throw new AgencyPackageError("invalid_request", 400);
  }
  const packageDurationHours = integerInRange(
    body.packageDurationHours,
    1,
    MAX_DURATION_HOURS,
    "invalid_package_duration",
  );
  const normalizedLines = normalizeLineItems(body.lineItems);
  const lineItems = await validateAssets(db, normalizedLines);
  const operationPath = packageOperationPath(key);
  const templatePath = `agency_package_templates/${templateId}`;
  const fingerprint = requestFingerprint("saveTemplate", {
    templateId,
    name,
    packageDurationHours,
    lineItems: normalizedLines,
  });

  return runTransaction(db, async (transaction) => {
    const [operation, existing] = await Promise.all([
      db.get(operationPath, transaction),
      db.get(templatePath, transaction),
    ]);
    if (operation.exists) {
      const stored = operation.data || {};
      if (clean(stored.requestFingerprint) !== fingerprint) {
        throw new AgencyPackageError("idempotency_conflict", 409);
      }
      await db.rollback(transaction);
      return { ok: true, code: "duplicate", ...(stored.result || {}) };
    }

    if (!existing.exists) {
      const activeRows = await db.runQuery("agency_package_templates", {
        filters: [{ field: "status", op: "==", value: "active" }],
        limit: TEMPLATE_LIMIT + 1,
        transaction,
      });
      if (activeRows.length >= TEMPLATE_LIMIT) {
        throw new AgencyPackageError("package_template_limit_reached", 409);
      }
    }

    const template = {
      templateId,
      name,
      packageDurationHours,
      lineItems,
      status: "active",
      updatedBy: actorUid,
      updatedAt: now,
      ...(existing.exists
        ? { createdBy: clean(existing.data?.createdBy) || actorUid,
            createdAt: existing.data?.createdAt || now }
        : { createdBy: actorUid, createdAt: now }),
    };
    const result = serializeTemplate({ id: templateId, data: template });
    await db.commit(transaction, [
      existing.exists
        ? db.writeUpdate(
            templatePath,
            template,
            Object.keys(template),
          )
        : db.writeCreate(templatePath, template),
      db.writeCreate(`admin_audit_logs/agency_package_template_${key}`, {
        actorUid,
        action: existing.exists
          ? "updateAgencyPackageTemplate"
          : "createAgencyPackageTemplate",
        targetType: "agency_package_template",
        targetId: templateId,
        before: existing.exists ? serializeTemplate({ id: templateId, data: existing.data }) : null,
        after: result,
        operationId: key,
        createdAt: now,
      }),
      db.writeCreate(operationPath, {
        actorUid,
        action: "saveTemplate",
        requestFingerprint: fingerprint,
        status: "completed",
        result,
        createdAt: now,
      }),
    ]);
    return { ok: true, code: "ok", ...result };
  });
}

export async function duplicateAgencyPackageTemplate(
  db,
  actorUid,
  body = {},
  { now = new Date() } = {},
) {
  const sourceId = clean(body.sourceTemplateId);
  if (!validEntityId(sourceId)) {
    throw new AgencyPackageError("invalid_template_id", 400);
  }
  const source = await db.get(`agency_package_templates/${sourceId}`);
  if (!source.exists) throw new AgencyPackageError("package_template_not_found", 404);
  const data = source.data || {};
  return saveAgencyPackageTemplate(
    db,
    actorUid,
    {
      templateId: clean(body.templateId),
      name: clean(body.name) || `${clean(data.name)} نسخة`,
      packageDurationHours: Number(data.packageDurationHours || 0),
      lineItems: Array.isArray(data.lineItems) ? data.lineItems : [],
      idempotencyKey: body.idempotencyKey,
    },
    { now },
  );
}

export async function archiveAgencyPackageTemplate(
  db,
  actorUid,
  body = {},
  { now = new Date() } = {},
) {
  const actor = await loadActor(db, actorUid);
  if (!actor.permissions.canManageAgencyPackages) {
    throw new AgencyPackageError("forbidden", 403);
  }
  const templateId = clean(body.templateId);
  const key = clean(body.idempotencyKey);
  if (!validEntityId(templateId) || !validKey(key)) {
    throw new AgencyPackageError("invalid_request", 400);
  }
  const path = `agency_package_templates/${templateId}`;
  return runTransaction(db, async (transaction) => {
    const [operation, template] = await Promise.all([
      db.get(packageOperationPath(key), transaction),
      db.get(path, transaction),
    ]);
    if (operation.exists) {
      await db.rollback(transaction);
      return { ok: true, code: "duplicate", ...(operation.data?.result || {}) };
    }
    if (!template.exists) {
      throw new AgencyPackageError("package_template_not_found", 404);
    }
    const result = { templateId, status: "archived" };
    await db.commit(transaction, [
      db.writeUpdate(path, {
        status: "archived",
        updatedBy: actorUid,
        updatedAt: now,
      }, ["status", "updatedBy", "updatedAt"]),
      db.writeCreate(`admin_audit_logs/agency_package_archive_${key}`, {
        actorUid,
        action: "archiveAgencyPackageTemplate",
        targetType: "agency_package_template",
        targetId: templateId,
        before: { status: clean(template.data?.status || "active") },
        after: { status: "archived" },
        operationId: key,
        createdAt: now,
      }),
      db.writeCreate(packageOperationPath(key), {
        actorUid,
        action: "archiveTemplate",
        status: "completed",
        result,
        createdAt: now,
      }),
    ]);
    return { ok: true, code: "ok", ...result };
  });
}

export async function grantAgencyPackage(
  db,
  actorUid,
  body = {},
  { now = new Date() } = {},
) {
  const actor = await loadActor(db, actorUid);
  if (!actor.permissions.canGrantAgencyPackages) {
    throw new AgencyPackageError("forbidden", 403);
  }
  const templateId = clean(body.templateId);
  const agencyLookupId = clean(body.agencyId);
  const key = clean(body.idempotencyKey);
  if (
    !validEntityId(templateId) ||
    !validPublicId(agencyLookupId) ||
    !validKey(key)
  ) {
    throw new AgencyPackageError("invalid_request", 400);
  }
  const agencyId = await resolveAgencyId(db, agencyLookupId);
  const fingerprint = requestFingerprint("grantPackage", {
    templateId,
    agencyId,
  });
  const operationPath = packageOperationPath(key);

  return runTransaction(db, async (transaction) => {
    const [operation, template, agency] = await Promise.all([
      db.get(operationPath, transaction),
      db.get(`agency_package_templates/${templateId}`, transaction),
      db.get(`agencies/${agencyId}`, transaction),
    ]);
    if (operation.exists) {
      const stored = operation.data || {};
      if (clean(stored.requestFingerprint) !== fingerprint) {
        throw new AgencyPackageError("idempotency_conflict", 409);
      }
      await db.rollback(transaction);
      return { ok: true, code: "duplicate", ...(stored.result || {}) };
    }
    if (!template.exists || clean(template.data?.status) !== "active") {
      throw new AgencyPackageError("package_template_not_active", 409);
    }
    if (!agency.exists || clean(agency.data?.status) !== "active") {
      throw new AgencyPackageError("agency_not_active", 409);
    }
    const ownerUid = clean(agency.data?.ownerUid);
    if (!ownerUid) throw new AgencyPackageError("agency_owner_missing", 409);

    const durationHours = integerInRange(
      template.data?.packageDurationHours,
      1,
      MAX_DURATION_HOURS,
      "invalid_package_duration",
    );
    const grantId = `grant_${crypto.randomUUID().replace(/-/g, "")}`;
    const grantedAtMs = now.getTime();
    const expiresAtMs = grantedAtMs + durationHours * 3600000;
    const items = (Array.isArray(template.data?.lineItems)
      ? template.data.lineItems
      : []).slice(0, LINE_LIMIT).map((line) => ({
        ...line,
        quantityGranted: 0,
        quantityRemaining: integerInRange(
          line.quantity,
          1,
          MAX_LINE_QUANTITY,
          "invalid_package_quantity",
        ),
      }));
    if (!items.length) throw new AgencyPackageError("package_template_empty", 409);

    const grant = {
      grantId,
      templateId,
      templateName: clean(template.data?.name),
      agencyId,
      agencyPublicId: clean(agency.data?.publicId || agencyId),
      ownerUidAtGrant: ownerUid,
      packageDurationHours: durationHours,
      grantedBy: actorUid,
      grantedAt: now,
      grantedAtMs,
      expiresAtMs,
      status: "active",
      items,
      updatedAt: now,
    };
    const result = {
      grantId,
      templateId,
      agencyId,
      agencyPublicId: grant.agencyPublicId,
      ownerUid,
      expiresAtMs,
    };
    await db.commit(transaction, [
      db.writeCreate(`agency_package_grants/${grantId}`, grant),
      db.writeCreate(`admin_audit_logs/agency_package_grant_${key}`, {
        actorUid,
        action: "grantAgencyPackage",
        targetType: "agency",
        targetId: agencyId,
        before: null,
        after: result,
        operationId: key,
        createdAt: now,
      }),
      db.writeCreate(operationPath, {
        actorUid,
        action: "grantPackage",
        requestFingerprint: fingerprint,
        status: "completed",
        result,
        createdAt: now,
      }),
    ]);
    return { ok: true, code: "ok", ...result };
  });
}

export async function listMyAgencyPackages(
  db,
  actorUid,
  body = {},
  { nowMs = Date.now() } = {},
) {
  const membership = await db.get(`agency_user_memberships/${actorUid}`);
  const agencyId = clean(membership.data?.agencyId);
  if (
    !membership.exists ||
    clean(membership.data?.status) !== "active" ||
    clean(membership.data?.role) !== "owner" ||
    !validPublicId(agencyId)
  ) {
    throw new AgencyPackageError("agency_owner_required", 403);
  }
  const agency = await db.get(`agencies/${agencyId}`);
  if (
    !agency.exists ||
    clean(agency.data?.ownerUid) !== actorUid ||
    clean(agency.data?.status) !== "active"
  ) {
    throw new AgencyPackageError("agency_owner_required", 403);
  }
  const limit = Math.max(
    1,
    Math.min(LIST_LIMIT, Number(body.limit || LIST_LIMIT)),
  );
  const rows = await db.runQuery("agency_package_grants", {
    filters: [{ field: "agencyId", op: "==", value: agencyId }],
    limit,
  });
  const packages = rows
    .map((row) => {
      const data = row.data || {};
      const expired = Number(data.expiresAtMs || 0) <= nowMs;
      return {
        grantId: clean(data.grantId || row.id),
        templateId: clean(data.templateId),
        templateName: clean(data.templateName),
        expiresAtMs: Number(data.expiresAtMs || 0),
        expired,
        status: expired ? "expired" : clean(data.status || "active"),
        items: Array.isArray(data.items) ? data.items : [],
      };
    })
    .sort((a, b) => b.expiresAtMs - a.expiresAtMs);
  return { ok: true, packages, limit };
}

export async function distributeAgencyPackageItem(
  db,
  actorUid,
  body = {},
  { now = new Date() } = {},
) {
  const grantId = clean(body.grantId);
  const lineId = clean(body.lineId);
  const targetPublicId = clean(body.targetPublicId);
  const key = clean(body.idempotencyKey);
  if (
    !validEntityId(grantId) ||
    !validEntityId(lineId) ||
    !validPublicId(targetPublicId) ||
    !validKey(key)
  ) {
    throw new AgencyPackageError("invalid_request", 400);
  }
  const nowMs = now.getTime();
  const fingerprint = requestFingerprint("distribute", {
    grantId,
    lineId,
    targetPublicId,
  });

  return runTransaction(db, async (transaction) => {
    const [operation, grant, targetIdSnap] = await Promise.all([
      db.get(packageOperationPath(key), transaction),
      db.get(`agency_package_grants/${grantId}`, transaction),
      db.get(`public_ids/${targetPublicId}`, transaction),
    ]);
    if (operation.exists) {
      const stored = operation.data || {};
      if (clean(stored.requestFingerprint) !== fingerprint) {
        throw new AgencyPackageError("idempotency_conflict", 409);
      }
      await db.rollback(transaction);
      return { ok: true, code: "duplicate", ...(stored.result || {}) };
    }
    if (!grant.exists) throw new AgencyPackageError("package_grant_not_found", 404);
    const grantData = grant.data || {};
    if (
      clean(grantData.status || "active") !== "active" ||
      Number(grantData.expiresAtMs || 0) <= nowMs
    ) {
      throw new AgencyPackageError("package_expired", 409);
    }

    const agencyId = clean(grantData.agencyId);
    const agency = await db.get(`agencies/${agencyId}`, transaction);
    if (
      !agency.exists ||
      clean(agency.data?.status) !== "active" ||
      clean(agency.data?.ownerUid) !== actorUid
    ) {
      throw new AgencyPackageError("agency_owner_required", 403);
    }

    const targetUid = clean(targetIdSnap.data?.uid);
    if (
      !targetIdSnap.exists ||
      targetIdSnap.data?.reserved === true ||
      !targetUid
    ) {
      throw new AgencyPackageError("target_user_not_found", 404);
    }

    const items = Array.isArray(grantData.items)
      ? grantData.items.map((item) => ({ ...item }))
      : [];
    const index = items.findIndex((item) => clean(item.lineId) === lineId);
    if (index < 0) throw new AgencyPackageError("package_item_not_found", 404);
    const item = items[index];
    const remaining = Number(item.quantityRemaining || 0);
    if (!Number.isSafeInteger(remaining) || remaining <= 0) {
      throw new AgencyPackageError("package_item_out_of_stock", 409);
    }

    const targetUser = await db.get(`users/${targetUid}`, transaction);
    if (
      !targetUser.exists ||
      clean(targetUser.data?.accountStatus || "active") !== "active"
    ) {
      throw new AgencyPackageError("target_user_unavailable", 409);
    }

    const type = clean(item.type);
    const rewardId = clean(item.rewardId || item.assetKey);
    const rewardPath =
      `user_rewards/${targetUid}/items/${rewardDocId(type, rewardId)}`;
    const existingReward = await db.get(rewardPath, transaction);
    const durationHours = integerInRange(
      item.entitlementDurationHours,
      1,
      MAX_DURATION_HOURS,
      "invalid_entitlement_duration",
    );
    const baseExpiryMs = Math.max(
      nowMs,
      Number(existingReward.data?.expiresAtMs || 0),
    );
    const expiresAtMs = baseExpiryMs + durationHours * 3600000;

    items[index] = {
      ...item,
      quantityRemaining: remaining - 1,
      quantityGranted: Math.max(0, Number(item.quantityGranted || 0)) + 1,
    };
    const result = {
      grantId,
      lineId,
      agencyId,
      targetUid,
      targetPublicId,
      type,
      rewardId,
      assetKey: clean(item.assetKey),
      expiresAtMs,
      quantityRemaining: items[index].quantityRemaining,
    };
    const reward = {
      rewardId,
      type,
      nameAr: clean(item.nameAr),
      assetKey: clean(item.assetKey),
      imageUrl: clean(item.imageUrl),
      expiresAtMs,
      active: existingReward.data?.active === true,
      source: "agency_package",
      sourceGrantId: grantId,
      sourceAgencyId: agencyId,
      updatedAt: now,
      ...(existingReward.exists ? {} : { createdAt: now }),
    };

    await db.commit(transaction, [
      db.writeUpdate(
        `agency_package_grants/${grantId}`,
        { items, updatedAt: now },
        ["items", "updatedAt"],
      ),
      existingReward.exists
        ? db.writeUpdate(rewardPath, reward, Object.keys(reward))
        : db.writeCreate(rewardPath, reward),
      db.writeCreate(`admin_audit_logs/agency_package_distribute_${key}`, {
        actorUid,
        action: "distributeAgencyPackageItem",
        targetType: "user",
        targetId: targetUid,
        agencyId,
        grantId,
        lineId,
        before: { quantityRemaining: remaining },
        after: result,
        operationId: key,
        createdAt: now,
      }),
      db.writeCreate(packageOperationPath(key), {
        actorUid,
        action: "distribute",
        requestFingerprint: fingerprint,
        status: "completed",
        result,
        createdAt: now,
      }),
    ]);
    return { ok: true, code: "ok", ...result };
  });
}

export async function agencyPackages(request, env) {
  if (request.method !== "POST") {
    return json(request, env, { ok: false, code: "method_not_allowed" }, 405);
  }
  try {
    const decoded = await verifyFirebaseIdToken(request, env);
    const body = await readJson(request);
    const action = clean(body.action);
    const db = firestoreClient(env);

    let result;
    if (action === "listAssets") {
      result = await listAgencyPackageAssets(db, decoded.sub);
    } else if (action === "listTemplates") {
      result = await listAgencyPackageTemplates(db, decoded.sub);
    } else if (action === "saveTemplate") {
      result = await saveAgencyPackageTemplate(db, decoded.sub, body);
    } else if (action === "duplicateTemplate") {
      result = await duplicateAgencyPackageTemplate(db, decoded.sub, body);
    } else if (action === "archiveTemplate") {
      result = await archiveAgencyPackageTemplate(db, decoded.sub, body);
    } else if (action === "grantPackage") {
      result = await grantAgencyPackage(db, decoded.sub, body);
    } else if (action === "myPackages") {
      result = await listMyAgencyPackages(db, decoded.sub, body);
    } else if (action === "distribute") {
      result = await distributeAgencyPackageItem(db, decoded.sub, body);
    } else {
      throw new AgencyPackageError("invalid_action", 400);
    }
    return json(request, env, result, 200);
  } catch (error) {
    const quota = firestoreQuotaResponse(request, env, error);
    if (quota) return quota;
    if (error instanceof AgencyPackageError) {
      return json(request, env, { ok: false, code: error.code }, error.status);
    }
    const raw = clean(error?.message);
    if (raw === "unauthorized") {
      return json(request, env, { ok: false, code: "unauthorized" }, 401);
    }
    if (raw === "server_not_configured" || raw === "invalid_service_account_json") {
      return json(request, env, { ok: false, code: raw }, 503);
    }
    return json(request, env, { ok: false, code: "agency_package_failed" }, 500);
  }
}
