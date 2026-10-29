// Administrative grant revocation remains OFF in production until an
// independent incident rollback and multi-client visual propagation signoff.
import {json,readJson,firestoreQuotaResponse} from "./http.js";
import {verifyFirebaseIdToken} from "./firebase-auth.js";
import {firestoreClient} from "./firestore.js";
import {commitStoreGrantRevokeOffline}
  from "./store-grant-revoke-transaction.js";

const clean=v=>String(v??"").trim();
export const STORE_GRANT_REVOKE_RELEASE_VALUE="owner-grant-revoke-v1";
export function storeGrantRevokeEnabled(env){
  return env?.STORE_GRANT_REVOCATION_ENABLED===
    STORE_GRANT_REVOKE_RELEASE_VALUE;
}

export async function manageStoreGrantRevoke(request,env){
  if(request.method!=="POST"){
    return json(request,env,{ok:false,code:"method_not_allowed"},405);
  }
  // This is independent from grant issuance and cannot be unlocked by
  // catalogue edits, request body, or admin permissions.
  if(!storeGrantRevokeEnabled(env)){
    return json(request,env,{
      ok:false,code:"store_grant_revocation_disabled",
      revocationEnabled:false,
    },423);
  }
  try{
    const body=await readJson(request);
    if(body?.action!=="revoke"||body?.confirmation!=="confirmed"){
      return json(request,env,{ok:false,code:"invalid_revocation_confirmation"},400);
    }
    const token=await verifyFirebaseIdToken(request,env,{
      checkUserState:false,
    });
    const result=await commitStoreGrantRevokeOffline(
      firestoreClient(env),token,body);
    return json(request,env,result,200,{"Cache-Control":"no-store"});
  }catch(error){
    const quota=firestoreQuotaResponse(request,env,error);
    if(quota)return quota;
    const code=clean(error?.code||error?.message);
    if([
      "unauthorized","forbidden","recent_auth_required",
      "invalid_target_id","invalid_store_product_id",
      "invalid_revocation_operation_id","invalid_revocation_reason",
      "invalid_revocation_time","target_not_found",
      "store_entitlement_not_found","store_entitlement_not_revocable",
      "store_equipment_conflict","store_equipment_invalid",
      "revocation_operation_id_conflict",
    ].includes(code)){
      const status=
        code==="unauthorized"||code==="recent_auth_required"?401:
        code==="forbidden"?403:
        code==="target_not_found"||code==="store_entitlement_not_found"?404:
        code.startsWith("invalid_")?400:409;
      return json(request,env,{ok:false,code},status);
    }
    return json(request,env,{
      ok:false,code:"store_grant_revocation_unavailable",
    },503);
  }
}
