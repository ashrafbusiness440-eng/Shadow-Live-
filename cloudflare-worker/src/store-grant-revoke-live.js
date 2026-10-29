// Post-commit best-effort visual invalidation for an approved Store grant
// revocation. The entitlement transaction already committed before this runs.
// Never scan rooms, enumerate users, debit Coins or reveal the Owner/reason.
import {realtimeUserPresentFromNamespace} from "./room-presence-authority.js";
import {refreshRealtimeIdentity} from "./room-realtime.js";

const clean=v=>String(v??"").trim();
const validRoom=id=>/^[A-Za-z0-9_-]{1,180}$/.test(id);
const validUid=id=>/^[A-Za-z0-9_-]{1,128}$/.test(id);
const validProduct=id=>/^[1-9][0-9]{5,8}$/.test(id);
const CATEGORIES=new Set([
  "frames","entranceEffects","chatBubbles","nameEffects",
  "profileCards","voiceWaves","roomFrames","backgrounds",
]);

// Mask a stale, previously server-verified wave on the one active room mic.
// Do not clear other owners, other products, microphone occupancy or VIP data.
// The speaker's existing authenticated seat refresh restores reward/VIP fallback.
export async function scrubRevokedStoreWaveSeat(db,roomId,uid,productId) {
  if(!validRoom(roomId)||!validUid(uid)||!validProduct(productId))
    return false;
  const path="rooms/"+roomId;
  const tx=await db.beginTransaction();
  let open=true;
  try {
    const snapshot=await db.get(path,tx);
    if(!snapshot.exists||snapshot.data?.isActive===false){
      await db.rollback(tx);open=false;return false;
    }
    const rows=snapshot.data?.seats;
    if(!Array.isArray(rows)||rows.length>50){
      await db.rollback(tx);open=false;return false;
    }
    const revokedKey=`store.item.${productId}.visual`;
    let changed=false;
    const seats=rows.map(row=>{
      if(!row||typeof row!=="object"||Array.isArray(row)||
          clean(row.uid)!==uid||
          clean(row.voiceWaveAssetKey)!==revokedKey)return row;
      changed=true;
      return {...row,voiceWaveAssetKey:"",voiceWaveImageUrl:"",
        voiceWaveExpiresAtMs:0};
    });
    if(!changed){
      await db.rollback(tx);open=false;return true;
    }
    await db.commit(tx,[db.writeUpdate(path,{seats},["seats"])]);
    open=false;
    return true;
  }finally{
    if(open)await db.rollback(tx).catch(()=>{});
  }
}

// The index is a locator, NOT proof of presence. Verify the current room DO
// before attempting any room write or WebSocket event. If the socket is gone,
// reconnection already re-evaluates the entitlement on the server.
export async function refreshRevokedStoreGrantInLiveRoom(
  db,env,result,{
    isPresent=realtimeUserPresentFromNamespace,
    refreshIdentity=refreshRealtimeIdentity,
    scrubWave=scrubRevokedStoreWaveSeat,
  }={}){
  const uid=clean(result?.targetUid);
  const productId=clean(result?.productId);
  const category=clean(result?.category);
  if(!validUid(uid)||!validProduct(productId)||!CATEGORIES.has(category))
    return {status:"invalid"};
  if(!env?.ROOM_REALTIME)return {status:"unavailable"};
  const locator=await db.get("user_room_index/"+uid);
  const roomId=clean(locator.data?.roomId);
  if(!locator.exists||!validRoom(roomId))
    return {status:"not_in_room"};
  const present=await isPresent(env.ROOM_REALTIME,roomId,uid);
  if(present===false)return {status:"not_in_room"};
  if(present!==true)return {status:"unavailable"};
  let identityRefreshed=false;
  let seatCleared=category!=="voiceWaves";
  let notified=false;
  try{
    await refreshIdentity(env,db,roomId,uid);
    identityRefreshed=true;
  }catch(_){}
  if(category==="voiceWaves"){
    try{
      // The room document already streams to clients. A scoped exact-key
      // compare prevents clearing a newer, unrelated equipped wave.
      seatCleared=await scrubWave(db,roomId,uid,productId);
    }catch(_){seatCleared=false;}
  }
  try{
    const stub=env.ROOM_REALTIME.get(
      env.ROOM_REALTIME.idFromName(roomId));
    const response=await stub.fetch(
      "https://room-realtime.internal/presence/store-invalidated",{
        method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({roomId,uid,category}),
      });
    const confirmation=response.ok
      ?await response.json().catch(()=>({})):{};
    notified=response.ok && confirmation.present===true &&
      Number(confirmation.delivered||0)>0;
  }catch(_){}
  return {
    status:identityRefreshed&&notified&&seatCleared
      ?"refreshed":"pending_refresh",
    identityRefreshed,notified,seatCleared,
  };
}
