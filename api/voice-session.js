import {createCipheriv,randomBytes,randomInt,createHash,scryptSync,timingSafeEqual} from "crypto";
import {getApps,initializeApp,cert} from "firebase-admin/app";
import {getAuth} from "firebase-admin/auth";
import {getFirestore,FieldValue} from "firebase-admin/firestore";

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
    const sa=parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT);
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
  const appId=Number(clean(process.env.ZEGO_APP_ID));
  const secret=clean(process.env.ZEGO_SERVER_SECRET);
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
  return {
    appOwner:role==="owner",
    manageRooms:role==="owner"||(data.adminEnabled===true&&capabilities.includes("manage_rooms")),
    hidden:role==="owner"||(data.adminEnabled===true&&capabilities.includes("canCreateHiddenRoom")),
  };
}

function roomResponse(roomId,data){
  return {
    roomId,
    name:clean(data.name||data.title||"غرفتي"),
    publicId:clean(data.publicId),
    ownerUid:clean(data.ownerUid||data.hostId),
    roomType:clean(data.roomType||"personal"),
    category:clean(data.category||"دردشة"),
    description:clean(data.description),
    tags:Array.isArray(data.tags)?data.tags.map(clean).filter(Boolean).slice(0,8):[],
    visibility:clean(data.visibility||"public"),
    isHidden:data.isHidden===true||clean(data.visibility)==="hidden",
    passwordProtected:clean(data.visibility)==="password",
    coverImageUrl:clean(data.coverImageUrl||data.imageUrl),
    onlineCount:Math.max(0,Number(data.onlineCount||data.participantsCount||0)),
    level:Math.max(1,Number(data.level||1)),
    isActive:data.isActive!==false,
  };
}

async function openPersonalRoom(db,uid){
  const roomId="personal_"+uid;
  const roomRef=db.collection("rooms").doc(roomId);
  const userRef=db.collection("users").doc(uid);

  const existing=await roomRef.get();
  if(existing.exists){
    const data=existing.data()||{};
    if(clean(data.ownerUid||data.hostId)!==uid)throw new ApiError("room_owner_mismatch",409);
    await Promise.all([
      roomRef.set({
        isActive:true,
        closedAt:FieldValue.delete(),
        updatedAt:FieldValue.serverTimestamp(),
      },{merge:true}),
      userRef.set({personalRoomId:roomId},{merge:true}),
    ]);
    return roomResponse(roomId,{...data,isActive:true});
  }

  const userSnap=await userRef.get();
  if(!userSnap.exists)throw new ApiError("user_not_found",404);
  const user=userSnap.data()||{};
  const displayName=clean(user.displayName||user.username||"مستخدم Shadow Live");

  for(let attempt=0;attempt<40;attempt++){
    const publicId=String(randomInt(100000,1000000));
    try{
      const result=await db.runTransaction(async tx=>{
        const publicRef=db.collection("room_ids").doc(publicId);
        const userPublicRef=db.collection("public_ids").doc(publicId);
        const [roomNow,roomIdCollision,userIdCollision]=await Promise.all([
          tx.get(roomRef),tx.get(publicRef),tx.get(userPublicRef),
        ]);

        if(roomNow.exists){
          const data=roomNow.data()||{};
          if(clean(data.ownerUid||data.hostId)!==uid)throw new ApiError("room_owner_mismatch",409);
          tx.set(roomRef,{
            isActive:true,
            closedAt:FieldValue.delete(),
            updatedAt:FieldValue.serverTimestamp(),
          },{merge:true});
          tx.set(userRef,{personalRoomId:roomId},{merge:true});
          return roomResponse(roomId,{...data,isActive:true});
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
          roomType:"personal",
          type:"personal",
          category:"دردشة",
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
          seats:Array.from({length:8},(_,index)=>({
            index,uid:"",displayName:"",profileImageUrl:"",muted:true,
          })),
          micInvites:[],
          micRequests:[],
          publicId,
          searchTokens:searchTokens(name,publicId),
          createdAt:now,
          updatedAt:now,
        };
        tx.create(roomRef,data);
        tx.create(publicRef,{
          roomId,
          ownerUid:uid,
          source:"personalRoom",
          createdAt:now,
        });
        tx.set(userRef,{personalRoomId:roomId},{merge:true});
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

async function updateRoomSettings(db,uid,body){
  const roomId=clean(body.roomId);
  if(!/^[A-Za-z0-9_-]{1,180}$/.test(roomId))throw new ApiError("invalid_room_id",400);

  const name=clean(body.name);
  const description=clean(body.description);
  const category=clean(body.category)||"دردشة";
  const visibility=clean(body.visibility)||"public";
  const password=String(body.password??"");
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

  const roomRef=db.collection("rooms").doc(roomId);
  const userRef=db.collection("users").doc(uid);

  return db.runTransaction(async tx=>{
    const [roomSnap,userSnap]=await Promise.all([tx.get(roomRef),tx.get(userRef)]);
    if(!roomSnap.exists)throw new ApiError("room_not_found",404);
    const room=roomSnap.data()||{};
    const user=userSnap.data()||{};
    const permissions=roomPermissions(user);
    const ownerUid=clean(room.ownerUid||room.ownerId||room.hostId);
    if(ownerUid!==uid&&!permissions.manageRooms)throw new ApiError("forbidden",403);
    if(visibility==="hidden"&&!permissions.hidden)throw new ApiError("hidden_room_forbidden",403);

    const update={
      name,
      title:name,
      description,
      category,
      tags,
      visibility,
      isHidden:visibility==="hidden",
      searchTokens:searchTokens(name+" "+tags.join(" "),clean(room.publicId)),
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
    return {
      ok:true,
      room:roomResponse(roomId,{...room,...update}),
    };
  });
}

async function closePersonalRoom(db,uid,roomId){
  if(!/^personal_[A-Za-z0-9:_-]{1,160}$/.test(roomId))throw new ApiError("invalid_room_id",400);
  const ref=db.collection("rooms").doc(roomId);
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
  });
  return {ok:true,roomId,isActive:false};
}

function roomSeatCapacity(room){
  const level=Math.max(1,Math.min(6,Number(room.level||1)));
  const type=clean(room.roomType||room.type||"personal");
  if(type==="customer_service")return 5;
  const agency=[10,12,14,16,20,22];
  const normal=[8,10,12,15,20,20];
  return (type==="agency"?agency:normal)[level-1];
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
    });
  }
  return seats;
}

async function roomSeatState(db,uid,roomId){
  if(!/^[A-Za-z0-9_-]{1,180}$/.test(roomId))throw new ApiError("invalid_room_id",400);
  const snap=await db.collection("rooms").doc(roomId).get();
  if(!snap.exists)throw new ApiError("room_not_found",404);
  const room=snap.data()||{};
  return {
    ok:true,
    roomId,
    seats:normalizeSeats(room),
    micInvites:Array.isArray(room.micInvites)?room.micInvites:[],
    micRequests:Array.isArray(room.micRequests)?room.micRequests:[],
    isOwner:String(room.ownerUid||room.ownerId||room.hostId||"")===uid,
    isActive:room.isActive!==false,
  };
}

async function roomSeatAction(db,uid,body){
  const roomId=clean(body.roomId);
  const action=clean(body.seatAction);
  const targetUid=clean(body.targetUid);
  const seatIndex=Number(body.seatIndex);
  if(!/^[A-Za-z0-9_-]{1,180}$/.test(roomId))throw new ApiError("invalid_room_id",400);

  const roomRef=db.collection("rooms").doc(roomId);
  const myProfileRef=db.collection("public_profiles").doc(uid);

  return db.runTransaction(async tx=>{
    const roomSnap=await tx.get(roomRef);
    if(!roomSnap.exists)throw new ApiError("room_not_found",404);
    const room=roomSnap.data()||{};
    if(room.isActive===false)throw new ApiError("room_unavailable",409);

    const ownerUid=String(room.ownerUid||room.ownerId||room.hostId||"");
    const isOwner=ownerUid===uid;
    let seats=normalizeSeats(room);
    let invites=Array.isArray(room.micInvites)?[...room.micInvites]:[];
    let requests=Array.isArray(room.micRequests)?[...room.micRequests]:[];

    const clearUserSeat=userId=>{
      seats=seats.map(seat=>seat.uid===userId
        ? {...seat,uid:"",displayName:"",profileImageUrl:"",muted:true}
        : seat);
    };

    if(action==="requestMic"){
      if(!requests.includes(uid))requests.push(uid);
    }else if(action==="cancelMicRequest"){
      requests=requests.filter(id=>id!==uid);
    }else if(action==="inviteToMic"){
      if(!isOwner)throw new ApiError("forbidden",403);
      if(!targetUid||targetUid===uid)throw new ApiError("invalid_target",400);
      if(!invites.includes(targetUid))invites.push(targetUid);
    }else if(action==="approveMicRequest"){
      if(!isOwner)throw new ApiError("forbidden",403);
      if(!targetUid||targetUid===uid)throw new ApiError("invalid_target",400);
      if(!requests.includes(targetUid))throw new ApiError("mic_request_not_found",404);
      requests=requests.filter(id=>id!==targetUid);
      if(!invites.includes(targetUid))invites.push(targetUid);
    }else if(action==="rejectMicRequest"){
      if(!isOwner)throw new ApiError("forbidden",403);
      if(!targetUid)throw new ApiError("invalid_target",400);
      requests=requests.filter(id=>id!==targetUid);
    }else if(action==="declineMicInvite"){
      invites=invites.filter(id=>id!==uid);
    }else if(action==="takeSeat"||action==="switchSeat"){
      if(!Number.isInteger(seatIndex)||seatIndex<0||seatIndex>=seats.length)throw new ApiError("invalid_seat",400);
      const seat=seats[seatIndex];
      if(seat.uid&&seat.uid!==uid)throw new ApiError("seat_occupied",409);
      if(!isOwner&&!invites.includes(uid))throw new ApiError("mic_invite_required",403);

      const profileSnap=await tx.get(myProfileRef);
      const profile=profileSnap.data()||{};
      clearUserSeat(uid);
      seats[seatIndex]={
        index:seatIndex,
        uid,
        displayName:String(profile.displayName||profile.username||"مستخدم Shadow Live"),
        profileImageUrl:String(profile.profileImageUrl||""),
        muted:true,
      };
      invites=invites.filter(id=>id!==uid);
      requests=requests.filter(id=>id!==uid);
    }else if(action==="muteSeat"||action==="unmuteSeat"){
      const seatIndex=seats.findIndex(seat=>seat.uid===uid);
      if(seatIndex<0)throw new ApiError("speaker_seat_required",403);
      seats[seatIndex]={...seats[seatIndex],muted:action==="muteSeat"};
    }else if(action==="leaveSeat"){
      clearUserSeat(uid);
    }else if(action==="removeFromMic"){
      if(!isOwner)throw new ApiError("forbidden",403);
      if(!targetUid)throw new ApiError("invalid_target",400);
      clearUserSeat(targetUid);
      invites=invites.filter(id=>id!==targetUid);
      requests=requests.filter(id=>id!==targetUid);
    }else{
      throw new ApiError("invalid_seat_action",400);
    }

    tx.update(roomRef,{
      seats,
      micInvites:invites,
      micRequests:requests,
      updatedAt:FieldValue.serverTimestamp(),
    });

    return {
      ok:true,
      roomId,
      seats,
      micInvites:invites,
      micRequests:requests,
      isOwner,
    };
  });
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

  async function hydrate(snapshot){
    const result=[];
    for(const entry of snapshot.docs){
      const roomId=clean(entry.data()?.roomId||entry.id);
      if(!roomId)continue;
      const roomSnap=await db.collection("rooms").doc(roomId).get();
      if(!roomSnap.exists)continue;
      const data=roomSnap.data()||{};
      if(data.isActive===false||data.isHidden===true||clean(data.visibility)==="hidden")continue;
      result.push(roomResponse(roomId,data));
    }
    return result;
  }

  const [favorites,history]=await Promise.all([
    hydrate(favoritesSnap),
    hydrate(visitsSnap),
  ]);
  return {ok:true,favorites,history};
}

async function roomInsights(db,uid,roomId){
  if(!/^[A-Za-z0-9_-]{1,180}$/.test(roomId))throw new ApiError("invalid_room_id",400);
  const roomRef=db.collection("rooms").doc(roomId);
  const followRef=db.collection("room_follows").doc(roomId).collection("users").doc(uid);

  const favoriteRef=db.collection("room_favorites").doc(uid).collection("items").doc(roomId);
  const [roomSnap,followSnap,favoriteSnap,activeRooms,supportersSnap]=await Promise.all([
    roomRef.get(),
    followRef.get(),
    favoriteRef.get(),
    db.collection("rooms").where("isActive","==",true).limit(200).get(),
    roomRef.collection("supporters").orderBy("totalSupport","desc").limit(50).get(),
  ]);
  if(!roomSnap.exists)throw new ApiError("room_not_found",404);

  const room=roomSnap.data()||{};
  const ranked=activeRooms.docs
    .map(doc=>({id:doc.id,...(doc.data()||{})}))
    .sort((a,b)=>Number(b.dailySupport||0)-Number(a.dailySupport||0));
  const rankIndex=ranked.findIndex(item=>item.id===roomId);

  const supporters=supportersSnap.docs.map((doc,index)=>{
    const data=doc.data()||{};
    return {
      uid:doc.id,
      rank:index+1,
      displayName:String(data.displayName||data.username||"مستخدم Shadow Live"),
      profileImageUrl:String(data.profileImageUrl||""),
      totalSupport:Number(data.totalSupport||0),
      dailySupport:Number(data.dailySupport||0),
    };
  });

  return {
    ok:true,
    roomId,
    level:Math.max(1,Number(room.level||1)),
    levelPoints:Math.max(0,Number(room.levelPoints||0)),
    levelTarget:Math.max(1,Number(room.levelTarget||1000)),
    followerCount:Math.max(0,Number(room.followerCount||0)),
    followed:followSnap.exists,
    favorited:favoriteSnap.exists,
    dailySupport:Math.max(0,Number(room.dailySupport||0)),
    dailyRank:rankIndex>=0?rankIndex+1:null,
    supporters,
    ranking:ranked.slice(0,100).map((item,index)=>({
      roomId:item.id,
      rank:index+1,
      name:String(item.name||item.title||"غرفة صوتية"),
      publicId:String(item.publicId||""),
      dailySupport:Number(item.dailySupport||0),
    })),
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
    const authorization=clean(req.headers.authorization);
    if(!authorization.startsWith("Bearer "))throw new ApiError("unauthorized",401);
    const decoded=await getAuth().verifyIdToken(authorization.slice(7));
    if(decoded.firebase?.sign_in_provider==="anonymous")throw new ApiError("account_required",403);

    const action=clean(req.body?.action)||"token";
    if(action==="personalRoom"){
      const room=await openPersonalRoom(getFirestore(),decoded.uid);
      return out(res,200,{ok:true,room});
    }
    if(action==="closePersonalRoom"){
      const roomId=clean(req.body?.roomId);
      const result=await closePersonalRoom(getFirestore(),decoded.uid,roomId);
      return out(res,200,result);
    }
    if(action==="updateRoomSettings"){
      return out(res,200,await updateRoomSettings(getFirestore(),decoded.uid,req.body||{}));
    }
    if(action==="roomInsights"){
      const roomId=clean(req.body?.roomId);
      return out(res,200,await roomInsights(getFirestore(),decoded.uid,roomId));
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
    if(action==="roomSeatState"){
      const roomId=clean(req.body?.roomId);
      return out(res,200,await roomSeatState(getFirestore(),decoded.uid,roomId));
    }
    if(action==="roomSeatAction"){
      return out(res,200,await roomSeatAction(getFirestore(),decoded.uid,req.body||{}));
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
    return out(res,500,{ok:false,code:"server_failed"});
  }
}
