export function ownerTargetProtected(actorRole:string,targetRole:string,action:string){
 if(targetRole!=="owner")return false;
 if(actorRole!=="owner")return true;
 return new Set(["demote","disableAdmin","revokeCapabilities","ban","deleteAccount"]).has(action);
}
export function validRole(role:string){return new Set(["user","moderator","admin","super_admin","owner"]).has(role);}
