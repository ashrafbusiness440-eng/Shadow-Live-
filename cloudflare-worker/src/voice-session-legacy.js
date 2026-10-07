import {createCipheriv,randomBytes,randomInt,createHash,scryptSync,timingSafeEqual} from "node:crypto";
import {getApps,initializeApp,cert,getAuth,getFirestore,FieldValue,legacyEnv} from "./legacy-firebase-admin-shim.js";
import {activeMicSegments} from "./mic-activity.js";
import {assertUserDocumentSessionState} from "./firebase-auth.js";
import {gameCatalog} from "./legacy-games/game-runtime.js";
import {loadUserLevelPolicy} from "./user-level-policy.js";
import {summarizeUserLevelData} from "./user-level-summary.js";
import {publicLevelMetadata} from "./user-level-visibility.js";
import {
  activeHideRankingLists,
  activeHiddenRoomEntry,
  activeRoomGhostMode,
  canInspectHiddenRankingLists,
  canInspectHiddenRoomPresence,
  canOverrideVipRoomProtection,
  canUseHiddenRoomEntry,
  canUseRoomGhostMode,
  vipEntitlementsFromUser,
  vipCosmeticAssetKey,
  vipCosmeticsFromUser,
} from "./vip-entitlements.js";
import {timestampToEpochMs} from "./vip-runtime.js";
import {
  loadPublicProfilePresentations,
  publicProfilePresentation,
} from "./public-profile-presentation.js";
import {
  legacyPresenceFresh,
  realtimeUserPresentFromNamespace,
} from "./room-presence-authority.js";
import {
  invalidateRoomRealtimeAdmissionCache,
  publishRoomRealtimeEvent,
  setRoomRealtimeChatPolicy,
} from "./room-realtime.js";

class ApiError extends Error {
  constructor(code,status=400){super(code);this.code=code;this.status=status;}
}

function parseServiceAccount(raw){
  const value=String(raw||"").trim();
  if(!value)throw new ApiError("server_not_configured",500);
  let sa=JSON.parse(value);
  if(typeof sa==="string")sa=JSON.parse(sa);
  const projectId=sa.project_id||sa.projectId;
  const clientEmail=sa.client_email||sa.clientEmail;
  const privateKey=String(sa.private_key||sa.privateKey||"").replace(/\\n/g,"\n");
  if(!projectId||!clientEmail||!privateKey)throw new ApiError("invalid_service_account_json",500);
  return {projectId,clientEmail,privateKey};
}

function initFirebase(){
  if(!getApps().length){
    const sa=parseServiceAccount(legacyEnv.FIREBASE_SERVICE_ACCOUNT);
    initializeApp({credential:cert(sa),projectId:sa.projectId});
  }
}

function cors(req,res){
  res.setHeader("access-control-allow-origin","*");
  res.setHeader("access-control-allow-methods","GET,POST,OPTIONS");
  res.setHeader("access-control-allow-headers","Authorization, Content-Type");
  res.setHeader("cache-control","no-store");
  if(req.method==="OPTIONS"){res.status(204).end();return true;}
  return false;
}

const out=(res,status,body)=>res.status(status).json(body);
const clean=(v)=>String(v??"").trim();
const legacyRoomChatRate=new Map();

async function realtimePresenceState(roomId){
  const namespace=legacyEnv.ROOM_REALTIME;
  if(!namespace)return null;
  try{
    const id=namespace.idFromName(roomId);
    const stub=namespace.get(id);
    const response=await stub.fetch("https://room-realtime.internal/presence");
    if(!response.ok)return null;
    const body=await response.json().catch(()=>({}));
    return Array.isArray(body.participants)?body.participants:[];
  }catch(_){
    return null;
  }
}

async function realtimeUserPresent(roomId,uid){
  return realtimeUserPresentFromNamespace(
    legacyEnv.ROOM_REALTIME,
    roomId,
    uid,
  );
}

async function realtimeRoomCount(roomId){
  const namespace=legacyEnv.ROOM_REALTIME;
  if(!namespace)return null;
  try{
    const id=namespace.idFromName(roomId);
    const stub=namespace.get(id);
    const response=await stub.fetch("https://room-realtime.internal/presence/count");
    if(!response.ok)return null;
    const body=await response.json().catch(()=>({}));
    return Math.max(0,Number(body.onlineCount||0));
  }catch(_){
    return null;
  }
}

async function broadcastRoomRealtimeEvent(roomId,type,payload={}){
  const namespace=legacyEnv.ROOM_REALTIME;
  if(!namespace)return 0;
  try{
    const id=namespace.idFromName(roomId);
    const stub=namespace.get(id);
    const response=await stub.fetch("https://room-realtime.internal/broadcast",{
      method:"POST",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({event:{type,payload}}),
    });
    if(!response.ok)return 0;
    const body=await response.json().catch(()=>({}));
    return Math.max(0,Number(body.delivered||0));
  }catch(_){
    return 0;
  }
}

async function registerCustomerServiceMicSchedules(roomId,uid,schedules){
  const namespace=legacyEnv.ROOM_REALTIME;
  if(!namespace||!Array.isArray(schedules)||schedules.length===0)return false;
  try{
    const id=namespace.idFromName(roomId);
    const stub=namespace.get(id);
    const response=await stub.fetch(
      "https://room-realtime.internal/customer-service/mic/register",
      {
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({roomId,uid,schedules}),
      },
    );
    return response.ok;
  }catch(_){
    return false;
  }
}

const CUSTOMER_SERVICE_INVITE_MS=60_000;
const CUSTOMER_SERVICE_MIC_MS=10*60_000;

async function realtimeRoomCounts(roomIds){
  const ids=Array.from(new Set(
    (Array.isArray(roomIds)?roomIds:[])
      .map(clean)
      .filter(id=>/^[A-Za-z0-9_-]{1,180}$/.test(id))
  ));
  const counts=new Map();
  const batchSize=12;
  for(let index=0;index<ids.length;index+=batchSize){
    const batch=ids.slice(index,index+batchSize);
    const values=await Promise.all(
      batch.map(roomId=>realtimeRoomCount(roomId))
    );
    for(let offset=0;offset<batch.length;offset++){
      if(values[offset]!==null)counts.set(batch[offset],values[offset]);
    }
  }
  return counts;
}

async function assertRoomRealtimePresence(db,roomId,uid){
  const realtime=await realtimeUserPresent(roomId,uid);
  if(realtime===true)return;
  if(realtime===false)throw new ApiError("target_not_in_room",409);

  // Compatibility fallback for local/legacy environments without the DO.
  const presenceRef=db.collection("room_presence").doc(roomId).collection("users").doc(uid);
  const presenceSnap=await presenceRef.get();
  const lastSeenAtMs=Number(presenceSnap.data()?.lastSeenAtMs||0);
  if(!presenceSnap.exists||Date.now()-lastSeenAtMs>90000){
    throw new ApiError("target_not_in_room",409);
  }
}

function cosmeticDocId(type,id){
  return (clean(type)+"__"+clean(id))
    .replace(/[^A-Za-z0-9_.-]/g,"_")
    .slice(0,220);
}
function defaultCosmeticAssetKey(type,id){
  const safeId=clean(id).replace(/[^A-Za-z0-9_.-]/g,"_");
  return safeId?"cosmetics."+clean(type)+"."+safeId:"";
}
async function activeCosmetics(db,uid,types,tx=null){
  if(!uid||!Array.isArray(types)||types.length===0)return {};
  const rootRef=db.collection("user_rewards").doc(uid);
  const rootSnap=tx?await tx.get(rootRef):await rootRef.get();
  const activeByType=rootSnap.data()?.activeByType||{};
  const refs=[];
  const mapped=[];
  for(const type of types){
    const rewardId=clean(activeByType[type]);
    if(!rewardId)continue;
    refs.push(rootRef.collection("items").doc(cosmeticDocId(type,rewardId)));
    mapped.push({type,rewardId});
  }
  if(refs.length===0)return {};
  const snaps=tx
    ?await Promise.all(refs.map(ref=>tx.get(ref)))
    :await Promise.all(refs.map(ref=>ref.get()));
  const now=Date.now();
  const result={};
  for(let i=0;i<snaps.length;i++){
    const snap=snaps[i];
    const meta=mapped[i];
    if(!snap.exists)continue;
    const item=snap.data()||{};
    const expiresAtMs=Number(item.expiresAtMs||0);
    if(item.active!==true||expiresAtMs<=now)continue;
    result[meta.type]={
      rewardId:meta.rewardId,
      assetKey:clean(item.assetKey)||defaultCosmeticAssetKey(meta.type,meta.rewardId),
      imageUrl:clean(item.imageUrl),
      expiresAtMs,
    };
  }
  return result;
}

export async function recordMicActivity(tx,db,userId,seat,endedAtMs=Date.now()){
  const segments=activeMicSegments(seat,endedAtMs);
  if(!userId||segments.length===0)return;

  const userRef=db.collection("users").doc(userId);
  const dayRefs=segments.map(segment=>
    db.collection("host_mic_activity").doc(userId).collection("days").doc(segment.day)
  );
  const [userSnap,...daySnaps]=await Promise.all([
    tx.get(userRef),
    ...dayRefs.map(ref=>tx.get(ref)),
  ]);
  if(!userSnap.exists)return;

  const user=userSnap.data()||{};
  const requiredMinutes=120;
  const thresholdSeconds=requiredMinutes*60;
  const newlyQualifiedByMonth=new Map();
  const addedSecondsByMonth=new Map();

  for(let index=0;index<segments.length;index++){
    const segment=segments[index];
    const activity=daySnaps[index].data()||{};
    const previousSeconds=Math.max(0,Number(activity.micSeconds||0));
    const nextSeconds=previousSeconds+segment.seconds;
    const wasQualified=activity.qualified===true||previousSeconds>=thresholdSeconds;
    const qualified=nextSeconds>=thresholdSeconds;
    if(!wasQualified&&qualified){
      newlyQualifiedByMonth.set(
        segment.month,
        (newlyQualifiedByMonth.get(segment.month)||0)+1,
      );
    }
    const previousEligibleSeconds=Math.min(previousSeconds,thresholdSeconds);
    const nextEligibleSeconds=Math.min(nextSeconds,thresholdSeconds);
    const eligibleDeltaSeconds=Math.max(
      0,
      nextEligibleSeconds-previousEligibleSeconds,
    );
    addedSecondsByMonth.set(
      segment.month,
      (addedSecondsByMonth.get(segment.month)||0)+eligibleDeltaSeconds,
    );
    tx.set(dayRefs[index],{
      day:segment.day,
      micSeconds:nextSeconds,
      qualified,
      requiredMinutes,
      updatedAt:FieldValue.serverTimestamp(),
    },{merge:true});
  }

  const currentMonth=segments[segments.length-1].month;
  const sameMonth=String(user.giftHostActivityMonth||"")===currentMonth;
  const previousMonthSeconds=sameMonth
    ?Math.max(0,Number(user.giftHostMicSecondsMonth||0))
    :0;
  const previousQualifiedDays=sameMonth
    ?Math.max(0,Number(user.giftHostQualifiedDays||0))
    :0;
  tx.set(userRef,{
    giftHostActivityMonth:currentMonth,
    giftHostMicSecondsMonth:
      previousMonthSeconds+(addedSecondsByMonth.get(currentMonth)||0),
    giftHostQualifiedDays:
      previousQualifiedDays+(newlyQualifiedByMonth.get(currentMonth)||0),
    giftHostActivityUpdatedAt:FieldValue.serverTimestamp(),
  },{merge:true});

  const agencyId=clean(user.agencyId);
  if(agencyId){
    for(const [month,count] of newlyQualifiedByMonth.entries()){
      if(count<=0)continue;
      const hostMonthId=agencyId+"__"+month+"__"+userId;
      const agencyMonthRef=db
        .collection("agency_support_stats")
        .doc(agencyId)
        .collection("monthly")
        .doc(month);
      const hostMonthRef=db.collection("agency_host_monthly").doc(hostMonthId);
      tx.set(hostMonthRef,{
        agencyId,
        hostUid:userId,
        month,
        surplusPageKey:hostMonthId,
        activityQualifiedDays:FieldValue.increment(count),
        activityRequiredQualifiedDays:14,
        activityRequiredMinutesPerDay:requiredMinutes,
        activityUpdatedAt:FieldValue.serverTimestamp(),
      },{merge:true});
      tx.set(agencyMonthRef,{
        activeHostIds:FieldValue.arrayUnion(userId),
        updatedAt:FieldValue.serverTimestamp(),
      },{merge:true});
    }
  }
}

function zegoUserId(firebaseUid){
  const digest=createHash("sha256").update(firebaseUid).digest("hex");
  return "u_"+digest.slice(0,40);
}

function generateToken04(appId,userId,secret,effectiveSeconds){
  if(!Number.isInteger(appId)||appId<=0)throw new ApiError("zego_app_id_invalid",500);
  if(typeof secret!=="string"||Buffer.byteLength(secret,"utf8")!==32){
    throw new ApiError("zego_server_secret_invalid",500);
  }
  const now=Math.floor(Date.now()/1000);
  const expires=now+effectiveSeconds;
  const body=JSON.stringify({
    app_id:appId,
    user_id:userId,
    nonce:randomInt(-2147483648,2147483647),
    ctime:now,
    expire:expires,
    payload:"",
  });
  const iv=randomBytes(16);
  const cipher=createCipheriv("aes-256-cbc",Buffer.from(secret,"utf8"),iv);
  const encrypted=Buffer.concat([cipher.update(body,"utf8"),cipher.final()]);
  const expireBuffer=Buffer.alloc(8);
  expireBuffer.writeBigInt64BE(BigInt(expires));
  const ivLength=Buffer.alloc(2);
  ivLength.writeUInt16BE(iv.length);
  const encryptedLength=Buffer.alloc(2);
  encryptedLength.writeUInt16BE(encrypted.length);
  const packed=Buffer.concat([expireBuffer,ivLength,iv,encryptedLength,encrypted]);
  return {token:"04"+packed.toString("base64"),expiresAt:expires};
}

function config(){
  const appId=Number(clean(legacyEnv.ZEGO_APP_ID));
  const secret=clean(legacyEnv.ZEGO_SERVER_SECRET);
  return {
    appId:Number.isInteger(appId)&&appId>0?appId:null,
    secretValid:Buffer.byteLength(secret,"utf8")===32,
    secret,
  };
}

function searchTokens(name,publicId){
  const values=new Set([publicId]);
  const normalized=clean(name).toLowerCase().replace(/\s+/g," ");
  if(normalized){
    values.add(normalized);
    for(const word of normalized.split(" ")){
      for(let i=1;i<=Math.min(word.length,24);i++)values.add(word.slice(0,i));
    }
  }
  return [...values].slice(0,128);
}

function hashRoomPassword(password){
  const salt=randomBytes(16).toString("hex");
  const hash=scryptSync(password,salt,64).toString("hex");
  return {salt,hash};
}

function verifyRoomPassword(room,password){
  const salt=clean(room.passwordSalt);
  const expectedHex=clean(room.passwordHash);
  if(!salt||!/^[a-f0-9]{128}$/i.test(expectedHex))return false;
  const expected=Buffer.from(expectedHex,"hex");
  const actual=scryptSync(password,salt,64);
  return expected.length===actual.length&&timingSafeEqual(expected,actual);
}

function roomPermissions(user){
  const data=user||{};
  const capabilities=Array.isArray(data.capabilities)?data.capabilities:[];
  const role=clean(data.role);
  const appOwner=role==="owner";
  const ownerAbsoluteRoomAccess=appOwner&&data.ownerAbsoluteRoomAccess!==false;
  return {
    appOwner,
    ownerAbsoluteRoomAccess,
    manageRooms:ownerAbsoluteRoomAccess||(data.adminEnabled===true&&(capabilities.includes("manageRooms")||capabilities.includes("manage_rooms"))),
    hidden:appOwner||(data.adminEnabled===true&&capabilities.includes("canCreateHiddenRoom")),
    manageIds:ownerAbsoluteRoomAccess||(data.adminEnabled===true&&(capabilities.includes("manageIds")||capabilities.includes("manage_ids"))),
  };
}

function absoluteRoomAccessAudit(room,actor,uid){
  const permissions=roomPermissions(actor);
  const actualOwner=!isOfficialRoom(room)&&roomOwnerUid(room)===uid;
  if(!permissions.ownerAbsoluteRoomAccess||actualOwner)return {};
  return {
    authoritySource:"ownerAbsoluteRoomAccess",
    absoluteRoomAccess:true,
  };
}

const ROOM_MODERATOR_CAPABILITIES=[
  "manageMic",
  "moderateUsers",
  "moderateChat",
  "manageMusic",
  "manageMusicPolicy",
  "managePk",
  "manageIds",
];

function roomControlOverrides(room){
  const raw=room.controlOverrides&&typeof room.controlOverrides==="object"
    ? room.controlOverrides
    : {};
  const parseOptionalInt=(value,min,max)=>{
    if(value===null||value===undefined||value==="")return null;
    const parsed=Number(value);
    return Number.isInteger(parsed)&&parsed>=min&&parsed<=max?parsed:null;
  };
  return {
    seats:parseOptionalInt(raw.seats,1,50),
    moderators:parseOptionalInt(raw.moderators,0,30),
    bypassLevelCapacity:raw.bypassLevelCapacity===true,
  };
}

function isOfficialRoom(room){
  const type=clean(room.roomType||room.type||"personal");
  return room.systemOwned===true||room.officialRoom===true||
    type==="official"||type==="administrative"||type==="customer_service";
}

function roomFeatureFlags(room){
  const type=clean(room.roomType||room.type||"personal");
  const customerService=type==="customer_service";
  const read=(key,defaultValue)=>
    Object.prototype.hasOwnProperty.call(room,key)
      ? room[key]===true
      : defaultValue;
  return {
    giftsEnabled:read("giftsEnabled",!customerService),
    pkEnabled:read("pkEnabled",!customerService),
    gamesEnabled:read("gamesEnabled",!customerService),
    roomRocketEnabled:read("roomRocketEnabled",!customerService),
  };
}

function roomModeratorLimit(room){
  const level=Math.max(1,Math.min(6,Number(room.level||1)));
  const type=clean(room.roomType||room.type||"personal");
  if(type==="customer_service")return 2;
  const overrides=roomControlOverrides(room);
  if((isOfficialRoom(room)||overrides.bypassLevelCapacity)&&overrides.moderators!==null){
    return overrides.moderators;
  }
  const agency=[5,6,7,9,11,14];
  const normal=[3,4,5,7,9,12];
  return (type==="agency"?agency:normal)[level-1];
}

function normalizeRoomModerators(room){
  const raw=Array.isArray(room.moderators)?room.moderators:[];
  const seen=new Set();
  const result=[];
  for(const item of raw){
    const uid=clean(item?.uid);
    if(!uid||seen.has(uid))continue;
    seen.add(uid);
    const capabilities=Array.isArray(item?.capabilities)
      ? item.capabilities.map(clean).filter(cap=>ROOM_MODERATOR_CAPABILITIES.includes(cap))
      : [];
    result.push({
      uid,
      displayName:clean(item?.displayName||"مستخدم Shadow Live"),
      profileImageUrl:clean(item?.profileImageUrl),
      capabilities:[...new Set(capabilities)],
    });
  }
  return result.slice(0,roomModeratorLimit(room));
}

function roomModeratorEntry(room,uid){
  return normalizeRoomModerators(room).find(item=>item.uid===uid)||null;
}

const OFFICIAL_HOST_CAPABILITIES=[
  "manageMic",
  "moderateUsers",
  "moderateChat",
  "manageMusic",
  "manageMusicPolicy",
  "managePk",
];

function roomOwnerUid(room){
  return clean(room.ownerUid||room.ownerId);
}

function roomHostUid(room){
  return clean(room.hostUid||room.hostId);
}

const AGENCY_MANAGER_ROOM_CAPABILITIES=[
  "manageMic",
  "moderateUsers",
  "moderateChat",
  "manageMusic",
  "manageMusicPolicy",
  "managePk",
];

function agencyRoomManagementCapabilities(room,actor,uid){
  const roomType=clean(room.roomType||room.type||"personal");
  const roomAgencyId=clean(room.agencyId);
  if(roomType!=="agency"||!/^[0-9]{3,8}$/.test(roomAgencyId))return [];
  if(clean(actor?.agencyId)!==roomAgencyId)return [];
  const role=clean(actor?.agencyRole);
  if(role==="owner"&&roomOwnerUid(room)===uid)return ROOM_MODERATOR_CAPABILITIES;
  if(role==="manager"||role==="senior_manager"){
    return AGENCY_MANAGER_ROOM_CAPABILITIES;
  }
  return [];
}

function hasRoomCapability(room,uid,capability){
  const ownerUid=roomOwnerUid(room);
  if(!isOfficialRoom(room)&&ownerUid===uid)return true;
  if(isOfficialRoom(room)&&roomHostUid(room)===uid&&OFFICIAL_HOST_CAPABILITIES.includes(capability)){
    return true;
  }
  const moderator=roomModeratorEntry(room,uid);
  return Boolean(moderator&&moderator.capabilities.includes(capability));
}

function canManageRoomAction(room,actor,uid,capability){
  const global=roomPermissions(actor);
  const agencyCapabilities=agencyRoomManagementCapabilities(room,actor,uid);
  return (!isOfficialRoom(room)&&roomOwnerUid(room)===uid)
    ||global.manageRooms
    ||agencyCapabilities.includes(capability)
    ||hasRoomCapability(room,uid,capability);
}

async function roomModeratorState(db,uid,roomId){
  if(!/^[A-Za-z0-9_-]{1,180}$/.test(roomId))throw new ApiError("invalid_room_id",400);
  const [roomSnap,actorSnap]=await Promise.all([
    db.collection("rooms").doc(roomId).get(),
    db.collection("users").doc(uid).get(),
  ]);
  if(!roomSnap.exists)throw new ApiError("room_not_found",404);
  const room=roomSnap.data()||{};
  const actor=actorSnap.data()||{};
  const ownerUid=roomOwnerUid(room);
  const hostUid=roomHostUid(room);
  const global=roomPermissions(actor);
  const myModerator=roomModeratorEntry(room,uid);
  const hostCapabilities=isOfficialRoom(room)&&hostUid===uid
    ? OFFICIAL_HOST_CAPABILITIES
    : [];
  const agencyCapabilities=agencyRoomManagementCapabilities(room,actor,uid);
  const actualOwner=!isOfficialRoom(room)&&ownerUid===uid;
  return {
    ok:true,
    roomId,
    ownerUid,
    hostUid,
    isOwner:actualOwner,
    isHost:isOfficialRoom(room)&&hostUid===uid,
    platformOwner:global.appOwner,
    ownerAbsoluteRoomAccess:global.ownerAbsoluteRoomAccess,
    globalRoomManage:global.manageRooms,
    canManage:actualOwner
      ||global.manageRooms
      ||hostCapabilities.length>0
      ||agencyCapabilities.length>0,
    limit:roomModeratorLimit(room),
    capabilities:ROOM_MODERATOR_CAPABILITIES,
    myCapabilities:(actualOwner||global.manageRooms)
      ? ROOM_MODERATOR_CAPABILITIES
      : [...new Set([
          ...hostCapabilities,
          ...agencyCapabilities,
          ...(myModerator?.capabilities||[]),
        ])],
    moderators:normalizeRoomModerators(room),
  };
}

async function setRoomModerator(db,uid,body){
  const roomId=clean(body.roomId);
  let targetUid=clean(body.targetUid);
  const targetPublicId=clean(body.targetPublicId);
  const enabled=body.enabled!==false;
  const requestedCaps=Array.isArray(body.capabilities)
    ? [...new Set(body.capabilities.map(clean).filter(cap=>ROOM_MODERATOR_CAPABILITIES.includes(cap)))]
    : [];

  if(!/^[A-Za-z0-9_-]{1,180}$/.test(roomId))throw new ApiError("invalid_room_id",400);
  if(!targetUid&&targetPublicId){
    if(!/^[0-9]{3,8}$/.test(targetPublicId))throw new ApiError("invalid_public_id",400);
    const publicSnap=await db.collection("public_ids").doc(targetPublicId).get();
    targetUid=clean(publicSnap.data()?.uid);
  }
  if(!targetUid||targetUid===uid)throw new ApiError("invalid_target",400);
  if(enabled&&requestedCaps.length===0)throw new ApiError("capabilities_required",400);

  const roomRef=db.collection("rooms").doc(roomId);
  const actorRef=db.collection("users").doc(uid);
  const profileRef=db.collection("public_profiles").doc(targetUid);
  const auditRef=db.collection("room_audit_logs").doc(roomId).collection("items").doc();

  return db.runTransaction(async tx=>{
    const [roomSnap,actorSnap,profileSnap]=await Promise.all([
      tx.get(roomRef),tx.get(actorRef),tx.get(profileRef),
    ]);
    if(!roomSnap.exists)throw new ApiError("room_not_found",404);
    if(!profileSnap.exists)throw new ApiError("target_not_found",404);
    const room=roomSnap.data()||{};
    const actor=actorSnap.data()||{};
    const ownerUid=roomOwnerUid(room);
    const global=roomPermissions(actor);
    if((isOfficialRoom(room)||ownerUid!==uid)&&!global.manageRooms)throw new ApiError("forbidden",403);
    if(ownerUid&&targetUid===ownerUid)throw new ApiError("owner_already_full_access",409);
    if(isOfficialRoom(room)&&targetUid===roomHostUid(room))throw new ApiError("host_session_role_managed_by_control",409);

    let moderators=normalizeRoomModerators(room);
    const previous=moderators.find(item=>item.uid===targetUid)||null;

    if(!enabled){
      moderators=moderators.filter(item=>item.uid!==targetUid);
    }else{
      const profile=profileSnap.data()||{};
      const next={
        uid:targetUid,
        displayName:clean(profile.displayName||profile.username||"مستخدم Shadow Live"),
        profileImageUrl:clean(profile.profileImageUrl),
        capabilities:requestedCaps,
      };
      const existingIndex=moderators.findIndex(item=>item.uid===targetUid);
      if(existingIndex>=0){
        moderators[existingIndex]=next;
      }else{
        if(moderators.length>=roomModeratorLimit(room))throw new ApiError("moderator_limit_reached",409);
        moderators.push(next);
      }
    }

    tx.update(roomRef,{
      moderators,
      updatedAt:FieldValue.serverTimestamp(),
    });
    tx.create(auditRef,{
      action:enabled?(previous?"updateModerator":"addModerator"):"removeModerator",
      actorUid:uid,
      ...absoluteRoomAccessAudit(room,actor,uid),
      targetUid,
      before:previous,
      after:enabled?(moderators.find(item=>item.uid===targetUid)||null):null,
      createdAt:FieldValue.serverTimestamp(),
    });

    return {
      ok:true,
      roomId,
      limit:roomModeratorLimit(room),
      moderators,
    };
  });
}

function roomResponse(roomId,data){
  const roomType=clean(data.roomType||data.type||"personal");
  const agencyId=clean(data.agencyId);
  return {
    roomId,
    name:clean(data.name||data.title||"غرفتي"),
    publicId:clean(data.publicId),
    ownerUid:clean(data.ownerUid||data.ownerId),
    hostUid:clean(data.hostUid||data.hostId),
    roomType,
    agencyId:roomType==="agency"&&/^\d{3,8}$/.test(agencyId)?agencyId:"",
    agencyName:roomType==="agency"?clean(data.agencyName):"",
    agencyLogoUrl:roomType==="agency"?clean(data.agencyLogoUrl):"",
    agencyRoomImageUrl:
      roomType==="agency"?clean(data.agencyRoomImageUrl||data.roomImageUrl):"",
    agencyRoomImageObjectId:
      roomType==="agency"?clean(data.agencyRoomImageObjectId||data.roomImageObjectId):"",
    category:roomType==="agency"?"وكالة":clean(data.category||"دردشة"),
    ownerName:clean(data.ownerName),
    ownerLocation:clean(data.ownerLocation),
    chatEnabled:data.chatEnabled!==false,
    ...roomFeatureFlags(data),
    description:clean(data.description),
    tags:Array.isArray(data.tags)?data.tags.map(clean).filter(Boolean).slice(0,8):[],
    visibility:clean(data.visibility||"public"),
    isHidden:data.isHidden===true||clean(data.visibility)==="hidden",
    passwordProtected:clean(data.visibility)==="password",
    roomImageUrl:clean(data.roomImageUrl||data.coverImageUrl||data.imageUrl),
    roomImageObjectId:clean(data.roomImageObjectId||data.coverImageObjectId),
    coverImageUrl:clean(data.coverImageUrl||data.roomImageUrl||data.imageUrl),
    coverImageObjectId:clean(data.coverImageObjectId||data.roomImageObjectId),
    onlineCount:Math.max(0,Number(data.onlineCount||data.participantsCount||0)),
    level:Math.max(1,Number(data.level||1)),
    isActive:data.isActive!==false,
  };
}

async function openPersonalRoom(db,uid,{forceAgency=false}={}){
  const roomId="personal_"+uid;
  const roomRef=db.collection("rooms").doc(roomId);
  const userRef=db.collection("users").doc(uid);

  const existing=await roomRef.get();
  if(existing.exists&&!forceAgency){
    const data=existing.data()||{};
    if(clean(data.ownerUid||data.hostId)!==uid){
      throw new ApiError("room_owner_mismatch",409);
    }

    // Fast path: opening an already-active personal room is read-only.
    // Avoid rewriting rooms/{roomId} and users/{uid} on every tap.
    if(data.isActive!==false){
      return roomResponse(roomId,data);
    }

    const reactivated={
      isActive:true,
      closedAt:FieldValue.delete(),
      updatedAt:FieldValue.serverTimestamp(),
    };
    await roomRef.set(reactivated,{merge:true});
    return roomResponse(roomId,{...data,...reactivated});
  }

  const userSnap=await userRef.get();
  if(!userSnap.exists)throw new ApiError("user_not_found",404);
  const user=userSnap.data()||{};
  const displayName=clean(user.displayName||user.username||"مستخدم Shadow Live");
  const ownerLocation=clean(user.location);
  const linkedAgencyId=clean(user.agencyId);
  const isAgencyOwner=
    clean(user.agencyRole)==="owner"&&/^\d{3,8}$/.test(linkedAgencyId);
  if(forceAgency&&!isAgencyOwner){
    throw new ApiError("agency_owner_required",403);
  }
  const createAsAgency=isAgencyOwner;

  for(let attempt=0;attempt<40;attempt++){
    const publicId=String(randomInt(100000,1000000));
    try{
      const result=await db.runTransaction(async tx=>{
        const publicRef=db.collection("room_ids").doc(publicId);
        const userPublicRef=db.collection("public_ids").doc(publicId);
        const agencyRef=createAsAgency
          ?db.collection("agencies").doc(linkedAgencyId)
          :null;
        const snapshots=await Promise.all([
          tx.get(roomRef),
          tx.get(publicRef),
          tx.get(userPublicRef),
          ...(agencyRef?[tx.get(agencyRef)]:[]),
        ]);
        const [roomNow,roomIdCollision,userIdCollision]=snapshots;
        const agencySnap=agencyRef?snapshots[3]:null;
        const agency=agencySnap?.exists?agencySnap.data()||{}:null;
        if(createAsAgency&&(
          !agencySnap?.exists||
          clean(agency?.ownerUid)!==uid||
          clean(agency?.status||"active")!=="active"
        )){
          throw new ApiError("agency_owner_state_corrupt",409);
        }

        if(roomNow.exists){
          const data=roomNow.data()||{};
          if(clean(data.ownerUid||data.hostId)!==uid)throw new ApiError("room_owner_mismatch",409);
          const roomPatch={
            isActive:true,
            closedAt:FieldValue.delete(),
            updatedAt:FieldValue.serverTimestamp(),
            ...(createAsAgency?{
              roomType:"agency",
              type:"agency",
              agencyId:linkedAgencyId,
              agencyName:clean(agency?.name),
              agencyLogoUrl:clean(agency?.logoUrl||agency?.imageUrl),
              agencyCoverUrl:clean(agency?.coverUrl||agency?.coverImageUrl),
              agencyRoomImageUrl:clean(agency?.roomImageUrl),
              agencyRoomImageObjectId:clean(agency?.roomImageObjectId),
              category:"وكالة",
            }:{})
          };
          tx.set(roomRef,roomPatch,{merge:true});
          tx.set(userRef,{personalRoomId:roomId},{merge:true});
          if(agencyRef){
            tx.set(agencyRef,{roomId,updatedAt:FieldValue.serverTimestamp()},{merge:true});
          }
          return roomResponse(roomId,{...data,...roomPatch});
        }
        if(roomIdCollision.exists||userIdCollision.exists){
          throw new ApiError("room_public_id_taken",409);
        }

        const name=displayName+" — الغرفة";
        const now=FieldValue.serverTimestamp();
        const data={
          name,
          title:name,
          ownerUid:uid,
          hostId:uid,
          roomType:createAsAgency?"agency":"personal",
          type:createAsAgency?"agency":"personal",
          ...(createAsAgency?{
            agencyId:linkedAgencyId,
            agencyName:clean(agency?.name),
            agencyLogoUrl:clean(agency?.logoUrl||agency?.imageUrl),
            agencyCoverUrl:clean(agency?.coverUrl||agency?.coverImageUrl),
            agencyRoomImageUrl:clean(agency?.roomImageUrl),
            agencyRoomImageObjectId:clean(agency?.roomImageObjectId),
          }:{}),
          category:createAsAgency?"وكالة":"دردشة",
          ownerName:displayName,
          ownerLocation,
          chatEnabled:true,
          visibility:"public",
          isHidden:false,
          isActive:true,
          isFeatured:false,
          onlineCount:0,
          participantsCount:0,
          level:1,
          levelPoints:0,
          levelTarget:1000,
          followerCount:0,
          dailySupport:0,
          seats:Array.from({length:createAsAgency?10:8},(_,index)=>({
            index,uid:"",displayName:"",profileImageUrl:"",muted:true,
          })),
          micInvites:[],
          micRequests:[],
          moderators:[],
          musicPolicy:{allowMembers:false},
          musicQueue:[],
          musicState:{
            status:"stopped",
            currentTrackId:"",
            sourceOwnerUid:"",
            requestedBy:"",
            startedAtMs:0,
            commandRevision:0,
          },
          publicId,
          searchTokens:searchTokens(name+" "+displayName+" "+ownerLocation+" دردشة",publicId),
          createdAt:now,
          updatedAt:now,
        };
        tx.create(roomRef,data);
        tx.create(publicRef,{
          roomId,
          ownerUid:uid,
          source:createAsAgency?"agencyRoom":"personalRoom",
          createdAt:now,
        });
        tx.set(userRef,{personalRoomId:roomId},{merge:true});
        if(agencyRef){
          tx.set(agencyRef,{roomId,updatedAt:now},{merge:true});
        }
        return roomResponse(roomId,data);
      });
      return result;
    }catch(error){
      if(error instanceof ApiError&&error.code==="room_public_id_taken")continue;
      throw error;
    }
  }
  throw new ApiError("room_public_id_exhausted",503);
}

async function changeRoomPublicId(db,uid,body){
  const roomId=clean(body.roomId);
  const newPublicId=clean(body.publicId);
  if(!/^[A-Za-z0-9_-]{1,180}$/.test(roomId))throw new ApiError("invalid_room_id",400);
  if(!/^[0-9]{3,8}$/.test(newPublicId))throw new ApiError("invalid_public_id",400);

  const roomRef=db.collection("rooms").doc(roomId);
  const userRef=db.collection("users").doc(uid);
  const newRoomIdRef=db.collection("room_ids").doc(newPublicId);
  const userIdRef=db.collection("public_ids").doc(newPublicId);
  const auditRef=db.collection("room_audit_logs").doc(roomId).collection("items").doc();

  return db.runTransaction(async tx=>{
    const [roomSnap,userSnap,newRoomIdSnap,userIdSnap]=await Promise.all([
      tx.get(roomRef),tx.get(userRef),tx.get(newRoomIdRef),tx.get(userIdRef),
    ]);
    if(!roomSnap.exists)throw new ApiError("room_not_found",404);
    const room=roomSnap.data()||{};
    const user=userSnap.data()||{};
    const ownerUid=clean(room.ownerUid||room.ownerId||room.hostId);
    const permissions=roomPermissions(user);
    const canManageId=canManageRoomAction(room,user,uid,"manageIds")||permissions.manageIds;
    if(!canManageId)throw new ApiError("forbidden",403);
    const oldPublicId=clean(room.publicId);
    if(oldPublicId===newPublicId){
      return {ok:true,roomId,publicId:newPublicId,unchanged:true};
    }
    if(newRoomIdSnap.exists||userIdSnap.exists)throw new ApiError("public_id_taken",409);

    const now=FieldValue.serverTimestamp();
    tx.create(newRoomIdRef,{
      roomId,
      ownerUid,
      source:"roomIdChange",
      active:true,
      reserved:true,
      createdAt:now,
    });

    if(oldPublicId){
      const oldRef=db.collection("room_ids").doc(oldPublicId);
      tx.delete(oldRef);
    }

    const name=clean(room.name||room.title||"غرفتي");
    tx.update(roomRef,{
      publicId:newPublicId,
      searchTokens:searchTokens(
        name+" "+(Array.isArray(room.tags)?room.tags.map(clean).join(" "):"")+" "+
        clean(room.category)+" "+clean(room.ownerName)+" "+clean(room.ownerLocation),
        newPublicId,
      ),
      updatedAt:now,
    });
    tx.create(auditRef,{
      action:"changeRoomPublicId",
      actorUid:uid,
      before:{publicId:oldPublicId},
      after:{publicId:newPublicId},
      createdAt:now,
    });

    return {ok:true,roomId,publicId:newPublicId,oldPublicId};
  });
}

async function updateRoomSettings(db,uid,body){
  const roomId=clean(body.roomId);
  if(!/^[A-Za-z0-9_-]{1,180}$/.test(roomId))throw new ApiError("invalid_room_id",400);

  const name=clean(body.name);
  const description=clean(body.description);
  const category=clean(body.category)||"دردشة";
  const visibility=clean(body.visibility)||"public";
  const password=String(body.password??"");
  const chatEnabled=body.chatEnabled!==false;
  const roomImageUrl=clean(body.roomImageUrl||body.coverImageUrl);
  const roomImageObjectIdProvided=
    Object.prototype.hasOwnProperty.call(body,"roomImageObjectId")||
    Object.prototype.hasOwnProperty.call(body,"coverImageObjectId");
  const roomImageObjectId=clean(body.roomImageObjectId||body.coverImageObjectId);
  const tags=Array.isArray(body.tags)
    ? [...new Set(body.tags.map(clean).filter(Boolean))].slice(0,8)
    : [];

  if(name.length<2||name.length>60)throw new ApiError("invalid_room_name",400);
  if(description.length>240)throw new ApiError("invalid_room_description",400);
  if(category.length>30)throw new ApiError("invalid_room_category",400);
  if(tags.some(tag=>tag.length>24))throw new ApiError("invalid_room_tags",400);
  if(!["public","password","hidden"].includes(visibility))throw new ApiError("invalid_visibility",400);
  if(visibility==="password"&&password&&password.length<4)throw new ApiError("room_password_too_short",400);
  if(password.length>32)throw new ApiError("room_password_too_long",400);
  if(roomImageUrl&&(!/^https?:\/\//i.test(roomImageUrl)||roomImageUrl.length>1200)){
    throw new ApiError("invalid_room_image",400);
  }
  if(roomImageObjectIdProvided&&roomImageObjectId&&!/^[a-f0-9]{32}$/.test(roomImageObjectId)){
    throw new ApiError("invalid_room_image_object",400);
  }

  const roomRef=db.collection("rooms").doc(roomId);
  const userRef=db.collection("users").doc(uid);
  const auditRef=db.collection("room_audit_logs").doc(roomId).collection("items").doc();
  const roomImageObjectRef=roomImageObjectId
    ? db.collection("storage_objects").doc(roomImageObjectId)
    : null;

  return db.runTransaction(async tx=>{
    const reads=[tx.get(roomRef),tx.get(userRef)];
    if(roomImageObjectRef)reads.push(tx.get(roomImageObjectRef));
    const [roomSnap,userSnap,roomImageObjectSnap]=await Promise.all(reads);
    if(!roomSnap.exists)throw new ApiError("room_not_found",404);
    const room=roomSnap.data()||{};
    const user=userSnap.data()||{};
    const permissions=roomPermissions(user);
    const ownerUid=clean(room.ownerUid||room.ownerId||room.hostId);
    const agencyManager=
      agencyRoomManagementCapabilities(room,user,uid).length>0;
    if(ownerUid!==uid&&!permissions.manageRooms&&!agencyManager){
      throw new ApiError("forbidden",403);
    }
    if(visibility==="hidden"&&!permissions.hidden)throw new ApiError("hidden_room_forbidden",403);

    if(roomImageObjectId){
      if(!roomImageObjectSnap||!roomImageObjectSnap.exists){
        throw new ApiError("room_image_object_not_found",409);
      }
      const media=roomImageObjectSnap.data()||{};
      if(
        clean(media.scope)!=="room_cover"||
        clean(media.targetId)!==roomId||
        clean(media.publicUrl)!==roomImageUrl||
        clean(media.state||"active")!=="active"
      ){
        throw new ApiError("room_image_object_mismatch",409);
      }
    }

    const update={
      name,
      title:name,
      description,
      category,
      tags,
      visibility,
      isHidden:visibility==="hidden",
      chatEnabled,
      roomImageUrl,
      coverImageUrl:roomImageUrl,
      ...(roomImageObjectIdProvided
        ? {
            roomImageObjectId:roomImageObjectId||FieldValue.delete(),
            coverImageObjectId:roomImageObjectId||FieldValue.delete(),
          }
        : {}),
      searchTokens:searchTokens(
        name+" "+tags.join(" ")+" "+category+" "+clean(room.ownerName)+" "+clean(room.ownerLocation),
        clean(room.publicId),
      ),
      updatedAt:FieldValue.serverTimestamp(),
    };

    if(visibility==="password"){
      if(password){
        const protectedValue=hashRoomPassword(password);
        update.passwordSalt=protectedValue.salt;
        update.passwordHash=protectedValue.hash;
      }else if(!room.passwordSalt||!room.passwordHash){
        throw new ApiError("room_password_required",400);
      }
    }else{
      update.passwordSalt=FieldValue.delete();
      update.passwordHash=FieldValue.delete();
    }

    tx.update(roomRef,update);
    tx.create(auditRef,{
      action:"updateRoomSettings",
      actorUid:uid,
      ...absoluteRoomAccessAudit(room,user,uid),
      before:{
        name:clean(room.name||room.title),
        description:clean(room.description),
        category:clean(room.category),
        tags:Array.isArray(room.tags)?room.tags.map(clean):[],
        visibility:clean(room.visibility||"public"),
        chatEnabled:room.chatEnabled!==false,
        coverImageUrl:clean(room.coverImageUrl||room.imageUrl),
        coverImageObjectId:clean(room.coverImageObjectId),
        passwordProtected:Boolean(room.passwordSalt&&room.passwordHash),
      },
      after:{
        name,
        description,
        category,
        tags,
        visibility,
        chatEnabled,
        roomImageUrl,
        roomImageObjectId:roomImageObjectIdProvided
          ? roomImageObjectId
          : clean(room.roomImageObjectId||room.coverImageObjectId),
        coverImageUrl:roomImageUrl,
        coverImageObjectId:roomImageObjectIdProvided
          ? roomImageObjectId
          : clean(room.coverImageObjectId||room.roomImageObjectId),
        passwordProtected:visibility==="password",
      },
      createdAt:FieldValue.serverTimestamp(),
    });
    return {
      ok:true,
      room:roomResponse(roomId,{...room,...update}),
    };
  });
}

async function setRoomChatEnabled(db,uid,body){
  const roomId=clean(body.roomId);
  const enabled=body.enabled===true;
  if(!/^[A-Za-z0-9_-]{1,180}$/.test(roomId))throw new ApiError("invalid_room_id",400);
  const roomRef=db.collection("rooms").doc(roomId);
  const actorRef=db.collection("users").doc(uid);
  const auditRef=db.collection("room_audit_logs").doc(roomId).collection("items").doc();

  const result=await db.runTransaction(async tx=>{
    const [roomSnap,actorSnap,targetSnap]=await Promise.all([
      tx.get(roomRef),
      tx.get(actorRef),
      tx.get(targetRef),
    ]);
    if(!roomSnap.exists)throw new ApiError("room_not_found",404);
    const room=roomSnap.data()||{};
    const actor=actorSnap.data()||{};
    const target=targetSnap.data()||{};
    if(!canManageRoomAction(room,actor,uid,"moderateChat"))throw new ApiError("forbidden",403);

    const before=room.chatEnabled!==false;
    tx.update(roomRef,{
      chatEnabled:enabled,
      updatedAt:FieldValue.serverTimestamp(),
    });
    tx.create(auditRef,{
      action:"setRoomChatEnabled",
      actorUid:uid,
      ...absoluteRoomAccessAudit(room,actor,uid),
      before:{chatEnabled:before},
      after:{chatEnabled:enabled},
      createdAt:FieldValue.serverTimestamp(),
    });
    return {ok:true,roomId,chatEnabled:enabled};
  });

  invalidateRoomRealtimeAdmissionCache(roomId);
  try{
    await setRoomRealtimeChatPolicy(legacyEnv,roomId,enabled);
  }catch(_){}
  return result;
}

async function closePersonalRoom(db,uid,roomId){
  if(!/^personal_[A-Za-z0-9:_-]{1,160}$/.test(roomId))throw new ApiError("invalid_room_id",400);
  const ref=db.collection("rooms").doc(roomId);
  const auditRef=db.collection("room_audit_logs").doc(roomId).collection("items").doc();
  await db.runTransaction(async tx=>{
    const snap=await tx.get(ref);
    if(!snap.exists)throw new ApiError("room_not_found",404);
    const data=snap.data()||{};
    if(clean(data.ownerUid||data.hostId)!==uid||clean(data.roomType||data.type)!=="personal"){
      throw new ApiError("forbidden",403);
    }
    tx.update(ref,{
      isActive:false,
      onlineCount:0,
      participantsCount:0,
      closedAt:FieldValue.serverTimestamp(),
      updatedAt:FieldValue.serverTimestamp(),
    });
    tx.create(auditRef,{
      action:"closePersonalRoom",
      actorUid:uid,
      before:{isActive:data.isActive!==false},
      after:{isActive:false},
      createdAt:FieldValue.serverTimestamp(),
    });
  });
  return {ok:true,roomId,isActive:false};
}

function roomSeatCapacity(room){
  const level=Math.max(1,Math.min(6,Number(room.level||1)));
  const type=clean(room.roomType||room.type||"personal");
  if(type==="customer_service")return 5;
  const overrides=roomControlOverrides(room);
  if((isOfficialRoom(room)||overrides.bypassLevelCapacity)&&overrides.seats!==null){
    return overrides.seats;
  }
  const agency=[10,12,14,16,20,22];
  const normal=[8,10,12,15,20,20];
  return (type==="agency"?agency:normal)[level-1];
}

function normalizeUidList(value){
  if(!Array.isArray(value))return [];
  const seen=new Set();
  const result=[];
  for(const raw of value){
    const uid=clean(raw);
    if(!uid||seen.has(uid))continue;
    seen.add(uid);
    result.push(uid);
  }
  return result;
}

function normalizeSeats(room){
  const source=Array.isArray(room.seats)?room.seats:[];
  const seats=[];
  const capacity=roomSeatCapacity(room);
  for(let index=0;index<capacity;index++){
    const found=source.find(item=>Number(item?.index)===index)||{};
    seats.push({
      index,
      uid:String(found.uid||""),
      displayName:String(found.displayName||""),
      profileImageUrl:String(found.profileImageUrl||""),
      muted:found.muted!==false,
      micStartedAtMs:Number(found.micStartedAtMs||0),
      customerServiceMicExpiresAtMs:
        Number(found.customerServiceMicExpiresAtMs||0),
      frameRewardId:String(found.frameRewardId||""),
      frameAssetKey:String(found.frameAssetKey||""),
      frameImageUrl:String(found.frameImageUrl||""),
      frameExpiresAtMs:Number(found.frameExpiresAtMs||0),
      voiceWaveRewardId:String(found.voiceWaveRewardId||""),
      voiceWaveAssetKey:String(found.voiceWaveAssetKey||""),
      voiceWaveImageUrl:String(found.voiceWaveImageUrl||""),
      voiceWaveExpiresAtMs:Number(found.voiceWaveExpiresAtMs||0),
    });
  }
  return seats;
}

function roomControlPolicySnapshot(room){
  const level=Math.max(1,Math.min(6,Number(room.level||1)));
  const type=clean(room.roomType||room.type||"personal");
  const overrides=roomControlOverrides(room);
  const agencySeats=[10,12,14,16,20,22];
  const normalSeats=[8,10,12,15,20,20];
  const agencyMods=[5,6,7,9,11,14];
  const normalMods=[3,4,5,7,9,12];
  const baseSeats=type==="customer_service"
    ? 5
    : (type==="agency"?agencySeats:normalSeats)[level-1];
  const baseModerators=type==="customer_service"
    ? 2
    : (type==="agency"?agencyMods:normalMods)[level-1];
  const customerService=type==="customer_service";
  const manual=!customerService&&(isOfficialRoom(room)||overrides.bypassLevelCapacity);
  return {
    level,
    type,
    official:isOfficialRoom(room),
    systemOwned:room.systemOwned===true,
    hostUid:roomHostUid(room),
    features:roomFeatureFlags(room),
    customerServiceMinVipLevel:
      customerService
        ? Math.max(1,Math.min(10,Number(room.customerServiceMinVipLevel||1)))
        : 0,
    customerServiceMode:
      customerService&&Number(room.customerServiceMinVipLevel||1)>=4
        ? "exclusive_1to1"
        : customerService
          ? "vip_standard"
          : "",
    baseSeats,
    baseModerators,
    overrides,
    effectiveSeats:customerService
      ? 5
      : (manual&&overrides.seats!==null?overrides.seats:baseSeats),
    effectiveModerators:customerService
      ? 2
      : (manual&&overrides.moderators!==null?overrides.moderators:baseModerators),
    capacityMode:customerService?"customer_service_fixed":(manual?"manual":"level"),
  };
}

async function createOfficialRoomFromControl(db,uid,body){
  const actorSnap=await db.collection("users").doc(uid).get();
  const actor=actorSnap.data()||{};
  const capabilities=Array.isArray(actor.capabilities)?actor.capabilities.map(clean):[];
  const isOwner=actor.adminEnabled===true&&actor.role==="owner";
  const canGlobal=isOwner||(actor.adminEnabled===true&&capabilities.includes("globalRoomControl"));
  if(!actorSnap.exists||!canGlobal)throw new ApiError("global_room_control_required",403);

  const name=clean(body.name);
  const requestedPublicId=clean(body.publicId);
  const hostUid=clean(body.hostUid);
  const officialType=clean(body.officialType||"official");
  const category=clean(body.category||"رسمية").slice(0,60);
  const description=clean(body.description).slice(0,500);
  const coverImageUrl=clean(body.coverImageUrl).slice(0,1200);
  const visibility=clean(body.visibility||"public");
  const seats=Number(body.seats??(officialType==="customer_service"?5:8));
  const moderators=Number(body.moderators??(officialType==="customer_service"?2:3));
  const reason=clean(body.reason);
  const operationId=clean(body.idempotencyKey);
  const tags=Array.isArray(body.tags)
    ? [...new Set(body.tags.map(clean).filter(Boolean))].slice(0,8)
    : [];
  const customerService=officialType==="customer_service";
  const customerServiceMinVipLevel=customerService
    ? Number(body.customerServiceMinVipLevel??1)
    : 0;
  const featureDefault=!customerService;
  const giftsEnabled=Object.prototype.hasOwnProperty.call(body,"giftsEnabled")
    ? body.giftsEnabled===true
    : featureDefault;
  const pkEnabled=Object.prototype.hasOwnProperty.call(body,"pkEnabled")
    ? body.pkEnabled===true
    : featureDefault;
  const gamesEnabled=Object.prototype.hasOwnProperty.call(body,"gamesEnabled")
    ? body.gamesEnabled===true
    : featureDefault;
  const roomRocketEnabled=Object.prototype.hasOwnProperty.call(body,"roomRocketEnabled")
    ? body.roomRocketEnabled===true
    : featureDefault;

  if(name.length<2||name.length>80)throw new ApiError("invalid_room_name",400);
  if(requestedPublicId&&!/^\d{3,8}$/.test(requestedPublicId))throw new ApiError("invalid_room_public_id",400);
  if(!["official","administrative","customer_service"].includes(officialType)){
    throw new ApiError("invalid_official_room_type",400);
  }
  if(!["public","hidden"].includes(visibility))throw new ApiError("invalid_room_visibility",400);
  if(!Number.isInteger(seats)||seats<1||seats>50)throw new ApiError("invalid_seat_override",400);
  if(!Number.isInteger(moderators)||moderators<0||moderators>30)throw new ApiError("invalid_moderator_override",400);
  if(customerService&&![1,4].includes(customerServiceMinVipLevel)){
    throw new ApiError("invalid_customer_service_vip_level",400);
  }
  if(reason.length<3||reason.length>160||!/^[A-Za-z0-9_-]{12,160}$/.test(operationId)){
    throw new ApiError("invalid_request",400);
  }

  const createWithPublicId=async publicId=>{
    const roomId="official_"+Date.now().toString(36)+"_"+randomBytes(5).toString("hex");
    const roomRef=db.collection("rooms").doc(roomId);
    const roomIdRef=db.collection("room_ids").doc(publicId);
    const userIdRef=db.collection("public_ids").doc(publicId);
    const opRef=db.collection("control_operations").doc(operationId);
    const hostRef=hostUid?db.collection("users").doc(hostUid):null;

    return db.runTransaction(async tx=>{
      const reads=[tx.get(opRef),tx.get(roomRef),tx.get(roomIdRef),tx.get(userIdRef)];
      if(hostRef)reads.push(tx.get(hostRef));
      const snapshots=await Promise.all(reads);
      const [opSnap,roomSnap,roomIdSnap,userIdSnap]=snapshots;
      const hostSnap=hostRef?snapshots[4]:null;

      if(opSnap.exists){
        return {ok:true,code:"duplicate",operationId,...(opSnap.data()?.result||{})};
      }
      if(roomSnap.exists)throw new ApiError("room_id_collision",409);
      if(roomIdSnap.exists||userIdSnap.exists)throw new ApiError("room_public_id_taken",409);
      if(hostUid&&!hostSnap?.exists)throw new ApiError("host_not_found",404);

      const now=FieldValue.serverTimestamp();
      const room={
        name,
        title:name,
        ownerUid:"",
        ownerId:"",
        hostUid,
        hostId:hostUid,
        systemOwned:true,
        officialRoom:true,
        roomType:officialType,
        type:officialType,
        category,
        description,
        coverImageUrl,
        tags,
        chatEnabled:true,
        giftsEnabled,
        pkEnabled,
        gamesEnabled,
        roomRocketEnabled,
        customerServiceMinVipLevel,
        customerServiceMode:
          customerServiceMinVipLevel>=4
            ? "exclusive_1to1"
            : customerService
              ? "vip_standard"
              : "",
        visibility,
        isHidden:visibility==="hidden",
        isActive:true,
        isFeatured:true,
        onlineCount:0,
        participantsCount:0,
        level:1,
        levelPoints:0,
        levelTarget:1000,
        followerCount:0,
        dailySupport:0,
        controlOverrides:{
          seats,
          moderators,
          bypassLevelCapacity:true,
          updatedBy:uid,
        },
        seats:Array.from({length:seats},(_,index)=>({
          index,uid:"",displayName:"",profileImageUrl:"",muted:true,
        })),
        micInvites:[],
        micRequests:[],
        moderators:[],
        musicPolicy:{allowMembers:false},
        musicQueue:[],
        musicState:{
          status:"stopped",
          currentTrackId:"",
          sourceOwnerUid:"",
          requestedBy:"",
          startedAtMs:0,
          commandRevision:0,
        },
        publicId,
        searchTokens:searchTokens(name+" "+category+" "+tags.join(" "),publicId),
        officialCreatedBy:uid,
        officialUpdatedBy:uid,
        createdAt:now,
        updatedAt:now,
      };
      const after=roomControlPolicySnapshot(room);
      const resultData={roomId,publicId,name,policy:after};

      tx.create(roomRef,room);
      tx.create(roomIdRef,{
        roomId,
        ownerUid:"",
        source:"officialRoomControl",
        systemOwned:true,
        active:true,
        reserved:true,
        createdAt:now,
      });
      tx.create(db.collection("admin_audit_logs").doc(),{
        actorUid:uid,
        action:"createOfficialRoom",
        targetType:"room",
        targetId:roomId,
        reason,
        before:null,
        after:{...after,name,publicId,category,visibility},
        operationId,
        createdAt:now,
      });
      tx.create(opRef,{
        action:"createOfficialRoom",
        actorUid:uid,
        targetType:"room",
        targetId:roomId,
        status:"completed",
        result:resultData,
        createdAt:now,
      });
      return {ok:true,code:"ok",operationId,...resultData};
    });
  };

  if(requestedPublicId)return createWithPublicId(requestedPublicId);
  for(let attempt=0;attempt<40;attempt++){
    const generated=String(randomInt(100000,1000000));
    try{
      return await createWithPublicId(generated);
    }catch(error){
      if(error instanceof ApiError&&error.code==="room_public_id_taken")continue;
      throw error;
    }
  }
  throw new ApiError("room_public_id_exhausted",503);
}

async function controlRoomPolicy(db,uid,body){
  let roomId=clean(body.roomId);
  const roomPublicId=clean(body.roomPublicId);
  const controlAction=clean(body.controlAction||"state");

  const actorSnap=await db.collection("users").doc(uid).get();
  const actor=actorSnap.data()||{};
  const global=roomPermissions(actor);
  const capabilities=Array.isArray(actor.capabilities)?actor.capabilities.map(clean):[];
  const isOwner=actor.adminEnabled===true&&actor.role==="owner";
  const canManage=actor.adminEnabled===true&&(
    isOwner||global.manageRooms||capabilities.includes("globalRoomControl")
  );
  const canGlobal=isOwner||(actor.adminEnabled===true&&capabilities.includes("globalRoomControl"));
  if(!actorSnap.exists||!canManage)throw new ApiError("forbidden",403);

  if(controlAction==="createOfficialRoom"){
    return createOfficialRoomFromControl(db,uid,body);
  }

  if(controlAction==="ownerAbsoluteRoomAccessState"){
    if(!isOwner)throw new ApiError("owner_required",403);
    return {ok:true,ownerAbsoluteRoomAccess:global.ownerAbsoluteRoomAccess};
  }

  if(controlAction==="setOwnerAbsoluteRoomAccess"){
    if(!isOwner)throw new ApiError("owner_required",403);
    const enabled=body.enabled===true;
    const reason=clean(body.reason);
    const operationId=clean(body.idempotencyKey);
    if(reason.length<3||reason.length>160||!/^[A-Za-z0-9_-]{12,160}$/.test(operationId)){
      throw new ApiError("invalid_request",400);
    }
    const actorRef=db.collection("users").doc(uid);
    return db.runTransaction(async tx=>{
      const opRef=db.collection("control_operations").doc(operationId);
      const [opSnap,userSnap]=await Promise.all([tx.get(opRef),tx.get(actorRef)]);
      if(opSnap.exists){
        return {ok:true,code:"duplicate",operationId,...(opSnap.data()?.result||{})};
      }
      if(!userSnap.exists||clean(userSnap.data()?.role)!=="owner"){
        throw new ApiError("owner_required",403);
      }
      const before=userSnap.data()?.ownerAbsoluteRoomAccess!==false;
      const now=FieldValue.serverTimestamp();
      tx.update(actorRef,{
        ownerAbsoluteRoomAccess:enabled,
        ownerAbsoluteRoomAccessUpdatedAt:now,
        updatedAt:now,
      });
      const resultData={
        ownerAbsoluteRoomAccess:enabled,
        beforeOwnerAbsoluteRoomAccess:before,
      };
      tx.create(db.collection("admin_audit_logs").doc(),{
        actorUid:uid,
        action:"setOwnerAbsoluteRoomAccess",
        targetType:"owner_room_access",
        targetId:uid,
        reason,
        before:{ownerAbsoluteRoomAccess:before},
        after:{ownerAbsoluteRoomAccess:enabled},
        operationId,
        createdAt:now,
      });
      tx.create(opRef,{
        action:"setOwnerAbsoluteRoomAccess",
        actorUid:uid,
        targetType:"owner_room_access",
        targetId:uid,
        status:"completed",
        result:resultData,
        createdAt:now,
      });
      return {ok:true,code:"ok",operationId,...resultData};
    });
  }

  if(!roomId&&roomPublicId){
    if(!/^\d{3,8}$/.test(roomPublicId))throw new ApiError("invalid_room_public_id",400);
    const idSnap=await db.collection("room_ids").doc(roomPublicId).get();
    roomId=clean(idSnap.data()?.roomId);
  }
  if(!/^[A-Za-z0-9_-]{1,180}$/.test(roomId))throw new ApiError("invalid_room_id",400);

  const roomRef=db.collection("rooms").doc(roomId);
  if(controlAction==="state"){
    const roomSnap=await roomRef.get();
    if(!roomSnap.exists)throw new ApiError("room_not_found",404);
    const room=roomSnap.data()||{};
    return {
      ok:true,
      roomId,
      publicId:clean(room.publicId),
      name:clean(room.name||room.title||"غرفة صوتية"),
      ownerUid:roomOwnerUid(room),
      category:clean(room.category),
      description:clean(room.description),
      coverImageUrl:clean(room.coverImageUrl),
      activeRoomBackgroundRewardId:clean(room.activeRoomBackgroundRewardId),
      activeRoomBackgroundImageUrl:clean(room.activeRoomBackgroundImageUrl),
      activeRoomBackgroundAssetKey:clean(room.activeRoomBackgroundAssetKey),
      activeRoomBackgroundExpiresAtMs:Number(room.activeRoomBackgroundExpiresAtMs||0),
      visibility:clean(room.visibility||"public"),
      tags:Array.isArray(room.tags)?room.tags:[],
      ...roomFeatureFlags(room),
      policy:roomControlPolicySnapshot(room),
    };
  }

  const reason=clean(body.reason);
  const operationId=clean(body.idempotencyKey);
  if(reason.length<3||reason.length>160||!/^[A-Za-z0-9_-]{12,160}$/.test(operationId)){
    throw new ApiError("invalid_request",400);
  }

  return db.runTransaction(async tx=>{
    const opRef=db.collection("control_operations").doc(operationId);
    const [opSnap,roomSnap]=await Promise.all([tx.get(opRef),tx.get(roomRef)]);
    if(opSnap.exists){
      return {ok:true,code:"duplicate",operationId,...(opSnap.data()?.result||{})};
    }
    if(!roomSnap.exists)throw new ApiError("room_not_found",404);
    const room=roomSnap.data()||{};
    const before=roomControlPolicySnapshot(room);
    const now=FieldValue.serverTimestamp();
    let patch={};

    if(["setLevel","raiseLevel","lowerLevel"].includes(controlAction)){
      let next=before.level;
      if(controlAction==="setLevel"){
        next=Number(body.level);
        if(!Number.isInteger(next)||next<1||next>6)throw new ApiError("invalid_room_level",400);
      }else if(controlAction==="raiseLevel"){
        next=Math.min(6,before.level+1);
      }else{
        next=Math.max(1,before.level-1);
      }
      if(next===before.level)throw new ApiError("level_unchanged",409);
      patch={level:next,levelUpdatedAt:now,levelUpdatedBy:uid,updatedAt:now};
    }else if(controlAction==="setOverrides"){
      if(clean(room.roomType||room.type)==="customer_service"){
        throw new ApiError("customer_service_capacity_fixed",409);
      }
      const current=roomControlOverrides(room);
      const parseBounded=(value,min,max,code)=>{
        if(value===null||value===undefined||value==="")return null;
        const n=Number(value);
        if(!Number.isInteger(n)||n<min||n>max)throw new ApiError(code,400);
        return n;
      };
      const seats=Object.prototype.hasOwnProperty.call(body,"seats")
        ? parseBounded(body.seats,1,50,"invalid_seat_override")
        : current.seats;
      const moderators=Object.prototype.hasOwnProperty.call(body,"moderators")
        ? parseBounded(body.moderators,0,30,"invalid_moderator_override")
        : current.moderators;
      patch={
        controlOverrides:{
          seats,
          moderators,
          bypassLevelCapacity:Object.prototype.hasOwnProperty.call(body,"bypassLevelCapacity")
            ? body.bypassLevelCapacity===true
            : current.bypassLevelCapacity,
          updatedBy:uid,
        },
        overrideUpdatedAt:now,
        updatedAt:now,
      };
    }else if(controlAction==="resetOverrides"){
      patch={
        controlOverrides:{seats:null,moderators:null,bypassLevelCapacity:false,updatedBy:uid},
        overrideUpdatedAt:now,
        updatedAt:now,
      };
    }else if(controlAction==="setOfficialRoomBackground"){
      if(!canGlobal)throw new ApiError("global_room_control_required",403);
      if(!before.official)throw new ApiError("official_room_required",409);
      const assetKey=clean(body.backgroundAssetKey);
      const imageUrl=clean(body.backgroundImageUrl);
      if(assetKey&&!/^[A-Za-z0-9_.-]{1,180}$/.test(assetKey)){
        throw new ApiError("invalid_room_background_asset",400);
      }
      if(imageUrl&&(imageUrl.length>1200||!/^https:\/\//i.test(imageUrl))){
        throw new ApiError("invalid_room_background_url",400);
      }
      const enabled=Boolean(assetKey||imageUrl);
      patch=enabled
        ? {
            activeRoomBackgroundRewardId:"system_control",
            activeRoomBackgroundAssetKey:assetKey,
            activeRoomBackgroundImageUrl:imageUrl,
            activeRoomBackgroundExpiresAtMs:0,
            roomBackgroundUpdatedAt:now,
            roomBackgroundUpdatedBy:uid,
            updatedAt:now,
          }
        : {
            activeRoomBackgroundRewardId:FieldValue.delete(),
            activeRoomBackgroundAssetKey:FieldValue.delete(),
            activeRoomBackgroundImageUrl:FieldValue.delete(),
            activeRoomBackgroundExpiresAtMs:FieldValue.delete(),
            roomBackgroundUpdatedAt:now,
            roomBackgroundUpdatedBy:uid,
            updatedAt:now,
          };
    }else if(controlAction==="setCustomerServiceVipMode"){
      if(!canGlobal)throw new ApiError("global_room_control_required",403);
      if(before.type!=="customer_service"){
        throw new ApiError("customer_service_room_required",409);
      }
      const minVipLevel=Number(body.customerServiceMinVipLevel);
      if(![1,4].includes(minVipLevel)){
        throw new ApiError("invalid_customer_service_vip_level",400);
      }
      patch={
        customerServiceMinVipLevel:minVipLevel,
        customerServiceMode:minVipLevel>=4?"exclusive_1to1":"vip_standard",
        customerServiceVipModeUpdatedAt:now,
        customerServiceVipModeUpdatedBy:uid,
        updatedAt:now,
      };
    }else if(controlAction==="setRoomFeatures"){
      if(!canGlobal)throw new ApiError("global_room_control_required",403);
      if(!before.official)throw new ApiError("official_room_required",409);
      const current=roomFeatureFlags(room);
      patch={
        giftsEnabled:Object.prototype.hasOwnProperty.call(body,"giftsEnabled")
          ? body.giftsEnabled===true
          : current.giftsEnabled,
        pkEnabled:Object.prototype.hasOwnProperty.call(body,"pkEnabled")
          ? body.pkEnabled===true
          : current.pkEnabled,
        gamesEnabled:Object.prototype.hasOwnProperty.call(body,"gamesEnabled")
          ? body.gamesEnabled===true
          : current.gamesEnabled,
        roomRocketEnabled:Object.prototype.hasOwnProperty.call(body,"roomRocketEnabled")
          ? body.roomRocketEnabled===true
          : current.roomRocketEnabled,
        featuresUpdatedAt:now,
        featuresUpdatedBy:uid,
        updatedAt:now,
      };
    }else if(controlAction==="setOfficialRoom"){
      if(!canGlobal)throw new ApiError("global_room_control_required",403);
      const enabled=body.enabled===true;
      const hostUid=clean(body.hostUid);
      const officialType=clean(body.officialType||"official");
      if(enabled&&!["official","administrative","customer_service"].includes(officialType)){
        throw new ApiError("invalid_official_room_type",400);
      }
      if(enabled&&hostUid){
        const hostSnap=await tx.get(db.collection("users").doc(hostUid));
        if(!hostSnap.exists)throw new ApiError("host_not_found",404);
      }
      patch={
        systemOwned:enabled,
        officialRoom:enabled,
        roomType:enabled?officialType:clean(room.previousRoomType||room.roomType||room.type||"personal"),
        hostUid:enabled?hostUid:"",
        ...(enabled?{previousRoomType:clean(room.roomType||room.type||"personal")}:{previousRoomType:FieldValue.delete()}),
        ...(enabled&&officialType==="customer_service"&&before.type!=="customer_service"
          ? {giftsEnabled:false,pkEnabled:false,gamesEnabled:false,roomRocketEnabled:false}
          : {}),
        officialUpdatedAt:now,
        officialUpdatedBy:uid,
        updatedAt:now,
      };
    }else if(controlAction==="updateOfficialRoom"){
      if(!canGlobal)throw new ApiError("global_room_control_required",403);
      if(!before.official)throw new ApiError("official_room_required",409);
      const name=clean(body.name);
      const hostUid=clean(body.hostUid);
      const officialType=clean(body.officialType||before.type||"official");
      const category=clean(body.category).slice(0,60);
      const description=clean(body.description).slice(0,500);
      const coverImageUrl=clean(body.coverImageUrl).slice(0,1200);
      const visibility=clean(body.visibility||"public");
      const tags=Array.isArray(body.tags)
        ? [...new Set(body.tags.map(clean).filter(Boolean))].slice(0,8)
        : [];
      if(name.length<2||name.length>80)throw new ApiError("invalid_room_name",400);
      if(!["official","administrative","customer_service"].includes(officialType)){
        throw new ApiError("invalid_official_room_type",400);
      }
      if(!["public","hidden"].includes(visibility))throw new ApiError("invalid_room_visibility",400);
      if(hostUid){
        const hostSnap=await tx.get(db.collection("users").doc(hostUid));
        if(!hostSnap.exists)throw new ApiError("host_not_found",404);
      }
      patch={
        name,
        category,
        description,
        coverImageUrl,
        visibility,
        tags,
        roomType:officialType,
        hostUid,
        ...(officialType==="customer_service"&&before.type!=="customer_service"
          ? {giftsEnabled:false,pkEnabled:false,gamesEnabled:false,roomRocketEnabled:false}
          : {}),
        officialUpdatedAt:now,
        officialUpdatedBy:uid,
        updatedAt:now,
      };
    }else{
      throw new ApiError("invalid_control_room_action",400);
    }

    // Persist the seat array at the effective capacity whenever room
    // policy changes. This prevents an older Firestore seats array (often 8
    // seats from LV.1) from racing the normalized API state and shrinking the
    // room back down in realtime clients.
    const projectedRoom={...room,...patch};
    patch={...patch,seats:normalizeSeats(projectedRoom)};
    const after=roomControlPolicySnapshot(projectedRoom);
    tx.update(roomRef,patch);
    const auditRef=db.collection("admin_audit_logs").doc();
    tx.create(auditRef,{
      actorUid:uid,
      action:controlAction,
      targetType:"room",
      targetId:roomId,
      reason,
      before,
      after,
      operationId,
      createdAt:now,
    });
    const resultData={roomId,before,after};
    tx.create(opRef,{
      action:controlAction,
      actorUid:uid,
      targetType:"room",
      targetId:roomId,
      status:"completed",
      result:resultData,
      createdAt:now,
    });
    return {ok:true,code:"ok",operationId,...resultData};
  });
}

export async function announceRoomEntrance(db,uid,roomId){
  if(!/^[A-Za-z0-9_-]{1,180}$/.test(roomId)){
    throw new ApiError("invalid_room_id",400);
  }
  const roomRef=db.collection("rooms").doc(roomId);
  const roomSnap=await roomRef.get();
  if(!roomSnap.exists||roomSnap.data()?.isActive===false){
    throw new ApiError("room_unavailable",404);
  }

  const [cosmetics,userSnap,profileSnap]=await Promise.all([
    activeCosmetics(db,uid,["entrance"]),
    db.collection("users").doc(uid).get(),
    db.collection("public_profiles").doc(uid).get(),
  ]);
  const entrance=cosmetics.entrance||{};
  const user=userSnap.data()||{};
  const vipCosmetics=vipCosmeticsFromUser(user,Date.now());
  const hasRewardEntrance=
    clean(entrance.assetKey).length>0||clean(entrance.imageUrl).length>0;
  const hasVipRoomEntrance=
    vipCosmetics.level>=9&&clean(vipCosmetics.keys.entryStrip).length>0;
  if(!hasRewardEntrance&&!hasVipRoomEntrance){
    return {ok:true,announced:false,roomId};
  }

  const profile=profileSnap.data()||{};
  const eventAtMs=Date.now();
  const event={
    eventId:uid+"_"+eventAtMs.toString(36),
    uid,
    displayName:clean(profile.displayName||profile.username||"مستخدم Shadow Live"),
    profileImageUrl:clean(profile.profileImageUrl),
    rewardId:hasRewardEntrance?clean(entrance.rewardId):"vip_room_entry",
    assetKey:hasRewardEntrance
      ?clean(entrance.assetKey)
      :clean(vipCosmetics.keys.entryStrip),
    imageUrl:hasRewardEntrance?clean(entrance.imageUrl):"",
    rewardExpiresAtMs:hasRewardEntrance
      ?Number(entrance.expiresAtMs||0)
      :timestampToEpochMs(user.vipExpiresAt),
    eventAtMs,
  };
  const delivered=await broadcastRoomRealtimeEvent(
    roomId,
    "room.entrance",
    {roomId,event},
  );
  return {ok:true,announced:true,roomId,event,delivered};
}

async function roomSeatState(db,uid,roomId){
  if(!/^[A-Za-z0-9_-]{1,180}$/.test(roomId))throw new ApiError("invalid_room_id",400);
  const [snap,actorSnap,liveOnlineCount]=await Promise.all([
    db.collection("rooms").doc(roomId).get(),
    db.collection("users").doc(uid).get(),
    realtimeRoomCount(roomId),
  ]);
  if(!snap.exists)throw new ApiError("room_not_found",404);
  const room=snap.data()||{};
  const actor=actorSnap.data()||{};
  const isOwner=!isOfficialRoom(room)&&roomOwnerUid(room)===uid;
  const isHost=isOfficialRoom(room)&&roomHostUid(room)===uid;
  return {
    ok:true,
    roomId,
    seats:normalizeSeats(room),
    micInvites:Array.isArray(room.micInvites)?room.micInvites:[],
    micRequests:Array.isArray(room.micRequests)?room.micRequests:[],
    micInviteOnly:room.micInviteOnly===true,
    starBattleActive:activeStarBattle(room)!=null,
    isOwner,
    isHost,
    canManageMic:canManageRoomAction(room,actor,uid,"manageMic"),
    isActive:room.isActive!==false,
    onlineCount:liveOnlineCount??Math.max(0,Number(room.onlineCount||0)),
  };
}

export async function roomSeatAction(db,uid,body){
  const roomId=clean(body.roomId);
  const action=clean(body.seatAction);
  const targetUid=clean(body.targetUid);
  const seatIndex=Number(body.seatIndex);
  if(!/^[A-Za-z0-9_-]{1,180}$/.test(roomId))throw new ApiError("invalid_room_id",400);

  const roomRef=db.collection("rooms").doc(roomId);
  const myProfileRef=db.collection("public_profiles").doc(uid);

  const result=await db.runTransaction(async tx=>{
    const roomSnap=await tx.get(roomRef);
    if(!roomSnap.exists)throw new ApiError("room_not_found",404);
    const room=roomSnap.data()||{};
    if(room.isActive===false)throw new ApiError("room_unavailable",409);

    const ownerUid=roomOwnerUid(room);
    const isOwner=!isOfficialRoom(room)&&ownerUid===uid;
    const isHost=isOfficialRoom(room)&&roomHostUid(room)===uid;
    const actorSnap=await tx.get(db.collection("users").doc(uid));
    const actor=actorSnap.data()||{};
    const canManageMic=canManageRoomAction(room,actor,uid,"manageMic");

    let seats=normalizeSeats(room);
    let invites=Array.isArray(room.micInvites)?[...room.micInvites]:[];
    let requests=Array.isArray(room.micRequests)?[...room.micRequests]:[];
    let micInviteOnly=room.micInviteOnly===true;
    const customerService=
      clean(room.roomType||room.type)==="customer_service";
    const inviteExpiries=
      room.customerServiceMicInviteExpiresAtMs&&
      typeof room.customerServiceMicInviteExpiresAtMs==="object"
        ? {...room.customerServiceMicInviteExpiresAtMs}
        : {};
    let customerServiceSchedule=null;

    const clearUserSeat=userId=>{
      seats=seats.map(seat=>seat.uid===userId
        ? {
            ...seat,
            uid:"",
            displayName:"",
            profileImageUrl:"",
            muted:true,
            micStartedAtMs:0,
            customerServiceMicExpiresAtMs:0,
            frameRewardId:"",
            frameAssetKey:"",
            frameImageUrl:"",
            frameExpiresAtMs:0,
            voiceWaveRewardId:"",
            voiceWaveAssetKey:"",
            voiceWaveImageUrl:"",
            voiceWaveExpiresAtMs:0,
          }
        : seat);
    };

    if(action==="setMicInviteOnly"){
      if(!canManageMic)throw new ApiError("forbidden",403);
      micInviteOnly=body.enabled===true;
      if(!micInviteOnly)requests=[];
    }else if(action==="requestMic"){
      if(!requests.includes(uid)){
        const actorVip=vipEntitlementsFromUser(actor,Date.now()).level;
        requests=actorVip>=2
          ? [uid,...requests.filter(id=>id!==uid)]
          : [...requests,uid];
      }
    }else if(action==="cancelMicRequest"){
      requests=requests.filter(id=>id!==uid);
    }else if(action==="inviteToMic"){
      if(!canManageMic)throw new ApiError("forbidden",403);
      if(!targetUid||targetUid===uid)throw new ApiError("invalid_target",400);
      await assertRoomRealtimePresence(db,roomId,targetUid);
      if(!invites.includes(targetUid))invites.push(targetUid);
      if(customerService){
        const expiresAtMs=Date.now()+CUSTOMER_SERVICE_INVITE_MS;
        inviteExpiries[targetUid]=expiresAtMs;
        customerServiceSchedule={
          uid:targetUid,
          schedules:[{kind:"invite_expire",expiresAtMs}],
        };
      }
    }else if(action==="approveMicRequest"){
      if(!canManageMic)throw new ApiError("forbidden",403);
      if(!targetUid||targetUid===uid)throw new ApiError("invalid_target",400);
      if(!requests.includes(targetUid))throw new ApiError("mic_request_not_found",404);
      await assertRoomRealtimePresence(db,roomId,targetUid);
      requests=requests.filter(id=>id!==targetUid);
      if(!invites.includes(targetUid))invites.push(targetUid);
      if(customerService){
        const expiresAtMs=Date.now()+CUSTOMER_SERVICE_INVITE_MS;
        inviteExpiries[targetUid]=expiresAtMs;
        customerServiceSchedule={
          uid:targetUid,
          schedules:[{kind:"invite_expire",expiresAtMs}],
        };
      }
    }else if(action==="rejectMicRequest"){
      if(!canManageMic)throw new ApiError("forbidden",403);
      if(!targetUid)throw new ApiError("invalid_target",400);
      requests=requests.filter(id=>id!==targetUid);
    }else if(action==="declineMicInvite"){
      invites=invites.filter(id=>id!==uid);
      delete inviteExpiries[uid];
    }else if(action==="takeSeat"||action==="switchSeat"){
      if(!Number.isInteger(seatIndex)||seatIndex<0||seatIndex>=seats.length)throw new ApiError("invalid_seat",400);
      const currentSeatIndex=seats.findIndex(item=>item.uid===uid);
      if(action==="switchSeat"&&currentSeatIndex<0)throw new ApiError("speaker_seat_required",403);
      const seat=seats[seatIndex];
      const pk=activePk(room);
      const reserved=pk?.participants.find(item=>item.seatIndex===seatIndex);
      const mine=pk?.participants.find(item=>item.uid===uid);
      if(reserved&&reserved.uid!==uid)throw new ApiError("pk_seat_reserved",409);
      if(mine&&mine.seatIndex!==seatIndex)throw new ApiError("pk_original_seat_required",409);
      if(seat.uid&&seat.uid!==uid)throw new ApiError("seat_occupied",409);
      if(customerService){
        if(seatIndex<2&&!canManageMic){
          throw new ApiError("customer_service_manager_mic_required",403);
        }
        if(seatIndex>=2&&!canManageMic&&currentSeatIndex<0){
          if(Number(room.customerServiceMinVipLevel||1)>=4){
            const anotherCustomer=seats.some(
              item=>item.index>=2&&item.uid&&item.uid!==uid
            );
            if(anotherCustomer){
              throw new ApiError("customer_service_exclusive_busy",409);
            }
          }
          if(!invites.includes(uid))throw new ApiError("mic_invite_required",403);
          const inviteExpiresAtMs=Number(inviteExpiries[uid]||0);
          if(inviteExpiresAtMs<=Date.now()){
            throw new ApiError("mic_invite_expired",409);
          }
        }
      }else if(micInviteOnly&&!isOwner&&!isHost&&!canManageMic&&!invites.includes(uid)&&!mine&&currentSeatIndex<0){
        throw new ApiError("mic_invite_required",403);
      }

      const profileSnap=await tx.get(myProfileRef);
      const profile=profileSnap.data()||{};
      const cosmetics=await activeCosmetics(
        db,
        uid,
        ["frame","voice_wave"],
        tx,
      );
      const frame=cosmetics.frame||{};
      const voiceWave=cosmetics.voice_wave||{};
      const vipCosmetics=vipCosmeticsFromUser(actor,Date.now());
      const vipExpiryMs=timestampToEpochMs(actor.vipExpiresAt);
      const selectedVipFrameLevel=Math.max(
        3,
        Math.min(
          vipCosmetics.level,
          Number(actor.vipProfileFrameLevel||vipCosmetics.level),
        ),
      );
      const vipFrameAssetKey=vipCosmetics.level>=3
        ?vipCosmeticAssetKey(selectedVipFrameLevel,"profileFrame")
        :"";
      const effectiveFrameAssetKey=clean(frame.assetKey)||vipFrameAssetKey;
      const effectiveFrameImageUrl=clean(frame.imageUrl);
      const effectiveFrameExpiresAtMs=clean(frame.assetKey)||clean(frame.imageUrl)
        ?Number(frame.expiresAtMs||0)
        :vipExpiryMs;
      const vipWaveAssetKey=vipCosmetics.keys.audioWave;
      const effectiveWaveAssetKey=clean(voiceWave.assetKey)||vipWaveAssetKey;
      const effectiveWaveImageUrl=clean(voiceWave.imageUrl);
      const effectiveWaveExpiresAtMs=clean(voiceWave.assetKey)||clean(voiceWave.imageUrl)
        ?Number(voiceWave.expiresAtMs||0)
        :vipExpiryMs;
      const existingSeat=currentSeatIndex>=0?seats[currentSeatIndex]:null;
      const keepMicActive=
        existingSeat?.muted===false&&Number(existingSeat?.micStartedAtMs||0)>0;
      const micStartedAtMs=keepMicActive
        ?Number(existingSeat.micStartedAtMs)
        :0;
      const previousCsExpiry=
        Number(existingSeat?.customerServiceMicExpiresAtMs||0);
      const customerServiceMicExpiresAtMs=
        customerService&&!canManageMic
          ? (previousCsExpiry>Date.now()
              ? previousCsExpiry
              : Date.now()+CUSTOMER_SERVICE_MIC_MS)
          : 0;
      clearUserSeat(uid);
      seats[seatIndex]={
        index:seatIndex,
        uid,
        displayName:String(profile.displayName||profile.username||"مستخدم Shadow Live"),
        profileImageUrl:String(profile.profileImageUrl||""),
        muted:!keepMicActive,
        micStartedAtMs,
        frameRewardId:clean(frame.rewardId),
        frameAssetKey:effectiveFrameAssetKey,
        frameImageUrl:effectiveFrameImageUrl,
        frameExpiresAtMs:effectiveFrameExpiresAtMs,
        voiceWaveRewardId:clean(voiceWave.rewardId),
        voiceWaveAssetKey:effectiveWaveAssetKey,
        voiceWaveImageUrl:effectiveWaveImageUrl,
        voiceWaveExpiresAtMs:effectiveWaveExpiresAtMs,
        customerServiceMicExpiresAtMs,
      };
      invites=invites.filter(id=>id!==uid);
      requests=requests.filter(id=>id!==uid);
      delete inviteExpiries[uid];
      if(customerServiceMicExpiresAtMs>0){
        customerServiceSchedule={
          uid,
          schedules:[
            {
              kind:"mic_expire",
              expiresAtMs:customerServiceMicExpiresAtMs,
            },
          ],
        };
      }
    }else if(action==="muteSeat"||action==="unmuteSeat"){
      const seatIndex=seats.findIndex(seat=>seat.uid===uid);
      if(seatIndex<0)throw new ApiError("speaker_seat_required",403);
      const currentSeat=seats[seatIndex];
      if(action==="muteSeat"){
        if(currentSeat.muted===false)await recordMicActivity(tx,db,uid,currentSeat);
        seats[seatIndex]={...currentSeat,muted:true,micStartedAtMs:0};
      }else{
        seats[seatIndex]={
          ...currentSeat,
          muted:false,
          micStartedAtMs:
            currentSeat.muted===false&&Number(currentSeat.micStartedAtMs||0)>0
              ?Number(currentSeat.micStartedAtMs)
              :Date.now(),
        };
      }
    }else if(action==="muteTargetSeat"||action==="unmuteTargetSeat"){
      if(!canManageMic)throw new ApiError("forbidden",403);
      if(!targetUid||targetUid===uid)throw new ApiError("invalid_target",400);
      const targetSeatIndex=seats.findIndex(seat=>seat.uid===targetUid);
      if(targetSeatIndex<0)throw new ApiError("speaker_seat_required",403);
      const targetSeat=seats[targetSeatIndex];
      if(action==="muteTargetSeat"){
        const targetSnap=await tx.get(db.collection("users").doc(targetUid));
        const targetUser=targetSnap.data()||{};
        const muteProtected=vipEntitlementsFromUser(
          targetUser,
          Date.now(),
        ).muteProtection;
        const protectionOverride=canOverrideVipRoomProtection(actor);
        if(muteProtected&&!protectionOverride){
          throw new ApiError("vip_mute_protected",403);
        }
        if(muteProtected&&protectionOverride){
          tx.create(
            db.collection("room_audit_logs").doc(roomId).collection("items").doc(),
            {
              action:"vipMuteProtectionOverride",
              actorUid:uid,
              targetUid,
              before:{muted:targetSeat.muted===true},
              after:{
                muted:true,
                vipMuteProtection:true,
                vipProtectionOverride:true,
              },
              authoritySource:clean(actor.role)==="owner"
                ?"appOwner"
                :"authorizedSafety",
              createdAt:FieldValue.serverTimestamp(),
            },
          );
        }
        if(targetSeat.muted===false){
          await recordMicActivity(tx,db,targetUid,targetSeat);
        }
        seats[targetSeatIndex]={...targetSeat,muted:true,micStartedAtMs:0};
      }else{
        seats[targetSeatIndex]={
          ...targetSeat,
          muted:false,
          micStartedAtMs:
            targetSeat.muted===false&&Number(targetSeat.micStartedAtMs||0)>0
              ?Number(targetSeat.micStartedAtMs)
              :Date.now(),
        };
      }
    }else if(action==="leaveSeat"){
      const mySeat=seats.find(seat=>seat.uid===uid);
      if(mySeat)await recordMicActivity(tx,db,uid,mySeat);
      clearUserSeat(uid);
    }else if(action==="removeFromMic"){
      if(!canManageMic)throw new ApiError("forbidden",403);
      if(!targetUid)throw new ApiError("invalid_target",400);
      const targetSeat=seats.find(seat=>seat.uid===targetUid);
      if(targetSeat)await recordMicActivity(tx,db,targetUid,targetSeat);
      clearUserSeat(targetUid);
      invites=invites.filter(id=>id!==targetUid);
      requests=requests.filter(id=>id!==targetUid);
      delete inviteExpiries[targetUid];
    }else{
      throw new ApiError("invalid_seat_action",400);
    }

    tx.update(roomRef,{
      seats,
      micInvites:invites,
      micRequests:requests,
      micInviteOnly,
      customerServiceMicInviteExpiresAtMs:inviteExpiries,
      updatedAt:FieldValue.serverTimestamp(),
    });

    const privilegedMicActions=new Set([
      "setMicInviteOnly","inviteToMic","approveMicRequest","rejectMicRequest",
      "muteTargetSeat","unmuteTargetSeat","removeFromMic",
    ]);
    if(privilegedMicActions.has(action)&&absoluteRoomAccessAudit(room,actor,uid).absoluteRoomAccess===true){
      tx.create(
        db.collection("room_audit_logs").doc(roomId).collection("items").doc(),
        {
          action:"ownerAbsoluteRoomAccess:"+action,
          actorUid:uid,
          targetUid:targetUid||null,
          seatIndex:Number.isInteger(seatIndex)?seatIndex:null,
          authoritySource:"ownerAbsoluteRoomAccess",
          absoluteRoomAccess:true,
          createdAt:FieldValue.serverTimestamp(),
        },
      );
    }

    return {
      ok:true,
      roomId,
      seats,
      micInvites:invites,
      micRequests:requests,
      micInviteOnly,
      starBattleActive:activeStarBattle({...room,starBattleState:room.starBattleState})!=null,
      isOwner,
      isHost,
      canManageMic,
      isActive:true,
      onlineCount:Math.max(0,Number(room.onlineCount||0)),
      _customerServiceSchedule:customerServiceSchedule,
    };
  });
  const schedule=result._customerServiceSchedule;
  if(schedule?.uid&&Array.isArray(schedule.schedules)){
    await registerCustomerServiceMicSchedules(
      roomId,
      schedule.uid,
      schedule.schedules,
    );
  }
  const liveOnlineCount=await realtimeRoomCount(roomId);
  const {_customerServiceSchedule,...publicResult}=result;
  return {
    ...publicResult,
    onlineCount:liveOnlineCount??publicResult.onlineCount,
  };
}

async function sendRoomChat(db,uid,body){
  const roomId=clean(body.roomId);
  const message=String(body.text??"").trim();
  const replyTo=clean(body.replyTo).slice(0,120);
  const replyPreview=String(body.replyPreview??"").trim().slice(0,120);
  const replySenderUid=clean(body.replySenderUid).slice(0,160);
  const mentions=Array.isArray(body.mentionUids)
    ? [...new Set(body.mentionUids.map(clean).filter(Boolean))].slice(0,10)
    : [];
  if(!/^[A-Za-z0-9_-]{1,180}$/.test(roomId))throw new ApiError("invalid_room_id",400);
  if(!message||message.length>500)throw new ApiError("invalid_room_message",400);

  const [roomSnap,profileSnap,actorUserSnap,banSnap]=await Promise.all([
    db.collection("rooms").doc(roomId).get(),
    db.collection("public_profiles").doc(uid).get(),
    db.collection("users").doc(uid).get(),
    db.collection("room_bans").doc(roomId).collection("users").doc(uid).get(),
  ]);

  if(!roomSnap.exists||roomSnap.data()?.isActive===false)throw new ApiError("room_unavailable",404);
  const roomData=roomSnap.data()||{};
  const actorUser=actorUserSnap.data()||{};
  const canModerateChat=canManageRoomAction(roomData,actorUser,uid,"moderateChat");
  if(roomData.chatEnabled===false&&!canModerateChat)throw new ApiError("room_chat_disabled",403);

  if(banSnap.exists){
    const ban=banSnap.data()||{};
    const expiresAt=ban.expiresAt?.toMillis?.()||0;
    const permanent=ban.permanent===true;
    if(permanent||expiresAt>Date.now())throw new ApiError("room_banned",403);
  }

  const nowMs=Date.now();
  const rateKey=roomId+"__"+uid;
  const previous=legacyRoomChatRate.get(rateKey)||{windowStartedAtMs:nowMs,count:0};
  const sameWindow=nowMs-Number(previous.windowStartedAtMs||0)<10000;
  const count=sameWindow?Math.max(0,Number(previous.count||0)):0;
  if(count>=8)throw new ApiError("rate_limited",429);
  legacyRoomChatRate.set(rateKey,{
    windowStartedAtMs:sameWindow?Number(previous.windowStartedAtMs||nowMs):nowMs,
    count:count+1,
  });

  const profile=profileSnap.data()||{};
  const vipCosmetics=vipCosmeticsFromUser(actorUser,nowMs);
  const messageId="msg_"+randomBytes(12).toString("hex");
  await publishRoomRealtimeEvent(
    legacyEnv,
    roomId,
    "room.chat_message",
    {
      message:{
        id:messageId,
        type:"text",
        senderUid:uid,
        displayName:clean(profile.displayName||profile.username||actorUser.displayName||actorUser.username||"مستخدم Shadow Live"),
        profileImageUrl:clean(profile.profileImageUrl||actorUser.profileImageUrl),
        activeProfileFrameAssetKey:clean(
          profile.activeProfileFrameAssetKey||
          actorUser.activeProfileFrameAssetKey,
        ),
        activeProfileFrameImageUrl:clean(
          profile.activeProfileFrameImageUrl||
          actorUser.activeProfileFrameImageUrl,
        ),
        activeProfileFrameExpiresAtMs:Math.max(
          0,
          Number(
            profile.activeProfileFrameExpiresAtMs||
            actorUser.activeProfileFrameExpiresAtMs||
            0
          ),
        ),
        activeProfileFramePermanent:
          profile.activeProfileFramePermanent===true||
          actorUser.activeProfileFramePermanent===true,
        text:message,
        mentionUids:mentions,
        replyTo:replyTo||null,
        replyPreview:replyPreview||null,
        replySenderUid:replySenderUid||null,
        createdAtMs:nowMs,
        systemKind:"",
        vipLevel:vipCosmetics.level,
        entryEffectKey:"",
      },
    },
  );
  return {ok:true,messageId};
}

async function kickRoomUser(db,uid,body){
  const roomId=clean(body.roomId);
  const targetUid=clean(body.targetUid);
  const duration=clean(body.duration);
  const allowedDurations=new Map([
    ["1",1],["5",5],["15",15],["30",30],["10080",10080],
  ]);
  const permanent=duration==="permanent";
  const minutes=allowedDurations.get(duration);
  if(!/^[A-Za-z0-9_-]{1,180}$/.test(roomId)||!targetUid||targetUid===uid){
    throw new ApiError("invalid_request",400);
  }
  if(!permanent&&!minutes)throw new ApiError("invalid_kick_duration",400);

  const roomRef=db.collection("rooms").doc(roomId);
  const actorRef=db.collection("users").doc(uid);
  const targetRef=db.collection("users").doc(targetUid);
  const banRef=db.collection("room_bans").doc(roomId).collection("users").doc(targetUid);
  const auditRef=db.collection("room_audit_logs").doc(roomId).collection("items").doc();

  return db.runTransaction(async tx=>{
    const [roomSnap,actorSnap,targetSnap]=await Promise.all([
      tx.get(roomRef),
      tx.get(actorRef),
      tx.get(targetRef),
    ]);
    if(!roomSnap.exists)throw new ApiError("room_not_found",404);
    const room=roomSnap.data()||{};
    const actor=actorSnap.data()||{};
    const target=targetSnap.data()||{};
    const permissions=roomPermissions(actor);
    const ownerUid=clean(room.ownerUid||room.ownerId||room.hostId);
    if(!canManageRoomAction(room,actor,uid,"moderateUsers"))throw new ApiError("forbidden",403);
    if(targetUid===ownerUid&&!permissions.appOwner)throw new ApiError("owner_protected",403);

    const targetVip=vipEntitlementsFromUser(target,Date.now());
    const protectionOverride=canOverrideVipRoomProtection(actor);
    if(targetVip.kickProtection&&!protectionOverride){
      throw new ApiError("vip_kick_protected",403);
    }

    const expiresAt=permanent?null:new Date(Date.now()+minutes*60*1000);
    tx.set(banRef,{
      roomId,
      userId:targetUid,
      blockedBy:uid,
      permanent,
      durationMinutes:permanent?null:minutes,
      expiresAt,
      createdAt:FieldValue.serverTimestamp(),
      updatedAt:FieldValue.serverTimestamp(),
    },{merge:true});

    const seats=normalizeSeats(room).map(seat=>
      seat.uid===targetUid
        ? {index:seat.index,uid:null,displayName:"",profileImageUrl:"",muted:true}
        : seat
    );
    const micRequests=normalizeUidList(room.micRequests).filter(id=>id!==targetUid);
    const micInvites=normalizeUidList(room.micInvites).filter(id=>id!==targetUid);
    tx.update(roomRef,{
      seats,
      micRequests,
      micInvites,
      updatedAt:FieldValue.serverTimestamp(),
    });
    tx.create(auditRef,{
      action:"kickRoomUser",
      actorUid:uid,
      ...absoluteRoomAccessAudit(room,actor,uid),
      targetUid,
      after:{
        permanent,
        durationMinutes:permanent?null:minutes,
        targetVipLevel:targetVip.level,
        vipKickProtection:targetVip.kickProtection,
        vipProtectionOverride:
          targetVip.kickProtection&&protectionOverride,
      },
      createdAt:FieldValue.serverTimestamp(),
    });

    return {
      ok:true,
      roomId,
      targetUid,
      permanent,
      durationMinutes:permanent?null:minutes,
    };
  });
}

async function unbanRoomUser(db,uid,body){
  const roomId=clean(body.roomId);
  const targetUid=clean(body.targetUid);
  if(!/^[A-Za-z0-9_-]{1,180}$/.test(roomId)||!targetUid)throw new ApiError("invalid_request",400);
  const roomRef=db.collection("rooms").doc(roomId);
  const actorRef=db.collection("users").doc(uid);
  const banRef=db.collection("room_bans").doc(roomId).collection("users").doc(targetUid);
  const auditRef=db.collection("room_audit_logs").doc(roomId).collection("items").doc();
  const [roomSnap,actorSnap,banSnap]=await Promise.all([roomRef.get(),actorRef.get(),banRef.get()]);
  if(!roomSnap.exists)throw new ApiError("room_not_found",404);
  const room=roomSnap.data()||{};
  if(!canManageRoomAction(room,actorSnap.data()||{},uid,"moderateUsers"))throw new ApiError("forbidden",403);
  const batch=db.batch();
  batch.delete(banRef);
  batch.create(auditRef,{
    action:"unbanRoomUser",
    actorUid:uid,
    ...absoluteRoomAccessAudit(room,actorSnap.data()||{},uid),
    targetUid,
    before:banSnap.exists?(banSnap.data()||{}):null,
    after:null,
    createdAt:FieldValue.serverTimestamp(),
  });
  await batch.commit();
  return {ok:true,roomId,targetUid};
}

async function roomBanList(db,uid,roomId){
  if(!/^[A-Za-z0-9_-]{1,180}$/.test(roomId))throw new ApiError("invalid_room_id",400);
  const roomRef=db.collection("rooms").doc(roomId);
  const actorRef=db.collection("users").doc(uid);
  const [roomSnap,actorSnap]=await Promise.all([roomRef.get(),actorRef.get()]);
  if(!roomSnap.exists)throw new ApiError("room_not_found",404);
  const room=roomSnap.data()||{};
  const permissions=roomPermissions(actorSnap.data()||{});
  const ownerUid=clean(room.ownerUid||room.ownerId||room.hostId);
  if(!canManageRoomAction(room,actorSnap.data()||{},uid,"moderateUsers"))throw new ApiError("forbidden",403);

  const bansSnap=await db.collection("room_bans").doc(roomId).collection("users").limit(100).get();
  const result=[];
  for(const doc of bansSnap.docs){
    const ban=doc.data()||{};
    const expiresMs=ban.expiresAt?.toMillis?.()||0;
    const active=ban.permanent===true||expiresMs>Date.now();
    if(!active)continue;
    const blockedByUid=clean(ban.blockedBy);
    const [profile,blockerProfile]=await Promise.all([
      db.collection("public_profiles").doc(doc.id).get(),
      blockedByUid
        ? db.collection("public_profiles").doc(blockedByUid).get()
        : Promise.resolve(null),
    ]);
    const pdata=profile.data()||{};
    const blockerData=blockerProfile?.data?.()||{};
    result.push({
      uid:doc.id,
      displayName:clean(pdata.displayName||pdata.username||"مستخدم Shadow Live"),
      profileImageUrl:clean(pdata.profileImageUrl),
      profileAvatarAsset:clean(pdata.profileAvatarAsset),
      activeProfileFrameAssetKey:
        clean(pdata.activeProfileFrameAssetKey),
      activeProfileFrameImageUrl:
        clean(pdata.activeProfileFrameImageUrl),
      activeProfileFrameExpiresAtMs:Math.max(
        0,
        Number(pdata.activeProfileFrameExpiresAtMs||0),
      ),
      activeProfileFramePermanent:
        pdata.activeProfileFramePermanent===true,
      permanent:ban.permanent===true,
      durationMinutes:Number(ban.durationMinutes||0),
      expiresAt:expiresMs||null,
      blockedByUid,
      blockedByName:blockedByUid
        ? clean(blockerData.displayName||blockerData.username||"مشرف الغرفة")
        : "",
    });
  }
  return {ok:true,roomId,bans:result};
}

async function recordRoomVisit(db,uid,roomId){
  if(!/^[A-Za-z0-9_-]{1,180}$/.test(roomId))throw new ApiError("invalid_room_id",400);
  const roomRef=db.collection("rooms").doc(roomId);
  const visitRef=db.collection("room_visits").doc(uid).collection("items").doc(roomId);
  const roomSnap=await roomRef.get();
  if(!roomSnap.exists||roomSnap.data()?.isActive===false)throw new ApiError("room_unavailable",404);
  const room=roomSnap.data()||{};
  await visitRef.set({
    roomId,
    name:clean(room.name||room.title||"غرفة صوتية"),
    publicId:clean(room.publicId),
    ownerUid:clean(room.ownerUid||room.ownerId||room.hostId),
    lastVisitedAt:FieldValue.serverTimestamp(),
    visitCount:FieldValue.increment(1),
  },{merge:true});
  return {ok:true,roomId};
}

async function setRoomFavorite(db,uid,roomId,favorite){
  if(!/^[A-Za-z0-9_-]{1,180}$/.test(roomId))throw new ApiError("invalid_room_id",400);
  const roomRef=db.collection("rooms").doc(roomId);
  const favoriteRef=db.collection("room_favorites").doc(uid).collection("items").doc(roomId);
  const roomSnap=await roomRef.get();
  if(!roomSnap.exists||roomSnap.data()?.isActive===false)throw new ApiError("room_unavailable",404);
  const room=roomSnap.data()||{};
  if(favorite){
    await favoriteRef.set({
      roomId,
      name:clean(room.name||room.title||"غرفة صوتية"),
      publicId:clean(room.publicId),
      ownerUid:clean(room.ownerUid||room.ownerId||room.hostId),
      updatedAt:FieldValue.serverTimestamp(),
      createdAt:FieldValue.serverTimestamp(),
    },{merge:true});
  }else{
    await favoriteRef.delete();
  }
  return {ok:true,roomId,favorite};
}

async function roomLibrary(db,uid){
  const [favoritesSnap,visitsSnap]=await Promise.all([
    db.collection("room_favorites").doc(uid).collection("items").orderBy("updatedAt","desc").limit(60).get(),
    db.collection("room_visits").doc(uid).collection("items").orderBy("lastVisitedAt","desc").limit(60).get(),
  ]);

  // Favorites and visit history commonly contain the same room. Cache the
  // hydration promise per request so the room document and realtime count are
  // fetched once even when the room appears in both 60-item lists.
  const roomHydrationCache=new Map();
  async function hydrateRoom(roomId){
    if(roomHydrationCache.has(roomId))return roomHydrationCache.get(roomId);
    const pending=(async()=>{
      const roomSnap=await db.collection("rooms").doc(roomId).get();
      if(!roomSnap.exists)return null;
      const data=roomSnap.data()||{};
      if(data.isActive===false||data.isHidden===true||clean(data.visibility)==="hidden")return null;
      const liveOnlineCount=await realtimeRoomCount(roomId);
      return {
        ...roomResponse(roomId,data),
        onlineCount:liveOnlineCount??Math.max(0,Number(data.onlineCount||data.participantsCount||0)),
      };
    })();
    roomHydrationCache.set(roomId,pending);
    return pending;
  }

  async function hydrate(snapshot){
    const result=[];
    for(const entry of snapshot.docs){
      const roomId=clean(entry.data()?.roomId||entry.id);
      if(!roomId)continue;
      const hydrated=await hydrateRoom(roomId);
      if(hydrated)result.push(hydrated);
    }
    return result;
  }

  const [favorites,history]=await Promise.all([
    hydrate(favoritesSnap),
    hydrate(visitsSnap),
  ]);
  return {ok:true,favorites,history};
}

function normalizeRoomMusicPolicy(room){
  const raw=room.musicPolicy&&typeof room.musicPolicy==="object"?room.musicPolicy:{};
  return {allowMembers:raw.allowMembers===true};
}

function normalizeRoomMusicQueue(room){
  const raw=Array.isArray(room.musicQueue)?room.musicQueue:[];
  const seen=new Set();
  const result=[];
  for(const item of raw){
    const id=clean(item?.id);
    if(!id||seen.has(id))continue;
    seen.add(id);
    result.push({
      id,
      title:clean(item?.title||"مقطع صوتي").slice(0,120),
      artist:clean(item?.artist).slice(0,120),
      durationMs:Math.max(0,Math.min(24*60*60*1000,Number(item?.durationMs||0))),
      sourceOwnerUid:clean(item?.sourceOwnerUid),
      sourceOwnerName:clean(item?.sourceOwnerName||"مستخدم Shadow Live"),
      createdAtMs:Number(item?.createdAtMs||0),
    });
  }
  return result.slice(0,50);
}

function normalizeRoomMusicState(room){
  const raw=room.musicState&&typeof room.musicState==="object"?room.musicState:{};
  return {
    status:["playing","stopped"].includes(clean(raw.status))?clean(raw.status):"stopped",
    currentTrackId:clean(raw.currentTrackId),
    sourceOwnerUid:clean(raw.sourceOwnerUid),
    requestedBy:clean(raw.requestedBy),
    startedAtMs:Number(raw.startedAtMs||0),
    commandRevision:Math.max(0,Number(raw.commandRevision||0)),
  };
}

function roomMusicAccess(room,actor,uid){
  const policy=normalizeRoomMusicPolicy(room);
  const manage=canManageRoomAction(room,actor,uid,"manageMusic");
  const managePolicy=canManageRoomAction(room,actor,uid,"manageMusicPolicy");
  return {
    policy,
    manage,
    managePolicy,
    canAddOrPlay:manage||policy.allowMembers,
  };
}

async function roomMusicState(db,uid,roomId){
  if(!/^[A-Za-z0-9_-]{1,180}$/.test(roomId))throw new ApiError("invalid_room_id",400);
  const [roomSnap,actorSnap]=await Promise.all([
    db.collection("rooms").doc(roomId).get(),
    db.collection("users").doc(uid).get(),
  ]);
  if(!roomSnap.exists)throw new ApiError("room_not_found",404);
  const room=roomSnap.data()||{};
  const access=roomMusicAccess(room,actorSnap.data()||{},uid);
  return {
    ok:true,
    roomId,
    policy:access.policy,
    queue:normalizeRoomMusicQueue(room),
    state:normalizeRoomMusicState(room),
    canManage:access.manage,
    canManagePolicy:access.managePolicy,
    canAddOrPlay:access.canAddOrPlay,
  };
}

async function setRoomMusicPolicy(db,uid,body){
  const roomId=clean(body.roomId);
  const allowMembers=body.allowMembers===true;
  if(!/^[A-Za-z0-9_-]{1,180}$/.test(roomId))throw new ApiError("invalid_room_id",400);
  const roomRef=db.collection("rooms").doc(roomId);
  const actorRef=db.collection("users").doc(uid);
  return db.runTransaction(async tx=>{
    const [roomSnap,actorSnap]=await Promise.all([tx.get(roomRef),tx.get(actorRef)]);
    if(!roomSnap.exists)throw new ApiError("room_not_found",404);
    const room=roomSnap.data()||{};
    const access=roomMusicAccess(room,actorSnap.data()||{},uid);
    if(!access.managePolicy)throw new ApiError("forbidden",403);
    const previous=normalizeRoomMusicPolicy(room);
    tx.update(roomRef,{
      musicPolicy:{allowMembers},
      updatedAt:FieldValue.serverTimestamp(),
    });
    const auditRef=db.collection("room_audit_logs").doc(roomId).collection("items").doc();
    tx.create(auditRef,{
      action:"setMusicPolicy",
      actorUid:uid,
      before:previous,
      after:{allowMembers},
      createdAt:FieldValue.serverTimestamp(),
    });
    return {ok:true,roomId,policy:{allowMembers}};
  });
}

async function addRoomMusicTrack(db,uid,body){
  const roomId=clean(body.roomId);
  const title=clean(body.title);
  const artist=clean(body.artist);
  const durationMs=Math.max(0,Math.min(24*60*60*1000,Number(body.durationMs||0)));
  if(!/^[A-Za-z0-9_-]{1,180}$/.test(roomId)||!title||title.length>120||artist.length>120){
    throw new ApiError("invalid_music_track",400);
  }
  const roomRef=db.collection("rooms").doc(roomId);
  const actorRef=db.collection("users").doc(uid);
  const profileRef=db.collection("public_profiles").doc(uid);
  return db.runTransaction(async tx=>{
    const [roomSnap,actorSnap,profileSnap]=await Promise.all([
      tx.get(roomRef),tx.get(actorRef),tx.get(profileRef),
    ]);
    if(!roomSnap.exists||roomSnap.data()?.isActive===false)throw new ApiError("room_unavailable",404);
    const room=roomSnap.data()||{};
    const access=roomMusicAccess(room,actorSnap.data()||{},uid);
    if(!access.canAddOrPlay)throw new ApiError("music_permission_required",403);
    const queue=normalizeRoomMusicQueue(room);
    if(queue.length>=50)throw new ApiError("music_queue_full",409);
    const profile=profileSnap.data()||{};
    const now=Date.now();
    const track={
      id:"track_"+now+"_"+randomInt(100000,999999),
      title,
      artist,
      durationMs,
      sourceOwnerUid:uid,
      sourceOwnerName:clean(profile.displayName||profile.username||"مستخدم Shadow Live"),
      createdAtMs:now,
    };
    queue.push(track);
    tx.update(roomRef,{musicQueue:queue,updatedAt:FieldValue.serverTimestamp()});
    return {ok:true,roomId,track,queue};
  });
}

async function removeRoomMusicTrack(db,uid,body){
  const roomId=clean(body.roomId);
  const trackId=clean(body.trackId);
  if(!/^[A-Za-z0-9_-]{1,180}$/.test(roomId)||!trackId)throw new ApiError("invalid_request",400);
  const roomRef=db.collection("rooms").doc(roomId);
  const actorRef=db.collection("users").doc(uid);
  return db.runTransaction(async tx=>{
    const [roomSnap,actorSnap]=await Promise.all([tx.get(roomRef),tx.get(actorRef)]);
    if(!roomSnap.exists)throw new ApiError("room_not_found",404);
    const room=roomSnap.data()||{};
    const access=roomMusicAccess(room,actorSnap.data()||{},uid);
    const queue=normalizeRoomMusicQueue(room);
    const track=queue.find(item=>item.id===trackId);
    if(!track)throw new ApiError("music_track_not_found",404);
    if(!access.manage&&track.sourceOwnerUid!==uid)throw new ApiError("forbidden",403);
    const nextQueue=queue.filter(item=>item.id!==trackId);
    const state=normalizeRoomMusicState(room);
    const nextState=state.currentTrackId===trackId
      ? {...state,status:"stopped",currentTrackId:"",sourceOwnerUid:"",requestedBy:uid,commandRevision:state.commandRevision+1}
      : state;
    tx.update(roomRef,{
      musicQueue:nextQueue,
      musicState:nextState,
      updatedAt:FieldValue.serverTimestamp(),
    });
    return {ok:true,roomId,queue:nextQueue,state:nextState};
  });
}

async function clearRoomMusicQueue(db,uid,body){
  const roomId=clean(body.roomId);
  if(!/^[A-Za-z0-9_-]{1,180}$/.test(roomId))throw new ApiError("invalid_room_id",400);
  const roomRef=db.collection("rooms").doc(roomId);
  const actorRef=db.collection("users").doc(uid);
  return db.runTransaction(async tx=>{
    const [roomSnap,actorSnap]=await Promise.all([tx.get(roomRef),tx.get(actorRef)]);
    if(!roomSnap.exists)throw new ApiError("room_not_found",404);
    const room=roomSnap.data()||{};
    const access=roomMusicAccess(room,actorSnap.data()||{},uid);
    if(!access.manage)throw new ApiError("forbidden",403);
    const state=normalizeRoomMusicState(room);
    const nextState={
      ...state,
      status:"stopped",
      currentTrackId:"",
      sourceOwnerUid:"",
      requestedBy:uid,
      commandRevision:state.commandRevision+1,
    };
    tx.update(roomRef,{
      musicQueue:[],
      musicState:nextState,
      updatedAt:FieldValue.serverTimestamp(),
    });
    return {ok:true,roomId,queue:[],state:nextState};
  });
}

async function assertRoomMusicSourcePresent(db,tx,roomId,sourceOwnerUid){
  const realtimePresent=await realtimeUserPresent(roomId,sourceOwnerUid);
  if(realtimePresent===true)return "room_realtime";
  if(realtimePresent===false)throw new ApiError("music_source_offline",409);

  const sourcePresence=await tx.get(
    db.collection("room_presence").doc(roomId).collection("users").doc(sourceOwnerUid),
  );
  if(!legacyPresenceFresh(sourcePresence)){
    throw new ApiError("music_source_offline",409);
  }
  return "legacy_room_presence";
}

async function roomMusicCommand(db,uid,body){
  const roomId=clean(body.roomId);
  const command=clean(body.command);
  const trackId=clean(body.trackId);
  if(!/^[A-Za-z0-9_-]{1,180}$/.test(roomId)||!["play","stop","skip"].includes(command)){
    throw new ApiError("invalid_music_command",400);
  }
  const roomRef=db.collection("rooms").doc(roomId);
  const actorRef=db.collection("users").doc(uid);
  return db.runTransaction(async tx=>{
    const [roomSnap,actorSnap]=await Promise.all([tx.get(roomRef),tx.get(actorRef)]);
    if(!roomSnap.exists||roomSnap.data()?.isActive===false)throw new ApiError("room_unavailable",404);
    const room=roomSnap.data()||{};
    const access=roomMusicAccess(room,actorSnap.data()||{},uid);
    const queue=normalizeRoomMusicQueue(room);
    const state=normalizeRoomMusicState(room);
    let nextState=state;

    if(command==="play"){
      if(!access.canAddOrPlay)throw new ApiError("music_permission_required",403);
      const track=queue.find(item=>item.id===trackId);
      if(!track)throw new ApiError("music_track_not_found",404);
      if(!access.manage&&track.sourceOwnerUid!==uid)throw new ApiError("forbidden",403);
      await assertRoomMusicSourcePresent(
        db,
        tx,
        roomId,
        track.sourceOwnerUid,
      );
      nextState={
        status:"playing",
        currentTrackId:track.id,
        sourceOwnerUid:track.sourceOwnerUid,
        requestedBy:uid,
        startedAtMs:Date.now(),
        commandRevision:state.commandRevision+1,
      };
    }else if(command==="stop"){
      const current=queue.find(item=>item.id===state.currentTrackId);
      const ownCurrent=current?.sourceOwnerUid===uid;
      if(!access.manage&&!ownCurrent)throw new ApiError("forbidden",403);
      nextState={
        status:"stopped",
        currentTrackId:"",
        sourceOwnerUid:"",
        requestedBy:uid,
        startedAtMs:0,
        commandRevision:state.commandRevision+1,
      };
    }else{
      if(!access.manage)throw new ApiError("forbidden",403);
      const currentIndex=queue.findIndex(item=>item.id===state.currentTrackId);
      const nextTrack=currentIndex>=0&&currentIndex+1<queue.length?queue[currentIndex+1]:null;
      if(nextTrack){
        await assertRoomMusicSourcePresent(
          db,
          tx,
          roomId,
          nextTrack.sourceOwnerUid,
        );
      }
      nextState=nextTrack
        ? {
            status:"playing",
            currentTrackId:nextTrack.id,
            sourceOwnerUid:nextTrack.sourceOwnerUid,
            requestedBy:uid,
            startedAtMs:Date.now(),
            commandRevision:state.commandRevision+1,
          }
        : {
            status:"stopped",
            currentTrackId:"",
            sourceOwnerUid:"",
            requestedBy:uid,
            startedAtMs:0,
            commandRevision:state.commandRevision+1,
          };
    }

    tx.update(roomRef,{musicState:nextState,updatedAt:FieldValue.serverTimestamp()});
    return {ok:true,roomId,state:nextState,queue};
  });
}

async function roomGhostState(db,uid){
  const snap=await db.collection("users").doc(uid).get();
  const data=snap.data()||{};
  const canUse=canUseRoomGhostMode(data,Date.now());
  return {
    ok:true,
    ghostMode:activeRoomGhostMode(data,Date.now()),
    canUseGhostMode:canUse,
    requiredVipLevel:5,
  };
}

async function setRoomGhostMode(db,uid,body){
  const enabled=body.enabled===true;
  const userRef=db.collection("users").doc(uid);
  const snap=await userRef.get();
  if(!snap.exists)throw new ApiError("user_not_found",404);
  const user=snap.data()||{};
  if(enabled&&!canUseRoomGhostMode(user,Date.now())){
    throw new ApiError("ghost_mode_requires_vip5",403);
  }
  await userRef.set({
    roomGhostMode:enabled,
    roomGhostModeUpdatedAt:FieldValue.serverTimestamp(),
    updatedAt:FieldValue.serverTimestamp(),
  },{merge:true});
  return {
    ok:true,
    ghostMode:enabled,
    canUseGhostMode:canUseRoomGhostMode(user,Date.now()),
    requiredVipLevel:5,
  };
}

async function roomHiddenEntryState(db,uid){
  const snap=await db.collection("users").doc(uid).get();
  const data=snap.data()||{};
  const canUse=canUseHiddenRoomEntry(data,Date.now());
  return {
    ok:true,
    hiddenRoomEntry:activeHiddenRoomEntry(data,Date.now()),
    canUseHiddenRoomEntry:canUse,
    requiredVipLevel:7,
  };
}

async function setRoomHiddenEntry(db,uid,body){
  const enabled=body.enabled===true;
  const userRef=db.collection("users").doc(uid);
  const snap=await userRef.get();
  if(!snap.exists)throw new ApiError("user_not_found",404);
  const user=snap.data()||{};
  if(enabled&&!canUseHiddenRoomEntry(user,Date.now())){
    throw new ApiError("hidden_entry_requires_vip7",403);
  }
  await userRef.set({
    roomHiddenEntry:enabled,
    roomHiddenEntryUpdatedAt:FieldValue.serverTimestamp(),
    updatedAt:FieldValue.serverTimestamp(),
  },{merge:true});
  return {
    ok:true,
    hiddenRoomEntry:enabled,
    canUseHiddenRoomEntry:canUseHiddenRoomEntry(user,Date.now()),
    requiredVipLevel:7,
  };
}

async function refreshRoomPresenceSummary(db,roomId,{includeGhost=false}={}){
  const now=Date.now();
  const cutoff=now-90000;
  const collection=db.collection("room_presence").doc(roomId).collection("users");
  const snapshot=await collection.limit(500).get();
  const active=[];
  const stale=[];
  for(const doc of snapshot.docs){
    const data=doc.data()||{};
    const lastSeenAtMs=Number(data.lastSeenAtMs||0);
    if(lastSeenAtMs>=cutoff){
      const vipExpiresAtMs=Math.max(0,Number(data.vipExpiresAtMs||0));
      const ghostMode=data.ghostMode===true&&
        (vipExpiresAtMs===0||vipExpiresAtMs>now);
      active.push({
        uid:doc.id,
        displayName:clean(data.displayName||"مستخدم Shadow Live"),
        profileImageUrl:clean(data.profileImageUrl),
        activeProfileFrameAssetKey:
          clean(data.activeProfileFrameAssetKey),
        activeProfileFrameImageUrl:
          clean(data.activeProfileFrameImageUrl),
        activeProfileFrameExpiresAtMs:Math.max(
          0,
          Number(data.activeProfileFrameExpiresAtMs||0),
        ),
        activeProfileFramePermanent:
          data.activeProfileFramePermanent===true,
        joinedAtMs:Number(data.joinedAtMs||0),
        lastSeenAtMs,
        ghostMode,
      });
    }else{
      stale.push(doc.ref);
    }
  }

  if(stale.length){
    const batch=db.batch();
    for(const ref of stale.slice(0,450))batch.delete(ref);
    await batch.commit();
  }
  const roomRef=db.collection("rooms").doc(roomId);
  const roomSnap=await roomRef.get();
  const room=roomSnap.data()||{};
  const publicActive=active.filter(item=>item.ghostMode!==true);
  const update={
    onlineCount:publicActive.length,
    participantsCount:publicActive.length,
    lastPresenceAtMs:now,
    updatedAt:FieldValue.serverTimestamp(),
  };
  const musicState=normalizeRoomMusicState(room);
  const activeUids=new Set(active.map(item=>item.uid));
  if(musicState.status==="playing"&&
      musicState.sourceOwnerUid&&
      !activeUids.has(musicState.sourceOwnerUid)){
    update.musicState={
      ...musicState,
      status:"stopped",
      currentTrackId:"",
      sourceOwnerUid:"",
      requestedBy:"system_source_left",
      startedAtMs:0,
      commandRevision:musicState.commandRevision+1,
    };
  }
  await roomRef.set(update,{merge:true});
  active.sort((a,b)=>a.joinedAtMs-b.joinedAtMs);
  publicActive.sort((a,b)=>a.joinedAtMs-b.joinedAtMs);
  return includeGhost?active:publicActive;
}

async function roomPresenceAnnounceJoin(db,uid,roomId){
  if(!/^[A-Za-z0-9_-]{1,180}$/.test(roomId))throw new ApiError("invalid_room_id",400);
  const [roomSnap,present]=await Promise.all([
    db.collection("rooms").doc(roomId).get(),
    realtimeUserPresent(roomId,uid),
  ]);
  if(!roomSnap.exists||roomSnap.data()?.isActive===false)throw new ApiError("room_unavailable",404);
  if(present===false)throw new ApiError("presence_socket_required",409);
  if(present===null)await assertRoomRealtimePresence(db,roomId,uid);
  // Join feed is emitted by RoomRealtimeObject. Do not persist room chat history.
  return {ok:true,roomId};
}

async function roomSessionLeave(db,uid,roomId){
  if(!/^[A-Za-z0-9_-]{1,180}$/.test(roomId))throw new ApiError("invalid_room_id",400);
  const roomRef=db.collection("rooms").doc(roomId);

  await db.runTransaction(async tx=>{
    const roomSnap=await tx.get(roomRef);
    if(!roomSnap.exists)return;
    const room=roomSnap.data()||{};
    let seats=normalizeSeats(room);
    const seat=seats.find(item=>item.uid===uid);
    const update={};
    if(seat){
      await recordMicActivity(tx,db,uid,seat);
      seats=seats.map(item=>item.uid===uid
        ? {
            ...item,
            uid:"",
            displayName:"",
            profileImageUrl:"",
            muted:true,
            micStartedAtMs:0,
            frameRewardId:"",
            frameAssetKey:"",
            frameImageUrl:"",
            frameExpiresAtMs:0,
            voiceWaveRewardId:"",
            voiceWaveAssetKey:"",
            voiceWaveImageUrl:"",
            voiceWaveExpiresAtMs:0,
          }
        : item);
      update.seats=seats;
    }

    const musicState=normalizeRoomMusicState(room);
    if(musicState.status==="playing"&&musicState.sourceOwnerUid===uid){
      update.musicState={
        ...musicState,
        status:"stopped",
        currentTrackId:"",
        sourceOwnerUid:"",
        requestedBy:"system_source_left",
        startedAtMs:0,
        commandRevision:musicState.commandRevision+1,
      };
    }
    if(Object.keys(update).length){
      update.updatedAt=FieldValue.serverTimestamp();
      tx.update(roomRef,update);
    }
  });
  return {ok:true,roomId};
}
async function roomPresenceJoin(db,uid,roomId){
  if(!/^[A-Za-z0-9_-]{1,180}$/.test(roomId))throw new ApiError("invalid_room_id",400);
  const roomRef=db.collection("rooms").doc(roomId);
  const profileRef=db.collection("public_profiles").doc(uid);
  const userRef=db.collection("users").doc(uid);
  const presenceRef=db.collection("room_presence").doc(roomId).collection("users").doc(uid);
  const [roomSnap,profileSnap,userSnap,presenceSnap]=await Promise.all([
    roomRef.get(),profileRef.get(),userRef.get(),presenceRef.get(),
  ]);
  if(!roomSnap.exists||roomSnap.data()?.isActive===false)throw new ApiError("room_unavailable",404);
  const profile=profileSnap.data()||{};
  const user=userSnap.data()||{};
  const now=Date.now();
  const entitlements=vipEntitlementsFromUser(user,now);
  const ghostMode=activeRoomGhostMode(user,now);
  const vipLevel=entitlements.level;
  const vipExpiresAtMs=timestampToEpochMs(user.vipExpiresAt);
  const displayName=clean(profile.displayName||profile.username||user.displayName||user.username||"مستخدم Shadow Live");
  const profileImageUrl=clean(profile.profileImageUrl||user.profileImageUrl);
  await presenceRef.set({
    uid,
    displayName,
    profileImageUrl,
    activeProfileFrameAssetKey:
      clean(profile.activeProfileFrameAssetKey||user.activeProfileFrameAssetKey),
    activeProfileFrameImageUrl:
      clean(profile.activeProfileFrameImageUrl||user.activeProfileFrameImageUrl),
    activeProfileFrameExpiresAtMs:Math.max(
      0,
      Number(
        profile.activeProfileFrameExpiresAtMs||
        user.activeProfileFrameExpiresAtMs||
        0
      ),
    ),
    activeProfileFramePermanent:
      profile.activeProfileFramePermanent===true||
      user.activeProfileFramePermanent===true,
    joinedAtMs:presenceSnap.exists?Number(presenceSnap.data()?.joinedAtMs||now):now,
    lastSeenAtMs:now,
    ghostMode,
    vipLevel,
    vipExpiresAtMs,
  },{merge:true});

  const participants=await refreshRoomPresenceSummary(db,roomId);
  return {ok:true,roomId,onlineCount:participants.length,participants};
}

async function roomPresenceHeartbeat(db,uid,roomId){
  if(!/^[A-Za-z0-9_-]{1,180}$/.test(roomId))throw new ApiError("invalid_room_id",400);
  // Heartbeats must stay O(1). Do not scan the whole room or rewrite the room
  // summary on every user's timer; join/leave/state refresh the aggregate instead.
  const presenceRef=db.collection("room_presence").doc(roomId).collection("users").doc(uid);
  const snap=await presenceRef.get();
  const now=Date.now();
  if(snap.exists){
    await presenceRef.set({lastSeenAtMs:now},{merge:true});
  }else{
    const [profileSnap,userSnap]=await Promise.all([
      db.collection("public_profiles").doc(uid).get(),
      db.collection("users").doc(uid).get(),
    ]);
    const data=profileSnap.data()||{};
    const user=userSnap.data()||{};
    const entitlements=vipEntitlementsFromUser(user,now);
    await presenceRef.set({
      uid,
      displayName:clean(data.displayName||data.username||"مستخدم Shadow Live"),
      profileImageUrl:clean(data.profileImageUrl||user.profileImageUrl),
      activeProfileFrameAssetKey:
        clean(data.activeProfileFrameAssetKey||user.activeProfileFrameAssetKey),
      activeProfileFrameImageUrl:
        clean(data.activeProfileFrameImageUrl||user.activeProfileFrameImageUrl),
      activeProfileFrameExpiresAtMs:Math.max(
        0,
        Number(
          data.activeProfileFrameExpiresAtMs||
          user.activeProfileFrameExpiresAtMs||
          0
        ),
      ),
      activeProfileFramePermanent:
        data.activeProfileFramePermanent===true||
        user.activeProfileFramePermanent===true,
      joinedAtMs:now,
      lastSeenAtMs:now,
      ghostMode:activeRoomGhostMode(user,now),
      vipLevel:entitlements.level,
      vipExpiresAtMs:timestampToEpochMs(user.vipExpiresAt),
    });
  }
  return {ok:true,roomId};
}

async function roomPresenceLeave(db,uid,roomId){
  if(!/^[A-Za-z0-9_-]{1,180}$/.test(roomId))throw new ApiError("invalid_room_id",400);
  const roomRef=db.collection("rooms").doc(roomId);
  await db.runTransaction(async tx=>{
    const roomSnap=await tx.get(roomRef);
    if(!roomSnap.exists)return;
    const room=roomSnap.data()||{};
    let seats=normalizeSeats(room);
    const seat=seats.find(item=>item.uid===uid);
    if(seat){
      await recordMicActivity(tx,db,uid,seat);
      seats=seats.map(item=>item.uid===uid
        ? {
            ...item,
            uid:"",
            displayName:"",
            profileImageUrl:"",
            muted:true,
            micStartedAtMs:0,
            frameRewardId:"",
            frameAssetKey:"",
            frameImageUrl:"",
            frameExpiresAtMs:0,
            voiceWaveRewardId:"",
            voiceWaveAssetKey:"",
            voiceWaveImageUrl:"",
            voiceWaveExpiresAtMs:0,
          }
        : item);
      tx.update(roomRef,{seats,updatedAt:FieldValue.serverTimestamp()});
    }
  });
  await db.collection("room_presence").doc(roomId).collection("users").doc(uid).delete();
  const participants=await refreshRoomPresenceSummary(db,roomId);
  return {ok:true,roomId,onlineCount:participants.length};
}

async function roomPresenceState(db,uid,roomId){
  if(!/^[A-Za-z0-9_-]{1,180}$/.test(roomId))throw new ApiError("invalid_room_id",400);
  const [roomSnap,actorSnap]=await Promise.all([
    db.collection("rooms").doc(roomId).get(),
    db.collection("users").doc(uid).get(),
  ]);
  if(!roomSnap.exists)throw new ApiError("room_not_found",404);
  const includeGhost=canInspectHiddenRoomPresence(actorSnap.data()||{});
  const participants=await refreshRoomPresenceSummary(db,roomId,{includeGhost});
  return {
    ok:true,
    roomId,
    onlineCount:participants.length,
    participants,
    hiddenPresenceVisible:includeGhost,
  };
}

function normalizeStarBattleState(room){
  const raw=room.starBattleState;
  if(!raw||typeof raw!=="object")return null;
  const scores=raw.scores&&typeof raw.scores==="object"?raw.scores:{};
  const leaders=Object.entries(scores).map(([uid,value])=>{
    const item=value&&typeof value==="object"?value:{};
    return {
      uid:clean(uid),
      displayName:clean(item.displayName||"مستخدم Shadow Live"),
      profileImageUrl:clean(item.profileImageUrl),
      activeProfileFrameAssetKey:clean(
        item.activeProfileFrameAssetKey||item.frameAssetKey,
      ),
      activeProfileFrameImageUrl:clean(
        item.activeProfileFrameImageUrl||item.frameImageUrl,
      ),
      activeProfileFrameExpiresAtMs:Math.max(
        0,
        Number(item.activeProfileFrameExpiresAtMs||item.frameExpiresAtMs||0),
      ),
      activeProfileFramePermanent:
        item.activeProfileFramePermanent===true,
      coins:Math.max(0,Math.floor(Number(item.coins||0))),
    };
  }).filter(item=>item.uid).sort((a,b)=>b.coins-a.coins).slice(0,99);
  return {
    id:clean(raw.id),
    status:clean(raw.status||"idle"),
    durationMinutes:Number(raw.durationMinutes||0),
    createdBy:clean(raw.createdBy),
    createdAtMs:Number(raw.createdAtMs||0),
    endsAtMs:Number(raw.endsAtMs||0),
    finishedAtMs:Number(raw.finishedAtMs||0),
    endedBy:clean(raw.endedBy),
    leaders,
  };
}

function activeStarBattle(room){
  const battle=normalizeStarBattleState(room);
  return battle&&battle.status==="active"?battle:null;
}

async function createStarBattle(db,uid,body){
  const roomId=clean(body.roomId);
  const durationMinutes=Number(body.durationMinutes);
  if(!/^[A-Za-z0-9_-]{1,180}$/.test(roomId))throw new ApiError("invalid_room_id",400);
  if(![5,10,15,30,60].includes(durationMinutes))throw new ApiError("invalid_star_battle_duration",400);
  const roomRef=db.collection("rooms").doc(roomId);
  const actorRef=db.collection("users").doc(uid);
  const auditRef=db.collection("room_audit_logs").doc(roomId).collection("items").doc();
  return db.runTransaction(async tx=>{
    const [roomSnap,actorSnap]=await Promise.all([tx.get(roomRef),tx.get(actorRef)]);
    if(!roomSnap.exists||roomSnap.data()?.isActive===false)throw new ApiError("room_unavailable",404);
    const room=roomSnap.data()||{};
    if(!canManageRoomAction(room,actorSnap.data()||{},uid,"managePk"))throw new ApiError("forbidden",403);
    if(activeStarBattle(room))throw new ApiError("star_battle_already_active",409);
    const now=Date.now();
    const battle={
      id:"star_"+now+"_"+randomInt(100000,999999),
      status:"active",
      durationMinutes,
      createdBy:uid,
      createdAtMs:now,
      endsAtMs:now+durationMinutes*60*1000,
      finishedAtMs:0,
      endedBy:"",
      scores:{},
    };
    tx.update(roomRef,{starBattleState:battle,updatedAt:FieldValue.serverTimestamp()});
    tx.create(auditRef,{action:"createStarBattle",actorUid:uid,after:{id:battle.id,durationMinutes},createdAt:FieldValue.serverTimestamp()});
    return {ok:true,roomId,battle:normalizeStarBattleState({starBattleState:battle})};
  });
}

async function finishStarBattle(db,uid,body,{allowSystem=false}={}){
  const roomId=clean(body.roomId);
  if(!/^[A-Za-z0-9_-]{1,180}$/.test(roomId))throw new ApiError("invalid_room_id",400);
  const roomRef=db.collection("rooms").doc(roomId);
  const actorRef=db.collection("users").doc(uid);
  return db.runTransaction(async tx=>{
    const [roomSnap,actorSnap]=await Promise.all([tx.get(roomRef),tx.get(actorRef)]);
    if(!roomSnap.exists)throw new ApiError("room_not_found",404);
    const room=roomSnap.data()||{};
    const battle=activeStarBattle(room);
    if(!battle)return {ok:true,roomId,battle:normalizeStarBattleState(room)};
    const now=Date.now();
    const expired=battle.endsAtMs>0&&now>=battle.endsAtMs;
    if(!expired&&!allowSystem&&!canManageRoomAction(room,actorSnap.data()||{},uid,"managePk")){
      throw new ApiError("forbidden",403);
    }
    const raw=room.starBattleState&&typeof room.starBattleState==="object"?room.starBattleState:{};
    const finished={...raw,status:"finished",finishedAtMs:now,endedBy:expired?"system":uid};
    const result=normalizeStarBattleState({starBattleState:finished});
    const historyRef=roomRef.collection("star_battle_history").doc(clean(result?.id)||("star_"+now));
    tx.update(roomRef,{starBattleState:finished,updatedAt:FieldValue.serverTimestamp()});
    tx.set(historyRef,{...result,createdAt:FieldValue.serverTimestamp()});
    const auditRef=db.collection("room_audit_logs").doc(roomId).collection("items").doc();
    tx.create(auditRef,{action:"finishStarBattle",actorUid:expired?"system":uid,after:{id:result?.id||"",leaderCount:result?.leaders?.length||0},createdAt:FieldValue.serverTimestamp()});
    return {ok:true,roomId,battle:result};
  });
}

async function syncStarBattle(db,uid,body){
  const roomId=clean(body.roomId);
  if(!/^[A-Za-z0-9_-]{1,180}$/.test(roomId))throw new ApiError("invalid_room_id",400);
  const snap=await db.collection("rooms").doc(roomId).get();
  if(!snap.exists)throw new ApiError("room_not_found",404);
  const battle=activeStarBattle(snap.data()||{});
  if(battle&&battle.endsAtMs>0&&Date.now()>=battle.endsAtMs){
    return finishStarBattle(db,uid,{roomId},{allowSystem:true});
  }
  return {ok:true,roomId,battle:normalizeStarBattleState(snap.data()||{})};
}

async function starBattleHistory(db,roomId){
  if(!/^[A-Za-z0-9_-]{1,180}$/.test(roomId))throw new ApiError("invalid_room_id",400);
  const snap=await db.collection("rooms").doc(roomId).collection("star_battle_history")
    .orderBy("finishedAtMs","desc").limit(100).get();
  return {ok:true,roomId,history:snap.docs.map(doc=>doc.data())};
}

function normalizePkState(room){
  const raw=room.pkState;
  if(!raw||typeof raw!=="object")return null;
  const participants=Array.isArray(raw.participants)
    ? raw.participants.map(item=>({
        uid:clean(item?.uid),
        displayName:clean(item?.displayName||"مستخدم Shadow Live"),
        profileImageUrl:clean(item?.profileImageUrl),
        activeProfileFrameAssetKey:clean(
          item?.activeProfileFrameAssetKey||item?.frameAssetKey,
        ),
        activeProfileFrameImageUrl:clean(
          item?.activeProfileFrameImageUrl||item?.frameImageUrl,
        ),
        activeProfileFrameExpiresAtMs:Math.max(
          0,
          Number(item?.activeProfileFrameExpiresAtMs||item?.frameExpiresAtMs||0),
        ),
        activeProfileFramePermanent:
          item?.activeProfileFramePermanent===true,
        seatIndex:Number.isInteger(Number(item?.seatIndex))?Number(item.seatIndex):-1,
        team:clean(item?.team)==="b"?"b":"a",
        accepted:item?.accepted===true,
        score:Math.max(0,Number(item?.score||0)),
      })).filter(item=>item.uid)
    : [];
  const teamA=participants.filter(item=>item.team==="a")
    .reduce((sum,item)=>sum+Number(item.score||0),0);
  const teamB=participants.filter(item=>item.team==="b")
    .reduce((sum,item)=>sum+Number(item.score||0),0);
  return {
    id:clean(raw.id),
    status:clean(raw.status||"idle"),
    mode:clean(raw.mode),
    durationMinutes:Number(raw.durationMinutes||0),
    participants,
    teamScores:{a:teamA,b:teamB},
    createdBy:clean(raw.createdBy),
    createdAtMs:Number(raw.createdAtMs||0),
    countdownEndsAtMs:Number(raw.countdownEndsAtMs||0),
    endsAtMs:Number(raw.endsAtMs||0),
    overtimeUsed:raw.overtimeUsed===true,
    winner:clean(raw.winner),
    cancelledBy:clean(raw.cancelledBy),
    finishedAtMs:Number(raw.finishedAtMs||0),
    supporters:Array.isArray(raw.supporters)
      ? raw.supporters.map(item=>({
          uid:clean(item?.uid),
          displayName:clean(item?.displayName||"مستخدم Shadow Live"),
          profileImageUrl:clean(item?.profileImageUrl),
          activeProfileFrameAssetKey:clean(
            item?.activeProfileFrameAssetKey||item?.frameAssetKey,
          ),
          activeProfileFrameImageUrl:clean(
            item?.activeProfileFrameImageUrl||item?.frameImageUrl,
          ),
          activeProfileFrameExpiresAtMs:Math.max(
            0,
            Number(item?.activeProfileFrameExpiresAtMs||item?.frameExpiresAtMs||0),
          ),
          activeProfileFramePermanent:
            item?.activeProfileFramePermanent===true,
          coins:Math.max(0,Number(item?.coins||0)),
        })).filter(item=>item.uid).sort((a,b)=>b.coins-a.coins).slice(0,3)
      : [],
  };
}

function activePk(room){
  const pk=normalizePkState(room);
  if(!pk)return null;
  return ["awaiting_acceptance","countdown","active"].includes(pk.status)?pk:null;
}

async function pkState(db,roomId){
  if(!/^[A-Za-z0-9_-]{1,180}$/.test(roomId))throw new ApiError("invalid_room_id",400);
  const snap=await db.collection("rooms").doc(roomId).get();
  if(!snap.exists)throw new ApiError("room_not_found",404);
  return {ok:true,roomId,pk:normalizePkState(snap.data()||{})};
}

async function createPk(db,uid,body){
  const roomId=clean(body.roomId);
  const durationMinutes=Number(body.durationMinutes);
  const requested=Array.isArray(body.participantUids)
    ? [...new Set(body.participantUids.map(clean).filter(Boolean))]
    : [];
  if(!/^[A-Za-z0-9_-]{1,180}$/.test(roomId))throw new ApiError("invalid_room_id",400);
  if(![5,10,15,30].includes(durationMinutes))throw new ApiError("invalid_pk_duration",400);
  if(![2,4,6,8].includes(requested.length))throw new ApiError("invalid_pk_participants",400);

  const roomRef=db.collection("rooms").doc(roomId);
  const actorRef=db.collection("users").doc(uid);
  return db.runTransaction(async tx=>{
    const [roomSnap,actorSnap]=await Promise.all([tx.get(roomRef),tx.get(actorRef)]);
    if(!roomSnap.exists)throw new ApiError("room_not_found",404);
    const room=roomSnap.data()||{};
    if(room.isActive===false)throw new ApiError("room_unavailable",409);
    if(!roomFeatureFlags(room).pkEnabled)throw new ApiError("room_pk_disabled",409);
    if(!canManageRoomAction(room,actorSnap.data()||{},uid,"managePk")){
      throw new ApiError("forbidden",403);
    }
    if(activePk(room))throw new ApiError("pk_already_active",409);

    const seats=normalizeSeats(room);
    const participantSeats=requested.map(targetUid=>{
      const seat=seats.find(item=>item.uid===targetUid);
      if(!seat)throw new ApiError("pk_participant_not_on_mic",409);
      return seat;
    });

    const half=requested.length/2;
    const participants=[];
    for(let index=0;index<requested.length;index++){
      const targetUid=requested[index];
      const seat=participantSeats[index];
      participants.push({
        uid:targetUid,
        displayName:clean(seat.displayName||"مستخدم Shadow Live"),
        profileImageUrl:clean(seat.profileImageUrl),
        activeProfileFrameAssetKey:clean(seat.frameAssetKey),
        activeProfileFrameImageUrl:clean(seat.frameImageUrl),
        activeProfileFrameExpiresAtMs:Math.max(
          0,
          Number(seat.frameExpiresAtMs||0),
        ),
        activeProfileFramePermanent:false,
        seatIndex:Number(seat.index),
        team:index<half?"a":"b",
        accepted:targetUid===uid,
        score:0,
      });
    }

    const now=Date.now();
    const pk={
      id:"pk_"+now+"_"+randomInt(100000,999999),
      status:participants.every(item=>item.accepted)?"countdown":"awaiting_acceptance",
      mode:String(half)+"v"+String(half),
      durationMinutes,
      participants,
      createdBy:uid,
      createdAtMs:now,
      countdownEndsAtMs:participants.every(item=>item.accepted)?now+3000:0,
      endsAtMs:participants.every(item=>item.accepted)?now+3000+durationMinutes*60*1000:0,
      overtimeUsed:false,
      winner:"",
      cancelledBy:"",
      finishedAtMs:0,
      supporters:[],
      giftCount:0,
    };
    tx.update(roomRef,{pkState:pk,updatedAt:FieldValue.serverTimestamp()});
    return {ok:true,roomId,pk:normalizePkState({pkState:pk})};
  });
}

async function respondPk(db,uid,body,accepted){
  const roomId=clean(body.roomId);
  if(!/^[A-Za-z0-9_-]{1,180}$/.test(roomId))throw new ApiError("invalid_room_id",400);
  const roomRef=db.collection("rooms").doc(roomId);
  return db.runTransaction(async tx=>{
    const snap=await tx.get(roomRef);
    if(!snap.exists)throw new ApiError("room_not_found",404);
    const room=snap.data()||{};
    const pk=activePk(room);
    if(!pk||pk.status!=="awaiting_acceptance")throw new ApiError("pk_not_waiting",409);
    const index=pk.participants.findIndex(item=>item.uid===uid);
    if(index<0)throw new ApiError("not_pk_participant",403);

    if(!accepted){
      const cancelled={
        ...pk,
        status:"cancelled",
        cancelledBy:uid,
        finishedAtMs:Date.now(),
      };
      tx.update(roomRef,{pkState:cancelled,updatedAt:FieldValue.serverTimestamp()});
      return {ok:true,roomId,pk:cancelled};
    }

    pk.participants[index]={...pk.participants[index],accepted:true};
    const allAccepted=pk.participants.every(item=>item.accepted);
    const now=Date.now();
    const next={
      ...pk,
      status:allAccepted?"countdown":"awaiting_acceptance",
      countdownEndsAtMs:allAccepted?now+3000:0,
      endsAtMs:allAccepted?now+3000+pk.durationMinutes*60*1000:0,
    };
    tx.update(roomRef,{pkState:next,updatedAt:FieldValue.serverTimestamp()});
    return {ok:true,roomId,pk:next};
  });
}

async function cancelPk(db,uid,body){
  const roomId=clean(body.roomId);
  if(!/^[A-Za-z0-9_-]{1,180}$/.test(roomId))throw new ApiError("invalid_room_id",400);
  const roomRef=db.collection("rooms").doc(roomId);
  const actorRef=db.collection("users").doc(uid);
  return db.runTransaction(async tx=>{
    const [roomSnap,actorSnap]=await Promise.all([tx.get(roomRef),tx.get(actorRef)]);
    if(!roomSnap.exists)throw new ApiError("room_not_found",404);
    const room=roomSnap.data()||{};
    const pk=activePk(room);
    if(!pk)throw new ApiError("pk_not_active",409);
    if(!canManageRoomAction(room,actorSnap.data()||{},uid,"managePk")){
      throw new ApiError("forbidden",403);
    }
    const next={
      ...pk,
      status:"cancelled",
      cancelledBy:uid,
      winner:"",
      finishedAtMs:Date.now(),
    };
    tx.update(roomRef,{pkState:next,updatedAt:FieldValue.serverTimestamp()});
    return {ok:true,roomId,pk:next};
  });
}

async function syncPk(db,uid,body){
  const roomId=clean(body.roomId);
  if(!/^[A-Za-z0-9_-]{1,180}$/.test(roomId))throw new ApiError("invalid_room_id",400);
  const roomRef=db.collection("rooms").doc(roomId);
  return db.runTransaction(async tx=>{
    const snap=await tx.get(roomRef);
    if(!snap.exists)throw new ApiError("room_not_found",404);
    const room=snap.data()||{};
    const pk=activePk(room);
    if(!pk)return {ok:true,roomId,pk:normalizePkState(room)};

    const now=Date.now();
    let next=pk;
    if(pk.status==="countdown"&&pk.countdownEndsAtMs>0&&now>=pk.countdownEndsAtMs){
      next={...pk,status:"active"};
    }
    if((next.status==="active"||next.status==="countdown")&&
        next.endsAtMs>0&&now>=next.endsAtMs){
      const scoreA=Number(next.teamScores?.a||0);
      const scoreB=Number(next.teamScores?.b||0);
      if(scoreA===scoreB&&!next.overtimeUsed){
        next={
          ...next,
          status:"active",
          overtimeUsed:true,
          endsAtMs:now+60000,
        };
      }else{
        next={
          ...next,
          status:"finished",
          winner:scoreA===scoreB?"draw":(scoreA>scoreB?"a":"b"),
          finishedAtMs:now,
        };
      }
    }
    if(JSON.stringify(next)!==JSON.stringify(pk)){
      tx.update(roomRef,{pkState:next,updatedAt:FieldValue.serverTimestamp()});
    }
    return {ok:true,roomId,pk:next};
  });
}

function timestampMillis(value){
  if(!value)return 0;
  if(typeof value.toMillis==="function")return Number(value.toMillis()||0);
  if(value instanceof Date)return value.getTime();
  if(typeof value==="number")return value;
  return 0;
}

function roomActivityScore(room,onlineOverride=null){
  const now=Date.now();
  const online=Math.max(0,Number(
    onlineOverride??room.onlineCount??room.participantsCount??0
  ));
  const followers=Math.max(0,Number(room.followerCount||0));
  const lastChat=timestampMillis(room.lastChatAt);
  const chatAge=lastChat>0?Math.max(0,now-lastChat):Number.POSITIVE_INFINITY;
  const presenceBonus=online>0?50:0;
  const chatBonus=chatAge<24*60*60*1000
    ? Math.max(0,120-Math.floor(chatAge/(60*60*1000))*5)
    : 0;
  return Math.max(
    0,
    Math.round(
      online*100+
      Math.min(followers,5000)*2+
      presenceBonus+
      chatBonus
    ),
  );
}

function utcSupportPeriods(date=new Date()){
  const day=date.toISOString().slice(0,10);
  const month=day.slice(0,7);
  const d=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate()));
  const weekday=d.getUTCDay()||7;
  d.setUTCDate(d.getUTCDate()+4-weekday);
  const yearStart=new Date(Date.UTC(d.getUTCFullYear(),0,1));
  const week=Math.ceil((((d-yearStart)/86400000)+1)/7);
  return {
    day,
    week:d.getUTCFullYear().toString()+"-W"+week.toString().padStart(2,"0"),
    month,
  };
}

async function supporterRankingUserSnapshots(db,list,viewerUid,maxUsers){
  const ids=[];
  const seen=new Set();
  for(const item of list.slice(0,maxUsers)){
    const id=clean(item?.uid);
    if(id&&!seen.has(id)){seen.add(id);ids.push(id);}
  }
  const viewer=clean(viewerUid);
  if(viewer&&!seen.has(viewer)){seen.add(viewer);ids.push(viewer);}
  if(!ids.length)return new Map();
  const refs=ids.map(id=>db.collection("users").doc(id));
  const snaps=await db.getAll(...refs);
  const byUid=new Map();
  for(const snap of snaps){
    if(snap?.exists)byUid.set(clean(snap.id),snap.data()||{});
  }
  return byUid;
}

function filterHiddenSupporters(list,byUid,viewerUid,nowMs=Date.now()){
  const viewer=byUid.get(clean(viewerUid))||{};
  const canInspect=canInspectHiddenRankingLists(viewer);
  return list
    .filter(item=>{
      if(canInspect)return true;
      const userId=clean(item.uid);
      if(!byUid.has(userId))return false;
      return !activeHideRankingLists(byUid.get(userId)||{},nowMs);
    })
    .map((item,index)=>({...item,rank:index+1,totalSupport:item.dailySupport}));
}

async function filterSupporterRankingVisibility(db,supporters,viewerUid){
  const list=Array.isArray(supporters)?supporters.slice(0,3):[];
  if(!list.length)return list;
  try{
    const byUid=await supporterRankingUserSnapshots(db,list,viewerUid,3);
    return filterHiddenSupporters(list,byUid,viewerUid);
  }catch(_){
    // Privacy fails closed: never expose a possibly hidden supporter.
    return [];
  }
}

async function enrichSupporterPublicMetadata(db,supporters,viewerUid){
  const list=Array.isArray(supporters)?supporters.slice(0,50):[];
  if(!list.length)return list;
  try{
    const [policy,byUidData,publicProfiles]=await Promise.all([
      loadUserLevelPolicy(db),
      supporterRankingUserSnapshots(db,list,viewerUid,50),
      loadPublicProfilePresentations(
        db,
        list.map(item=>clean(item?.uid)),
        {limit:50,concurrency:8},
      ),
    ]);
    const visible=filterHiddenSupporters(list,byUidData,viewerUid);
    const byUid=new Map();
    for(const item of visible){
      const userId=clean(item.uid);
      const data=byUidData.get(userId)||{};
      const profile=
        publicProfiles.get(userId)||publicProfilePresentation(userId);
      let levels={wealthLevel:0,attractionLevel:0,gameLevel:0};
      try{
        const summary=summarizeUserLevelData(
          policy,
          userId,
          data,
          Date.now(),
        ).summary;
        levels=publicLevelMetadata({
          wealthLevel:Math.max(0,Math.min(35,Number(summary?.wealth?.level||0))),
          attractionLevel:Math.max(0,Math.min(35,Number(summary?.attraction?.level||0))),
          gameLevel:Math.max(0,Math.min(21,Number(summary?.games?.level||0))),
        },data);
      }catch(_){}
      const rawBadges=Array.isArray(data.publicBadges)
        ?data.publicBadges
        :Array.isArray(data.badges)
          ?data.badges
          :[];
      byUid.set(userId,{
        displayName:clean(profile.displayName),
        profileImageUrl:clean(profile.profileImageUrl),
        profileAvatarAsset:clean(profile.profileAvatarAsset),
        publicId:clean(profile.publicId),
        vipLevel:Math.max(
          Number(profile.effectiveVipLevel||0),
          vipEntitlementsFromUser(data,Date.now()).level,
        ),
        badges:rawBadges.map(clean).filter(Boolean).slice(0,12),
        activeProfileFrameAssetKey:clean(profile.activeProfileFrameAssetKey),
        activeProfileFrameImageUrl:clean(profile.activeProfileFrameImageUrl),
        activeProfileFrameExpiresAtMs:Math.max(
          0,
          Number(profile.activeProfileFrameExpiresAtMs||0),
        ),
        activeProfileFramePermanent:
          profile.activeProfileFramePermanent===true,
        ...levels,
      });
    }
    return visible.map(item=>({
      ...item,
      ...(byUid.get(clean(item.uid))||{
        displayName:"Shadow Live",
        profileImageUrl:"",
        profileAvatarAsset:"",
        publicId:"",
        vipLevel:0,
        badges:[],
        wealthLevel:0,
        attractionLevel:0,
        gameLevel:0,
        activeProfileFrameAssetKey:"",
        activeProfileFrameImageUrl:"",
        activeProfileFrameExpiresAtMs:0,
        activeProfileFramePermanent:false,
      }),
    }));
  }catch(_){
    // Privacy fails closed: do not leak supporter visibility on lookup errors.
    return [];
  }
}

async function roomInsights(db,uid,body={}){
  const roomId=clean(body.roomId);
  const includeRanking=body.includeRanking===true;
  const includeSupporters=body.includeSupporters===true;
  if(!/^[A-Za-z0-9_-]{1,180}$/.test(roomId))throw new ApiError("invalid_room_id",400);

  const roomRef=db.collection("rooms").doc(roomId);
  const followRef=db.collection("room_follows").doc(roomId).collection("users").doc(uid);
  const favoriteRef=db.collection("room_favorites").doc(uid).collection("items").doc(roomId);
  const periods=utcSupportPeriods();
  const dailySupportRef=roomRef.collection("support_daily").doc(periods.day);
  const weeklySupportRef=roomRef.collection("support_weekly").doc(periods.week);
  const monthlySupportRef=roomRef.collection("support_monthly").doc(periods.month);

  const [
    roomSnap,
    followSnap,
    favoriteSnap,
    dailySupportSnap,
    weeklySupportSnap,
    monthlySupportSnap,
    topSupportersSnap,
    liveRoomCount,
  ]=await Promise.all([
    roomRef.get(),
    followRef.get(),
    favoriteRef.get(),
    dailySupportRef.get(),
    weeklySupportRef.get(),
    monthlySupportRef.get(),
    dailySupportRef.collection("users").limit(includeSupporters?50:3).get(),
    realtimeRoomCount(roomId),
  ]);
  if(!roomSnap.exists)throw new ApiError("room_not_found",404);

  const room=roomSnap.data()||{};
  let supporters=topSupportersSnap.docs
    .map(doc=>{
      const data=doc.data()||{};
      return {
        uid:doc.id,
        displayName:String(data.displayName||data.username||"مستخدم Shadow Live"),
        profileImageUrl:String(data.profileImageUrl||""),
        dailySupport:Math.max(0,Number(data.supportCoins||0)),
        giftCount:Math.max(0,Number(data.giftCount||0)),
      };
    })
    .sort((a,b)=>b.dailySupport-a.dailySupport)
    .slice(0,includeSupporters?50:3)
    .map((item,index)=>({...item,rank:index+1,totalSupport:item.dailySupport}));

  if(includeSupporters){
    supporters=await enrichSupporterPublicMetadata(db,supporters,uid);
  }else{
    supporters=await filterSupporterRankingVisibility(db,supporters,uid);
  }

  let ranking=[];
  let dailyRank=Number.isFinite(Number(room.dailyRank))
    ?Math.max(1,Number(room.dailyRank))
    :null;
  if(includeRanking){
    const activeRooms=await db.collection("rooms")
      .where("isActive","==",true)
      .limit(100)
      .get();
    const visibleRooms=activeRooms.docs
      .map(doc=>({id:doc.id,...(doc.data()||{})}))
      .filter(item=>item.isHidden!==true&&clean(item.visibility)!=="hidden");
    const counts=await realtimeRoomCounts(
      visibleRooms.map(item=>item.id),
    );
    const ranked=visibleRooms
      .map((item)=>{
        const onlineCount=counts.get(item.id)??Math.max(
          0,
          Number(item.onlineCount||item.participantsCount||0),
        );
        return {
          ...item,
          onlineCount,
          activityScore:roomActivityScore(item,onlineCount),
        };
      })
      .sort((a,b)=>{
        const activityDelta=Number(b.activityScore||0)-Number(a.activityScore||0);
        if(activityDelta!==0)return activityDelta;
        return Number(b.onlineCount||0)-Number(a.onlineCount||0);
      });
    const rankIndex=ranked.findIndex(item=>item.id===roomId);
    dailyRank=rankIndex>=0?rankIndex+1:dailyRank;
    const rankedRooms=ranked.slice(0,100);
    const dailySupportByRoom=new Map();
    for(let index=0;index<rankedRooms.length;index+=10){
      const batch=rankedRooms.slice(index,index+10);
      const snapshots=await Promise.all(batch.map(item=>
        db.collection("rooms").doc(item.id)
          .collection("support_daily").doc(periods.day).get()
      ));
      for(let offset=0;offset<batch.length;offset+=1){
        dailySupportByRoom.set(
          batch[offset].id,
          Math.max(0,Number(snapshots[offset].data()?.supportCoins||0)),
        );
      }
    }
    ranking=rankedRooms.map((item,index)=>({
      roomId:item.id,
      rank:index+1,
      name:String(item.name||item.title||"غرفة صوتية"),
      publicId:String(item.publicId||""),
      activityScore:Number(item.activityScore||0),
      dailySupport:dailySupportByRoom.get(item.id)||0,
      weeklySupport:item.weeklySupportKey===periods.week?Number(item.weeklySupport||0):0,
      monthlySupport:item.monthlySupportKey===periods.month?Number(item.monthlySupport||0):0,
    }));
  }

  const dailySupport=Math.max(
    0,
    Number(dailySupportSnap.data()?.supportCoins||0),
  );
  const weeklySupport=Math.max(
    0,
    Number(weeklySupportSnap.data()?.supportCoins||0),
  );
  const monthlySupport=Math.max(
    0,
    Number(monthlySupportSnap.data()?.supportCoins||0),
  );

  return {
    ok:true,
    roomId,
    level:Math.max(1,Number(room.level||1)),
    levelPoints:Math.max(0,Number(room.levelPoints||0)),
    levelTarget:Math.max(1,Number(room.levelTarget||1000)),
    followerCount:Math.max(0,Number(room.followerCount||0)),
    followed:followSnap.exists,
    favorited:favoriteSnap.exists,
    dailySupport,
    weeklySupport,
    monthlySupport,
    supportPeriods:periods,
    activityScore:roomActivityScore(
      room,
      liveRoomCount??Math.max(0,Number(room.onlineCount||room.participantsCount||0)),
    ),
    dailyRank,
    supporters,
    ranking,
  };
}
async function roomBootstrap(db,decoded,body){
  const roomId=clean(body.roomId);
  const uid=clean(decoded?.uid||decoded?.sub);
  if(!/^[A-Za-z0-9_-]{1,180}$/.test(roomId)){
    throw new ApiError("invalid_room_id",400);
  }
  if(!uid)throw new ApiError("unauthorized",401);

  const periods=utcSupportPeriods();
  const roomRef=db.collection("rooms").doc(roomId);
  const actorRef=db.collection("users").doc(uid);
  const followRef=db.collection("room_follows").doc(roomId).collection("users").doc(uid);
  const favoriteRef=db.collection("room_favorites").doc(uid).collection("items").doc(roomId);
  const dailySupportRef=roomRef.collection("support_daily").doc(periods.day);
  const weeklySupportRef=roomRef.collection("support_weekly").doc(periods.week);
  const monthlySupportRef=roomRef.collection("support_monthly").doc(periods.month);
  const rocketRef=db.collection("room_rocket_state").doc(roomId);

  const [
    roomSnap,
    actorSnap,
    followSnap,
    favoriteSnap,
    dailySupportSnap,
    weeklySupportSnap,
    monthlySupportSnap,
    topSupportersSnap,
    rocketSnap,
    liveRoomCount,
    games,
  ]=await Promise.all([
    roomRef.get(),
    actorRef.get(),
    followRef.get(),
    favoriteRef.get(),
    dailySupportRef.get(),
    weeklySupportRef.get(),
    monthlySupportRef.get(),
    dailySupportRef.collection("users").limit(3).get(),
    rocketRef.get(),
    realtimeRoomCount(roomId),
    gameCatalog(db),
  ]);

  if(!roomSnap.exists)throw new ApiError("room_not_found",404);
  if(!actorSnap.exists)throw new ApiError("user_not_found",404);

  const room=roomSnap.data()||{};
  const actor=actorSnap.data()||{};
  assertUserDocumentSessionState(decoded,actor);
  if(room.isActive===false)throw new ApiError("room_unavailable",409);

  const ownerUid=roomOwnerUid(room);
  const hostUid=roomHostUid(room);
  const official=isOfficialRoom(room);
  const global=roomPermissions(actor);
  const actorVipEntitlements=vipEntitlementsFromUser(actor,Date.now());
  const customerServiceRoom=
    clean(room.roomType||room.type)==="customer_service";
  const customerServiceStaff=canManageRoomAction(
    room,
    actor,
    uid,
    "moderateChat",
  );
  const customerServiceMinVipLevel=customerServiceRoom
    ? Math.max(1,Math.min(10,Number(room.customerServiceMinVipLevel||1)))
    : 0;
  if(
    customerServiceRoom&&
    !customerServiceStaff&&
    actorVipEntitlements.level<customerServiceMinVipLevel
  ){
    throw new ApiError(
      customerServiceMinVipLevel>=4
        ?"vip4_customer_service_required"
        :"vip1_customer_service_required",
      403,
    );
  }
  const myModerator=roomModeratorEntry(room,uid);
  const hostCapabilities=official&&hostUid===uid
    ? OFFICIAL_HOST_CAPABILITIES
    : [];
  const agencyCapabilities=agencyRoomManagementCapabilities(room,actor,uid);
  const actualOwner=!official&&ownerUid===uid;
  const myCapabilities=(actualOwner||global.manageRooms)
    ? ROOM_MODERATOR_CAPABILITIES
    : [...new Set([
        ...hostCapabilities,
        ...agencyCapabilities,
        ...(myModerator?.capabilities||[]),
      ])];
  const onlineCount=liveRoomCount??Math.max(
    0,
    Number(room.onlineCount||room.participantsCount||0),
  );
  const battle=activeStarBattle(room);
  const seats=normalizeSeats(room).map((seat)=>{
    const scoreRaw=battle?.scores?.[seat.uid];
    const score=scoreRaw&&typeof scoreRaw==="object"?scoreRaw:{};
    return {
      ...seat,
      starBattleCoins:battle?Math.max(0,Number(score.coins||0)):0,
    };
  });

  const supporters=topSupportersSnap.docs
    .map(doc=>{
      const data=doc.data()||{};
      return {
        uid:doc.id,
        displayName:clean(data.displayName||data.username||"مستخدم Shadow Live"),
        profileImageUrl:clean(data.profileImageUrl),
        dailySupport:Math.max(0,Number(data.supportCoins||0)),
        giftCount:Math.max(0,Number(data.giftCount||0)),
      };
    })
    .sort((a,b)=>b.dailySupport-a.dailySupport)
    .slice(0,3)
    .map((item,index)=>({...item,rank:index+1,totalSupport:item.dailySupport}));

  const dailySupport=Math.max(
    0,
    Number(dailySupportSnap.data()?.supportCoins||0),
  );
  const weeklySupport=Math.max(
    0,
    Number(weeklySupportSnap.data()?.supportCoins||0),
  );
  const monthlySupport=Math.max(
    0,
    Number(monthlySupportSnap.data()?.supportCoins||0),
  );

  const profileUid=clean(ownerUid||hostUid);
  let ownerProfile={
    displayName:clean(room.ownerName||room.hostName),
    profileImageUrl:clean(room.ownerProfileImageUrl||room.hostProfileImageUrl),
    location:clean(room.ownerLocation),
  };
  if(profileUid){
    if(profileUid===uid){
      ownerProfile={
        displayName:clean(actor.displayName||actor.username||ownerProfile.displayName),
        profileImageUrl:clean(actor.profileImageUrl||actor.photoUrl||ownerProfile.profileImageUrl),
        location:clean(actor.location||ownerProfile.location),
      };
    }else{
      try{
        const ownerSnap=await db.collection("public_profiles").doc(profileUid).get();
        if(ownerSnap.exists){
          const profile=ownerSnap.data()||{};
          ownerProfile={
            displayName:clean(profile.displayName||profile.username||ownerProfile.displayName),
            profileImageUrl:clean(profile.profileImageUrl||profile.photoUrl||ownerProfile.profileImageUrl),
            location:clean(profile.location||ownerProfile.location),
          };
        }
      }catch(_){
        // Owner identity fallback from room metadata is enough for bootstrap.
      }
    }
  }

  const roomData={
    ...roomResponse(roomId,room),
    selfVipLevel:actorVipEntitlements.level,
    canUseVipEmoji:actorVipEntitlements.exclusiveEmoji,
    vipCustomerService:actorVipEntitlements.vipCustomerService,
    exclusiveCustomerService:actorVipEntitlements.exclusiveCustomerService,
    levelGuarantee:actorVipEntitlements.levelGuarantee,
    viewerAgencyId:clean(actor.agencyId),
    viewerAgencyRole:clean(actor.agencyRole),
    onlineCount,
    participantsCount:onlineCount,
    activeRoomBackgroundRewardId:clean(room.activeRoomBackgroundRewardId),
    activeRoomBackgroundImageUrl:clean(room.activeRoomBackgroundImageUrl),
    activeRoomBackgroundAssetKey:clean(room.activeRoomBackgroundAssetKey),
    activeRoomBackgroundExpiresAtMs:Number(room.activeRoomBackgroundExpiresAtMs||0),
  };

  return {
    ok:true,
    roomId,
    serverNowMs:Date.now(),
    room:roomData,
    ownerProfile,
    seatState:{
      roomId,
      seats,
      micInvites:Array.isArray(room.micInvites)?room.micInvites:[],
      micRequests:Array.isArray(room.micRequests)?room.micRequests:[],
      micInviteOnly:room.micInviteOnly===true,
      starBattleActive:Boolean(battle),
      isOwner:!official&&ownerUid===uid,
      isHost:official&&hostUid===uid,
      canManageMic:canManageRoomAction(room,actor,uid,"manageMic"),
      isActive:true,
      onlineCount,
    },
    moderatorState:{
      roomId,
      ownerUid,
      hostUid,
      isOwner:actualOwner,
      isHost:official&&hostUid===uid,
      platformOwner:global.appOwner,
      ownerAbsoluteRoomAccess:global.ownerAbsoluteRoomAccess,
      globalRoomManage:global.manageRooms,
      canManage:actualOwner
        ||global.manageRooms
        ||hostCapabilities.length>0
        ||agencyCapabilities.length>0,
      limit:roomModeratorLimit(room),
      capabilities:ROOM_MODERATOR_CAPABILITIES,
      myCapabilities,
      moderators:normalizeRoomModerators(room),
    },
    insights:{
      roomId,
      level:Math.max(1,Number(room.level||1)),
      levelPoints:Math.max(0,Number(room.levelPoints||0)),
      levelTarget:Math.max(1,Number(room.levelTarget||1000)),
      followerCount:Math.max(0,Number(room.followerCount||0)),
      followed:followSnap.exists,
      favorited:favoriteSnap.exists,
      dailySupport,
      weeklySupport,
      monthlySupport,
      supportPeriods:periods,
      activityScore:roomActivityScore(room,onlineCount),
      dailyRank:Number.isFinite(Number(room.dailyRank))
        ?Math.max(1,Number(room.dailyRank))
        :null,
      supporters,
      ranking:[],
    },
    rocketState:rocketSnap.exists
      ? rocketSnap.data()||{}
      : {
          currentLevel:1,
          progressCoins:0,
          levelThresholdCoins:100000,
          levelContributors:{},
        },
    games,
  };
}

async function setRoomFollow(db,uid,roomId,following){
  if(!/^[A-Za-z0-9_-]{1,180}$/.test(roomId))throw new ApiError("invalid_room_id",400);
  const roomRef=db.collection("rooms").doc(roomId);
  const followRef=db.collection("room_follows").doc(roomId).collection("users").doc(uid);

  return db.runTransaction(async tx=>{
    const [roomSnap,followSnap]=await Promise.all([
      tx.get(roomRef),
      tx.get(followRef),
    ]);
    if(!roomSnap.exists)throw new ApiError("room_not_found",404);
    const room=roomSnap.data()||{};
    if(room.isActive===false)throw new ApiError("room_unavailable",409);

    let count=Math.max(0,Number(room.followerCount||0));
    if(following&&!followSnap.exists){
      tx.create(followRef,{
        uid,
        createdAt:FieldValue.serverTimestamp(),
      });
      count+=1;
      tx.update(roomRef,{
        followerCount:count,
        updatedAt:FieldValue.serverTimestamp(),
      });
    }else if(!following&&followSnap.exists){
      tx.delete(followRef);
      count=Math.max(0,count-1);
      tx.update(roomRef,{
        followerCount:count,
        updatedAt:FieldValue.serverTimestamp(),
      });
    }
    return {ok:true,roomId,following,followerCount:count};
  });
}

export default async function handler(req,res){
  if(cors(req,res))return;
  const cfg=config();

  if(req.method==="GET"){
    return out(res,200,{
      ok:true,
      service:"shadow-voice-session",
      provider:"zego",
      configured:Boolean(cfg.appId&&cfg.secretValid),
      appIdConfigured:Boolean(cfg.appId),
      serverSecretConfigured:cfg.secretValid,
    });
  }
  if(req.method!=="POST")return out(res,405,{ok:false,code:"method_not_allowed"});

  try{
    initFirebase();
    const action=clean(req.body?.action)||"token";
    const authorization=clean(req.headers.authorization);
    if(!authorization.startsWith("Bearer "))throw new ApiError("unauthorized",401);
    const lightweightPresenceAction=
      action==="roomPresenceHeartbeat"||
      action==="roomPresenceLeave"||
      action==="roomPresenceState"||
      action==="roomSessionLeave"||
      action==="roomBootstrap";
    const decoded=await getAuth().verifyIdToken(
      authorization.slice(7),
      {checkUserState:!lightweightPresenceAction},
    );
    if(decoded.firebase?.sign_in_provider==="anonymous")throw new ApiError("account_required",403);
    if(action==="personalRoom"){
      const room=await openPersonalRoom(getFirestore(),decoded.uid);
      return out(res,200,{ok:true,room});
    }
    if(action==="agencyRoom"){
      const room=await openPersonalRoom(
        getFirestore(),
        decoded.uid,
        {forceAgency:true},
      );
      return out(res,200,{ok:true,room});
    }
    if(action==="setRoomChatEnabled"){
      return out(res,200,await setRoomChatEnabled(getFirestore(),decoded.uid,req.body||{}));
    }
    if(action==="closePersonalRoom"){
      const roomId=clean(req.body?.roomId);
      const result=await closePersonalRoom(getFirestore(),decoded.uid,roomId);
      return out(res,200,result);
    }
    if(action==="updateRoomSettings"){
      return out(res,200,await updateRoomSettings(getFirestore(),decoded.uid,req.body||{}));
    }
    if(action==="changeRoomPublicId"){
      return out(res,200,await changeRoomPublicId(getFirestore(),decoded.uid,req.body||{}));
    }
    if(action==="roomBootstrap"){
      return out(res,200,await roomBootstrap(getFirestore(),decoded,req.body||{}));
    }
    if(action==="roomInsights"){
      return out(res,200,await roomInsights(getFirestore(),decoded.uid,req.body||{}));
    }
    if(action==="setRoomFollow"){
      const roomId=clean(req.body?.roomId);
      const following=req.body?.following===true;
      return out(res,200,await setRoomFollow(getFirestore(),decoded.uid,roomId,following));
    }
    if(action==="recordRoomVisit"){
      const roomId=clean(req.body?.roomId);
      return out(res,200,await recordRoomVisit(getFirestore(),decoded.uid,roomId));
    }
    if(action==="setRoomFavorite"){
      const roomId=clean(req.body?.roomId);
      const favorite=req.body?.favorite===true;
      return out(res,200,await setRoomFavorite(getFirestore(),decoded.uid,roomId,favorite));
    }
    if(action==="roomLibrary"){
      return out(res,200,await roomLibrary(getFirestore(),decoded.uid));
    }
    if(action==="sendRoomChat"){
      return out(res,200,await sendRoomChat(getFirestore(),decoded.uid,req.body||{}));
    }
    if(action==="kickRoomUser"){
      return out(res,200,await kickRoomUser(getFirestore(),decoded.uid,req.body||{}));
    }
    if(action==="unbanRoomUser"){
      return out(res,200,await unbanRoomUser(getFirestore(),decoded.uid,req.body||{}));
    }
    if(action==="roomBanList"){
      const roomId=clean(req.body?.roomId);
      return out(res,200,await roomBanList(getFirestore(),decoded.uid,roomId));
    }
    if(action==="roomMusicState"){
      const roomId=clean(req.body?.roomId);
      return out(res,200,await roomMusicState(getFirestore(),decoded.uid,roomId));
    }
    if(action==="setRoomMusicPolicy"){
      return out(res,200,await setRoomMusicPolicy(getFirestore(),decoded.uid,req.body||{}));
    }
    if(action==="addRoomMusicTrack"){
      return out(res,200,await addRoomMusicTrack(getFirestore(),decoded.uid,req.body||{}));
    }
    if(action==="removeRoomMusicTrack"){
      return out(res,200,await removeRoomMusicTrack(getFirestore(),decoded.uid,req.body||{}));
    }
    if(action==="clearRoomMusicQueue"){
      return out(res,200,await clearRoomMusicQueue(getFirestore(),decoded.uid,req.body||{}));
    }
    if(action==="roomMusicCommand"){
      return out(res,200,await roomMusicCommand(getFirestore(),decoded.uid,req.body||{}));
    }
    if(action==="roomGhostState"){
      return out(res,200,await roomGhostState(getFirestore(),decoded.uid));
    }
    if(action==="setRoomGhostMode"){
      return out(res,200,await setRoomGhostMode(getFirestore(),decoded.uid,req.body||{}));
    }
    if(action==="roomHiddenEntryState"){
      return out(res,200,await roomHiddenEntryState(getFirestore(),decoded.uid));
    }
    if(action==="setRoomHiddenEntry"){
      return out(res,200,await setRoomHiddenEntry(getFirestore(),decoded.uid,req.body||{}));
    }
    if(action==="roomPresenceAnnounceJoin"){
      const roomId=clean(req.body?.roomId);
      return out(res,200,await roomPresenceAnnounceJoin(getFirestore(),decoded.uid,roomId));
    }
    if(action==="roomSessionLeave"){
      const roomId=clean(req.body?.roomId);
      return out(res,200,await roomSessionLeave(getFirestore(),decoded.uid,roomId));
    }
    if(action==="roomPresenceJoin"){
      const roomId=clean(req.body?.roomId);
      return out(res,200,await roomPresenceJoin(getFirestore(),decoded.uid,roomId));
    }
    if(action==="roomPresenceHeartbeat"){
      const roomId=clean(req.body?.roomId);
      return out(res,200,await roomPresenceHeartbeat(getFirestore(),decoded.uid,roomId));
    }
    if(action==="roomPresenceLeave"){
      const roomId=clean(req.body?.roomId);
      return out(res,200,await roomPresenceLeave(getFirestore(),decoded.uid,roomId));
    }
    if(action==="roomPresenceState"){
      const roomId=clean(req.body?.roomId);
      return out(res,200,await roomPresenceState(getFirestore(),decoded.uid,roomId));
    }
    if(action==="pkState"){
      const roomId=clean(req.body?.roomId);
      return out(res,200,await pkState(getFirestore(),roomId));
    }
    if(action==="createStarBattle"){
      return out(res,200,await createStarBattle(getFirestore(),decoded.uid,req.body||{}));
    }
    if(action==="finishStarBattle"){
      return out(res,200,await finishStarBattle(getFirestore(),decoded.uid,req.body||{}));
    }
    if(action==="syncStarBattle"){
      return out(res,200,await syncStarBattle(getFirestore(),decoded.uid,req.body||{}));
    }
    if(action==="starBattleHistory"){
      const roomId=clean(req.body?.roomId);
      return out(res,200,await starBattleHistory(getFirestore(),roomId));
    }
    if(action==="createPk"){
      return out(res,200,await createPk(getFirestore(),decoded.uid,req.body||{}));
    }
    if(action==="acceptPk"){
      return out(res,200,await respondPk(getFirestore(),decoded.uid,req.body||{},true));
    }
    if(action==="declinePk"){
      return out(res,200,await respondPk(getFirestore(),decoded.uid,req.body||{},false));
    }
    if(action==="cancelPk"){
      return out(res,200,await cancelPk(getFirestore(),decoded.uid,req.body||{}));
    }
    if(action==="syncPk"){
      return out(res,200,await syncPk(getFirestore(),decoded.uid,req.body||{}));
    }
    if(action==="roomModeratorState"){
      const roomId=clean(req.body?.roomId);
      return out(res,200,await roomModeratorState(getFirestore(),decoded.uid,roomId));
    }
    if(action==="setRoomModerator"){
      return out(res,200,await setRoomModerator(getFirestore(),decoded.uid,req.body||{}));
    }
    if(action==="announceEntrance"){
      const roomId=clean(req.body?.roomId);
      return out(
        res,
        200,
        await announceRoomEntrance(getFirestore(),decoded.uid,roomId),
      );
    }
    if(action==="roomSeatState"){
      const roomId=clean(req.body?.roomId);
      return out(res,200,await roomSeatState(getFirestore(),decoded.uid,roomId));
    }
    if(action==="roomSeatAction"){
      return out(res,200,await roomSeatAction(getFirestore(),decoded.uid,req.body||{}));
    }
    if(action==="controlRoomPolicy"){
      return out(res,200,await controlRoomPolicy(getFirestore(),decoded.uid,req.body||{}));
    }
    if(action!=="token")throw new ApiError("invalid_action",400);

    if(!cfg.appId||!cfg.secretValid)throw new ApiError("zego_not_configured",503);
    const roomId=clean(req.body?.roomId);
    if(!/^[A-Za-z0-9_-]{1,180}$/.test(roomId))throw new ApiError("invalid_room_id",400);

    const db=getFirestore();
    const roomSnap=await db.collection("rooms").doc(roomId).get();
    if(!roomSnap.exists||roomSnap.data()?.isActive===false)throw new ApiError("room_unavailable",404);
    const roomData=roomSnap.data()||{};
    const roomOwnerUid=clean(roomData.ownerUid||roomData.ownerId||roomData.hostId);
    if(roomOwnerUid!==decoded.uid){
      const banSnap=await db
        .collection("room_bans")
        .doc(roomId)
        .collection("users")
        .doc(decoded.uid)
        .get();
      const ban=banSnap.data()||{};
      const banExpiry=ban.expiresAt?.toMillis?.()||0;
      const activeBan=banSnap.exists&&(ban.permanent===true||banExpiry>Date.now());
      if(activeBan)throw new ApiError("room_banned",403);
    }
    if(clean(roomData.visibility)==="password"&&roomOwnerUid!==decoded.uid){
      const inviteSnap=await db
        .collection("room_invites")
        .doc(roomId)
        .collection("users")
        .doc(decoded.uid)
        .get();
      const inviteExpiry=inviteSnap.data()?.expiresAt?.toMillis?.()||0;
      const inviteValid=inviteSnap.exists&&inviteExpiry>Date.now();
      if(!inviteValid){
        const suppliedPassword=String(req.body?.roomPassword??"");
        if(!suppliedPassword)throw new ApiError("room_password_required",403);
        if(!verifyRoomPassword(roomData,suppliedPassword))throw new ApiError("room_password_invalid",403);
      }
    }

    const effectiveSeconds=1800;
    const userId=zegoUserId(decoded.uid);
    const generated=generateToken04(cfg.appId,userId,cfg.secret,effectiveSeconds);
    return out(res,200,{
      ok:true,
      provider:"zego",
      appId:cfg.appId,
      token:generated.token,
      userId,
      roomId,
      expiresAt:generated.expiresAt,
    });
  }catch(e){
    if(e instanceof ApiError)return out(res,e.status,{ok:false,code:e.code});
    const authCode=String(e?.code||e?.message||"");
    if(authCode.includes("auth/id-token"))return out(res,401,{ok:false,code:"unauthorized"});
    if(authCode==="firestore_quota_exhausted"){
      const retryAfterSeconds=Math.max(1,Math.min(60,Number(e?.retryAfterSeconds||10)));
      res.setHeader?.("Retry-After",String(retryAfterSeconds));
      return out(res,503,{ok:false,code:authCode,retryAfterSeconds});
    }
    if(authCode==="auth_state_lookup_failed"){
      return out(res,503,{ok:false,code:authCode});
    }
    return out(res,500,{ok:false,code:"server_failed"});
  }
}

export {
  kickRoomUser,
  roomGhostState,
  setRoomGhostMode,
  roomHiddenEntryState,
  setRoomHiddenEntry,
  roomInsights,
  roomPresenceState,
};
