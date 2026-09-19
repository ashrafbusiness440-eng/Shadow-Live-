export const validRoles=new Set(["user","moderator","admin","super_admin","owner"]);
export const validCapabilities=new Set([
 "viewDashboard","viewUsers","manageUsers","viewReports","reviewReports","muteUsers","suspendUsers","permanentBan",
 "manageRooms","globalRoomControl","manageAgencies","manageVip","manageSpecialIds","manageStore","manageGames",
 "manageEconomy","manageWithdrawals","manageSettlements","manageCampaigns","manageRoles","viewAuditLog","emergencyLock",
]);
export function ownerTargetProtected(actorRole:string,targetRole:string,action:string){
 if(targetRole!=="owner")return false;
 if(actorRole!=="owner")return true;
 return new Set(["demote","disableAdmin","revokeCapabilities","ban","deleteAccount"]).has(action);
}
export function validRole(role:string){return validRoles.has(role);}
export function sanitizeCapabilities(values:unknown[]){
 const caps=[...new Set(values.map(x=>String(x).trim()).filter(Boolean))];
 if(caps.some(x=>!validCapabilities.has(x)))throw new Error("invalid_capability");
 return caps;
}
export function validIdempotencyKey(key:string){return /^[A-Za-z0-9_-]{16,128}$/.test(key);}
export function isRecentAuth(authTime:number,nowSeconds:number,maxAgeSeconds=600){
 return Number.isFinite(authTime)&&authTime>0&&nowSeconds>=authTime&&nowSeconds-authTime<=maxAgeSeconds;
}
