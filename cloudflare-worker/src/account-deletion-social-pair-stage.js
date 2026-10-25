import { accountDeletionHasActiveHold as hold } from "./account-deletion-active-holds.js";
// Fail-closed internal per-counterparty social-link cleanup.
// NOT routed or scheduled. Exact four-document transaction only.
const clean=v=>String(v??"").trim();
const uidOk=v=>/^[A-Za-z0-9_-]{3,128}$/.test(clean(v));
const reqOk=v=>/^[A-Za-z0-9_-]{12,180}$/.test(clean(v));

export class SocialPairErasureError extends Error {
  constructor(code,status=409){super(code);this.code=code;this.status=status;}
}
export async function removeDeletedAccountSocialPair(db,{uid,otherUid,requestId}={}){
  uid=clean(uid);otherUid=clean(otherUid);requestId=clean(requestId);
  if(!uidOk(uid)||!uidOk(otherUid)||uid===otherUid||!reqOk(requestId)){
    throw new SocialPairErasureError("invalid_social_pair",400);
  }
  const links=[
    {path:`follows/${uid}__${otherUid}`,followerUid:uid,followingUid:otherUid},
    {path:`follows/${otherUid}__${uid}`,followerUid:otherUid,followingUid:uid},
    {path:`user_blocks/${uid}/items/${otherUid}`,blockerUid:uid,blockedUid:otherUid},
    {path:`user_blocks/${otherUid}/items/${uid}`,blockerUid:otherUid,blockedUid:uid},
  ];
  const tx=await db.beginTransaction();
  try {
    const [request,checkpoint,user,...rows]=await Promise.all([
      db.get("account_deletion_requests/"+uid,tx),
      db.get("account_deletion_erasure_checkpoints/"+uid,tx),
      db.get("users/"+uid,tx),
      ...links.map(link=>db.get(link.path,tx)),
    ]);
    if(!request.exists||!checkpoint.exists||!user.exists||
       clean(request.data?.uid)!==uid||
       clean(request.data?.requestId)!==requestId||
       clean(checkpoint.data?.requestId)!==requestId||
       clean(request.data?.status)!=="processing"||
       clean(checkpoint.data?.phase)!=="social_links"||
       checkpoint.data?.destructiveAllowed!==true||
       clean(user.data?.accountStatus)!=="deletion_processing"||
       clean(user.data?.role)==="owner"||
       hold(request.data)||hold(checkpoint.data)||hold(user.data)){
      throw new SocialPairErasureError("social_pair_erasure_blocked");
    }
    const writes=[];
    for(let i=0;i<links.length;i++){
      const row=rows[i],expected=links[i];if(!row.exists)continue;
      if(hold(row.data))throw new SocialPairErasureError("social_pair_retention_hold");
      // Never delete a malformed pair record that points to a third user.
      for(const field of ["followerUid","followingUid","blockerUid","blockedUid"]){
        if(field in expected && clean(row.data?.[field]) &&
           clean(row.data[field])!==expected[field]){
          throw new SocialPairErasureError("social_pair_owner_conflict");
        }
      }
      writes.push(db.writeDelete(expected.path));
    }
    if(!writes.length){
      await db.rollback(tx);return {ok:true,removed:0,duplicate:true};
    }
    await db.commit(tx,writes);
    return {ok:true,removed:writes.length,duplicate:false};
  }catch(error){
    await db.rollback(tx).catch(()=>{});
    throw error;
  }
}
