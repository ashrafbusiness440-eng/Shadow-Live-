// Owner grant issuance endpoint. The execution path is deployed dormant:
// STORE_GRANT_ISSUANCE_ENABLED must be explicitly set in Worker environment
// only after E2E verification and incident rollback testing. Neither catalog
// edits nor admin capabilities can enable this production release gate.
import {json,readJson,firestoreQuotaResponse} from "./http.js";
import {verifyFirebaseIdToken} from "./firebase-auth.js";
import {firestoreClient} from "./firestore.js";
import {commitStoreGrantOffline}
  from "./store-grant-transaction-offline.js";

const clean=v=>String(v??"").trim();
export const STORE_GRANT_RELEASE_VALUE="owner-grants-v1";
export function storeGrantIssuanceEnabled(env){
  return env?.STORE_GRANT_ISSUANCE_ENABLED===STORE_GRANT_RELEASE_VALUE;
}

export async function manageStoreGrantIssue(request,env){
  if(request.method!=="POST"){
    return json(request,env,{ok:false,code:"method_not_allowed"},405);
  }
  // The default is OFF; this check precedes auth and all Firestore calls.
  // Never accept an activation flag from the POST body or catalog document.
  if(!storeGrantIssuanceEnabled(env)){
    return json(request,env,{
      ok:false,code:"store_grants_disabled",grantEnabled:false,
    },423);
  }
  try{
    const body=await readJson(request);
    if(body?.action!=="issue" || body?.confirmation!=="confirmed"){
      return json(request,env,{ok:false,code:"invalid_grant_confirmation"},400);
    }
    // The grant executor revalidates Owner authority, fresh login,
    // target identity/eligibility and operation deduplication inside tx.
    const token=await verifyFirebaseIdToken(request,env,{
      checkUserState:false,
    });
    const result=await commitStoreGrantOffline(
      firestoreClient(env),token,body);
    return json(request,env,result,200,{"Cache-Control":"no-store"});
  }catch(error){
    const quota=firestoreQuotaResponse(request,env,error);
    if(quota)return quota;
    const code=clean(error?.code||error?.message);
    if([
      "unauthorized","forbidden","recent_auth_required",
      "invalid_grant_operation_id","invalid_store_product_id",
      "invalid_grant_reason","invalid_target_id","invalid_grant_time",
      "target_not_found","target_not_active","store_product_unavailable",
      "store_vip_level_required","store_wealth_level_required",
      "invalid_target_level_data","store_asset_not_published",
      "store_item_already_owned","grant_operation_id_conflict",
      "invalid_grant_expiry",
    ].includes(code)){
      const status=
        code==="forbidden"?403:
        code==="unauthorized"||code==="recent_auth_required"?401:
        code==="target_not_found"||code==="store_product_unavailable"?404:
        code.startsWith("invalid_")?400:409;
      return json(request,env,{ok:false,code},status);
    }
    // Do not leak Firestore internals, the actor UID or private target UID.
    return json(request,env,{ok:false,code:"store_grant_issue_unavailable"},503);
  }
}
