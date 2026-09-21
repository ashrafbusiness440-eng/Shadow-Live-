import {createCipheriv,randomBytes,randomInt,createHash} from "crypto";
import {getApps,initializeApp,cert} from "firebase-admin/app";
import {getAuth} from "firebase-admin/auth";

class ApiError extends Error {
  constructor(code,status=400){super(code);this.code=code;this.status=status;}
}

function parseServiceAccount(raw){
  const text=String(raw||"").trim();
  if(!text)throw new ApiError("server_not_configured",500);
  let sa=JSON.parse(text);
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
    if(!cfg.appId||!cfg.secretValid)throw new ApiError("zego_not_configured",503);
    initFirebase();
    const authorization=clean(req.headers.authorization);
    if(!authorization.startsWith("Bearer "))throw new ApiError("unauthorized",401);
    const decoded=await getAuth().verifyIdToken(authorization.slice(7));
    const roomId=clean(req.body?.roomId);
    if(!/^[A-Za-z0-9_-]{1,96}$/.test(roomId))throw new ApiError("invalid_room_id",400);

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
