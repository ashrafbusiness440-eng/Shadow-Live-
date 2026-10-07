import { getApps, initializeApp, cert, getAuth, FieldValue, getFirestore, legacyEnv } from "../legacy-firebase-admin-shim.js";
import { loadUserLevelPolicy, levelFromPoints } from "../user-level-policy.js";

const ALLOWED_TYPES = new Set([
  "frame",
  "entrance",
  "voice_wave",
  "room_background",
  "wealth_badge",
  "upgrade_announcement",
  "chat_bubble",
  "support_bar",
  "gift_privilege",
  "entry_bar",
  "vehicle",
]);

const WEALTH_REWARD_SCHEMA_VERSION = 1;
const PERMANENT_EXPIRES_AT_MS = 253402300799000;

const WEALTH_BASE_PRIVILEGES = Object.freeze([
  Object.freeze({ type: "wealth_badge", suffix: "wealthBadge", nameAr: "شعار الثروة" }),
  Object.freeze({ type: "upgrade_announcement", suffix: "upgradeAnnouncement", nameAr: "إعلان الترقية" }),
  Object.freeze({ type: "entrance", suffix: "entryEffect", nameAr: "مؤثر الدخول" }),
  Object.freeze({ type: "chat_bubble", suffix: "chatBubble", nameAr: "فقاعة الدردشة" }),
  Object.freeze({ type: "frame", suffix: "profileFrame", nameAr: "إطار الصورة الشخصية" }),
]);

function wealthBucket(index) {
  const safeIndex = Math.max(0, Math.min(6, Number(index) || 0));
  const start = safeIndex * 5 + 1;
  const end = start + 4;
  return {
    start,
    end,
    key: `lv${String(start).padStart(2, "0")}_${String(end).padStart(2, "0")}`,
  };
}

function wealthPrivilegesForBucket(index) {
  const bucket = wealthBucket(index);
  const privileges = [...WEALTH_BASE_PRIVILEGES];
  if (bucket.start >= 6) {
    privileges.push({ type: "support_bar", suffix: "supportBar", nameAr: "شريط الدعم" });
  }
  if (bucket.start >= 11) {
    privileges.push({ type: "gift_privilege", suffix: "giftPrivilege", nameAr: "تأثير إرسال هدية الامتياز" });
  }
  if (bucket.start >= 16) {
    privileges.push({ type: "entry_bar", suffix: "entryBar", nameAr: "شريط الدخول" });
  }
  if (bucket.start >= 21) {
    privileges.push({ type: "vehicle", suffix: "vehicle", nameAr: "المركبة" });
  }
  return privileges.map((item) => ({
    rewardId: `level_wealth_${bucket.key}_${item.suffix}`,
    type: item.type,
    nameAr: `${item.nameAr} LV${bucket.start}–${bucket.end}`,
    assetKey: `levels.wealth.${bucket.key}.${item.suffix}`,
    expiresAtMs: PERMANENT_EXPIRES_AT_MS,
    permanent: true,
    source: "level_wealth",
    sourceLevelBucket: bucket.key,
  }));
}

function wealthBucketIndexForLevel(level) {
  const normalized = Number(level);
  if (!Number.isInteger(normalized) || normalized <= 0) return -1;
  return Math.min(6, Math.floor((normalized - 1) / 5));
}

async function syncWealthLevelRewards(db, uid, rootRef, root, user, policy) {
  const wealthLevel = levelFromPoints(policy?.wealth || {}, user?.wealthPoints ?? 0);
  const currentBucketIndex = wealthBucketIndexForLevel(wealthLevel);
  if (currentBucketIndex < 0) return false;

  const rootData = root.exists ? (root.data() || {}) : {};
  const storedSchemaVersion = Number(rootData.wealthRewardSchemaVersion || 0);
  const storedBucketIndex = Number.isInteger(Number(rootData.wealthRewardSyncedBucketIndex))
    ? Number(rootData.wealthRewardSyncedBucketIndex)
    : -1;

  const schemaChanged = storedSchemaVersion !== WEALTH_REWARD_SCHEMA_VERSION;
  const firstBucket = schemaChanged ? 0 : storedBucketIndex + 1;
  if (firstBucket > currentBucketIndex) return false;

  const batch = db.batch();
  for (let index = firstBucket; index <= currentBucketIndex; index += 1) {
    for (const reward of wealthPrivilegesForBucket(index)) {
      const itemRef = rootRef.collection("items").doc(
        rewardDocId(reward.type, reward.rewardId),
      );
      batch.set(itemRef, {
        ...reward,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
  }

  batch.set(rootRef, {
    wealthRewardSchemaVersion: WEALTH_REWARD_SCHEMA_VERSION,
    wealthRewardSyncedBucketIndex: currentBucketIndex,
    wealthRewardSyncedLevel: wealthLevel,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  await batch.commit();
  return true;
}

function clean(value){return String(value??"").trim();}
function safeType(value){
  const type=clean(value);
  if(!ALLOWED_TYPES.has(type)) throw Error("invalid_reward_type");
  return type;
}
function validId(value){
  return /^[A-Za-z0-9_.-]{1,120}$/.test(clean(value));
}
function rewardDocId(type,id){
  return (type+"__"+id).replace(/[^A-Za-z0-9_.-]/g,"_").slice(0,220);
}
function defaultAssetKey(type,id){
  const safeId=clean(id).replace(/[^A-Za-z0-9_.-]/g,"_");
  if(!safeId)return "";
  return "cosmetics."+clean(type)+"."+safeId;
}
function parseServiceAccount(raw){
  const text=clean(raw); if(!text) throw Error("server_not_configured");
  let sa=JSON.parse(text); if(typeof sa==="string") sa=JSON.parse(sa);
  const projectId=sa.project_id||sa.projectId;
  const clientEmail=sa.client_email||sa.clientEmail;
  const privateKey=String(sa.private_key||sa.privateKey||"").replace(/\\n/g,"\n");
  if(!projectId||!clientEmail||!privateKey) throw Error("invalid_service_account_json");
  return {projectId,clientEmail,privateKey};
}
function initFirebase(){
  if(!getApps().length){
    const sa=parseServiceAccount(legacyEnv.FIREBASE_SERVICE_ACCOUNT);
    initializeApp({credential:cert(sa),projectId:sa.projectId});
  }
}
function cors(req,res){
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Headers","authorization, content-type");
  res.setHeader("Access-Control-Allow-Methods","POST,OPTIONS");
  if(req.method==="OPTIONS"){res.status(204).end();return true;}
  return false;
}
const out=(res,status,body)=>res.status(status).json(body);

async function actor(req){
  const authorization=clean(req.headers.authorization);
  if(!authorization.startsWith("Bearer ")) throw Error("unauthorized");
  const decoded=await getAuth().verifyIdToken(authorization.slice(7));
  return {uid:decoded.uid,db:getFirestore()};
}

function serializeReward(doc,nowMs){
  const data=doc.data()||{};
  const expiresAtMs=Math.max(0,Number(data.expiresAtMs||0));
  const permanent=data.permanent===true;
  return {
    docId:doc.id,
    rewardId:clean(data.rewardId),
    type:clean(data.type),
    nameAr:clean(data.nameAr),
    assetKey:clean(data.assetKey)||defaultAssetKey(data.type,data.rewardId),
    imageUrl:clean(data.imageUrl),
    expiresAtMs,
    permanent,
    active:data.active===true && (permanent || expiresAtMs>nowMs),
    expired:!permanent && expiresAtMs>0 && expiresAtMs<=nowMs,
    source:clean(data.source),
    sourceExplosionId:clean(data.sourceExplosionId),
  };
}

export async function listInventory(db,uid,nowMs=Date.now()){
  const rootRef=db.collection("user_rewards").doc(uid);
  const [root,userSnap,policy]=await Promise.all([
    rootRef.get(),
    db.collection("users").doc(uid).get(),
    loadUserLevelPolicy(db),
  ]);
  if(userSnap.exists){
    await syncWealthLevelRewards(
      db,
      uid,
      rootRef,
      root,
      userSnap.data()||{},
      policy,
    );
  }
  const snapshot=await rootRef.collection("items").limit(200).get();
  const items=snapshot.docs.map((doc)=>serializeReward(doc,nowMs))
    .filter((item)=>ALLOWED_TYPES.has(item.type))
    .sort((a,b)=>{
      if(a.expired!==b.expired) return a.expired?1:-1;
      if(a.active!==b.active) return a.active?-1:1;
      return b.expiresAtMs-a.expiresAtMs;
    });
  return {
    items,
    activeByType:root.exists&&root.data()?.activeByType
      ? root.data().activeByType
      : {},
  };
}

function roomUsesOwnerInventory(room={}){
  const type=clean(room.roomType||room.type||"personal");
  return room.systemOwned!==true&&
    room.officialRoom!==true&&
    !["official","administrative","customer_service"].includes(type);
}

async function ownedRoomRefs(db,uid){
  const refs=new Map();
  for(const field of ["ownerUid","ownerId","hostId"]){
    const snapshot=await db.collection("rooms").where(field,"==",uid).get();
    for(const doc of snapshot.docs){
      if(!roomUsesOwnerInventory(doc.data()||{}))continue;
      refs.set(doc.ref.path,doc.ref);
    }
  }
  return [...refs.values()];
}

async function updatePublicProfileFrame(db,uid,item,active){
  const refs=[
    db.collection("users").doc(uid),
    db.collection("public_profiles").doc(uid),
  ];
  const batch=db.batch();
  for(const ref of refs){
    if(active){
      batch.set(ref,{
        activeProfileFrameRewardId:clean(item.rewardId),
        activeProfileFrameAssetKey:clean(item.assetKey),
        activeProfileFrameImageUrl:clean(item.imageUrl),
        activeProfileFrameExpiresAtMs:Number(item.expiresAtMs||0),
        activeProfileFramePermanent:item.permanent===true,
        profileFrameUpdatedAt:FieldValue.serverTimestamp(),
      },{merge:true});
    }else{
      batch.set(ref,{
        activeProfileFrameRewardId:FieldValue.delete(),
        activeProfileFrameAssetKey:FieldValue.delete(),
        activeProfileFrameImageUrl:FieldValue.delete(),
        activeProfileFrameExpiresAtMs:FieldValue.delete(),
        activeProfileFramePermanent:FieldValue.delete(),
        profileFrameUpdatedAt:FieldValue.serverTimestamp(),
      },{merge:true});
    }
  }
  await batch.commit();
}

async function updateOwnedRoomBackground(db,uid,item,active){
  const refs=await ownedRoomRefs(db,uid);
  if(refs.length===0) return 0;
  const batch=db.batch();
  for(const ref of refs){
    if(active){
      batch.set(ref,{
        activeRoomBackgroundRewardId:item.rewardId,
        activeRoomBackgroundImageUrl:clean(item.imageUrl),
        activeRoomBackgroundAssetKey:clean(item.assetKey),
        activeRoomBackgroundExpiresAtMs:Number(item.expiresAtMs||0),
        roomBackgroundUpdatedAt:FieldValue.serverTimestamp(),
      },{merge:true});
    }else{
      batch.update(ref,{
        activeRoomBackgroundRewardId:FieldValue.delete(),
        activeRoomBackgroundImageUrl:FieldValue.delete(),
        activeRoomBackgroundAssetKey:FieldValue.delete(),
        activeRoomBackgroundExpiresAtMs:FieldValue.delete(),
        roomBackgroundUpdatedAt:FieldValue.serverTimestamp(),
      });
    }
  }
  await batch.commit();
  return refs.length;
}

export async function setActiveReward(db,uid,{type,rewardId,active}){
  const rewardType=safeType(type);
  const id=clean(rewardId);
  if(!validId(id)) throw Error("invalid_reward_id");
  const rootRef=db.collection("user_rewards").doc(uid);
  const itemRef=rootRef.collection("items").doc(rewardDocId(rewardType,id));
  const nowMs=Date.now();

  const result=await db.runTransaction(async tx=>{
    const [rootSnap,itemSnap]=await Promise.all([
      tx.get(rootRef),
      tx.get(itemRef),
    ]);
    if(!itemSnap.exists) throw Error("reward_not_owned");
    const item=itemSnap.data()||{};
    if(clean(item.type)!==rewardType||clean(item.rewardId)!==id){
      throw Error("reward_not_owned");
    }
    if(item.permanent!==true&&Number(item.expiresAtMs||0)<=nowMs) throw Error("reward_expired");

    const activeByType=rootSnap.exists&&rootSnap.data()?.activeByType
      ? {...rootSnap.data().activeByType}
      : {};
    const previousId=clean(activeByType[rewardType]);
    const shouldActivate=active!==false;

    if(shouldActivate&&previousId&&previousId!==id){
      const previousRef=rootRef.collection("items")
        .doc(rewardDocId(rewardType,previousId));
      tx.set(previousRef,{active:false,updatedAt:FieldValue.serverTimestamp()},{merge:true});
    }

    tx.set(itemRef,{
      active:shouldActivate,
      updatedAt:FieldValue.serverTimestamp(),
    },{merge:true});

    activeByType[rewardType]=shouldActivate?id:"";
    tx.set(rootRef,{
      activeByType,
      updatedAt:FieldValue.serverTimestamp(),
    },{merge:true});

    return {
      rewardId:id,
      type:rewardType,
      active:shouldActivate,
      imageUrl:clean(item.imageUrl),
      assetKey:clean(item.assetKey)||defaultAssetKey(rewardType,id),
      expiresAtMs:Number(item.expiresAtMs||0),
      permanent:item.permanent===true,
    };
  });

  if(result.type==="room_background"){
    await updateOwnedRoomBackground(db,uid,result,result.active);
  }
  if(result.type==="frame"){
    await updatePublicProfileFrame(db,uid,result,result.active);
  }

  return result;
}

export async function handler(req,res){
  if(cors(req,res)) return;
  if(req.method!=="POST") return out(res,405,{ok:false,code:"method_not_allowed"});
  try{
    initFirebase();
    const {uid,db}=await actor(req);
    const action=clean(req.body?.action);
    if(action==="list"){
      const data=await listInventory(db,uid);
      return out(res,200,{ok:true,...data});
    }
    if(action==="setActive"){
      const item=await setActiveReward(db,uid,{
        type:req.body?.type,
        rewardId:req.body?.rewardId,
        active:req.body?.active,
      });
      return out(res,200,{ok:true,item});
    }
    return out(res,400,{ok:false,code:"invalid_action"});
  }catch(error){
    const code=clean(error?.message)||"server_error";
    const bad=new Set([
      "invalid_action","invalid_reward_type","invalid_reward_id",
      "reward_not_owned","reward_expired",
    ]);
    const status=code==="unauthorized"?401:bad.has(code)?400:500;
    return out(res,status,{ok:false,code:status===500?"reward_inventory_failed":code});
  }
}
