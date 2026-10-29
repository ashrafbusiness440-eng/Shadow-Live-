// Read-only Store catalog and Owner-only entitlement audit. No Firestore writes.
import {json, readJson, firestoreQuotaResponse} from "./http.js";
import {verifyFirebaseIdToken,assertUserDocumentSessionState} from "./firebase-auth.js";
import {firestoreClient} from "./firestore.js";

const clean = value => String(value ?? "").trim();
const validUid = uid => /^[A-Za-z0-9_-]{1,128}$/.test(uid);

export function canViewStoreAudit(user={}) {
  if (user.role==="owner") return true;
  return user.adminEnabled === true &&
    (user.role==="admin" || user.role==="super_admin") &&
    Array.isArray(user.capabilities) &&
    user.capabilities.includes("viewStoreAudit");
}
export function projectStoreCatalogAudit(data={}) {
  if (!data || data.targetType!=="store_catalog" ||
      data.targetId!=="system_config/store_catalog" ||
      data.action!=="saveStoreCatalog" ||
      !validUid(clean(data.actorUid)) ||
      !Number.isSafeInteger(data.fromRevision) ||
      !Number.isSafeInteger(data.toRevision) ||
      data.fromRevision<0 || data.toRevision<=data.fromRevision ||
      !Array.isArray(data.changedIds)) return null;
  const changedIds=data.changedIds
    .map(clean)
    .filter(id=>/^[1-9][0-9]{5,8}$/.test(id))
    .slice(0,100);
  const timestamp=Date.parse(String(data.createdAt || data.timestamp || ""));
  return {
    actorUid:clean(data.actorUid),
    fromRevision:data.fromRevision,
    toRevision:data.toRevision,
    changedIds,
    at:Number.isFinite(timestamp)?new Date(timestamp).toISOString():null,
  };
}
// Only Owner can inspect operational audit metadata: these records reference
// individual Store buyers and grant recipients. Never emit reasons, wallet
// balances, emails, private user documents or full financial ledger payloads.
const STORE_OPERATION_ACTIONS=Object.freeze({
  grantStoreItem:"grant",
  revokeStoreGrant:"revoke",
  purchaseStoreItem:"purchase",
  renewStoreItem:"renew",
});
export function projectStoreOperationAudit(data={}) {
  if(!data||data.targetType!=="store_entitlement")return null;
  const rawAction=clean(data.action);
  if(!Object.hasOwn(STORE_OPERATION_ACTIONS,rawAction))return null;
  const action=STORE_OPERATION_ACTIONS[rawAction];
  const match=/^user_store_entitlements\/([A-Za-z0-9_-]{1,128})\/items\/([1-9][0-9]{5,8})$/
    .exec(clean(data.targetId));
  if(!match||!validUid(clean(data.actorUid)))return null;
  const operationId=clean(data.operationId);
  if(!/^[A-Za-z0-9_-]{12,100}$/.test(operationId))return null;
  const time=Date.parse(String(data.createdAt||""));
  if(!Number.isFinite(time))return null;
  const purchase=action==="purchase"||action==="renew";
  const price=data.priceCoins;
  if(purchase&&(!Number.isSafeInteger(price)||price<=0))return null;
  return {
    action,actorUid:clean(data.actorUid),
    targetUid:match[1],productId:match[2],
    at:new Date(time).toISOString(),
    ...(purchase?{priceCoins:price}:{}),
  };
}

export async function loadStoreCatalogAudit(db, token) {
  const uid=clean(token?.sub);
  if (!validUid(uid)) throw Error("unauthorized");
  const actor=await db.get(`users/${uid}`);
  if (!actor.exists) throw Error("forbidden");
  assertUserDocumentSessionState(token,actor.data||{});
  if (!canViewStoreAudit(actor.data || {})) throw Error("forbidden");
  const authAge=Math.floor(Date.now()/1000)-Number(token.auth_time || 0);
  if (!Number.isFinite(authAge) || authAge<0 || authAge>1800) {
    throw Error("recent_auth_required");
  }
  // One indexed equality query, fixed result cap: no unbounded document scan.
  const rows=await db.runQuery("admin_audit_logs",{
    filters:[{field:"targetType",op:"==",value:"store_catalog"}],
    limit:50,
  });
  const entries=rows.map(row=>projectStoreCatalogAudit(row.data)).filter(Boolean)
    .sort((a,b)=>String(b.at||"").localeCompare(String(a.at||"")) ||
      b.toRevision-a.toRevision);
  const canViewOperations=actor.data?.role==="owner";
  // Explicit Owner-only second query; never scan financial_ledger or all
  // users. Audit-only staff retain their original catalog-only access.
  const operationRows=canViewOperations
    ?await db.runQuery("admin_audit_logs",{
        filters:[{field:"targetType",op:"==",value:"store_entitlement"}],
        limit:50,
      })
    :[];
  const operationEntries=operationRows
    .map(row=>projectStoreOperationAudit(row.data))
    .filter(Boolean)
    .sort((a,b)=>b.at.localeCompare(a.at) ||
      a.productId.localeCompare(b.productId));
  return {
    ok:true,entries,purchasingEnabled:false,
    resultLimit:50,moreMayExist:rows.length>=50,
    canViewOperations,operationEntries,
    moreOperationsMayExist:operationRows.length>=50,
  };
}
export async function manageStoreAudit(request, env) {
  if (request.method!=="POST") {
    return json(request,env,{ok:false,code:"method_not_allowed"},405);
  }
  try {
    const token=await verifyFirebaseIdToken(request,env,{checkUserState:false});
    const body=await readJson(request);
    if (body?.action!=="history") {
      return json(request,env,{ok:false,code:"invalid_action"},400);
    }
    return json(request,env,
      await loadStoreCatalogAudit(firestoreClient(env),token),
      200,{"Cache-Control":"no-store"});
  } catch(error) {
    const quota=firestoreQuotaResponse(request,env,error);
    if (quota) return quota;
    const code=clean(error?.message);
    if (code==="unauthorized"||code==="forbidden"||
        code==="recent_auth_required") {
      return json(request,env,{ok:false,code},
        code==="forbidden"?403:401);
    }
    return json(request,env,{ok:false,code:"store_audit_unavailable"},503);
  }
}
