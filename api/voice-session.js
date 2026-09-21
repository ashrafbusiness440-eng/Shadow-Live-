import {createCipheriv,randomBytes,randomInt,createHash} from "crypto";
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

function roomResponse(roomId,data){
  return {
    roomId,
    name:clean(data.name||data.title||"غرفتي"),
    publicId:clean(data.publicId),
    ownerUid:clean(data.ownerUid||data.hostId),
    roomType:clean(data.roomType||"personal"),
    category:clean(data.category||"دردشة"),
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
    if(action!=="token")throw new ApiError("invalid_action",400);

    if(!cfg.appId||!cfg.secretValid)throw new ApiError("zego_not_configured",503);
    const roomId=clean(req.body?.roomId);
    if(!/^[A-Za-z0-9_-]{1,180}$/.test(roomId))throw new ApiError("invalid_room_id",400);

    const roomSnap=await getFirestore().collection("rooms").doc(roomId).get();
    if(!roomSnap.exists||roomSnap.data()?.isActive===false)throw new ApiError("room_unavailable",404);

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
