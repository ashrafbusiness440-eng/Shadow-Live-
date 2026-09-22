import {getApps,initializeApp,cert} from "firebase-admin/app";
import {getAuth} from "firebase-admin/auth";
import {getFirestore,FieldValue} from "firebase-admin/firestore";

function parseServiceAccount(raw){
  const text=String(raw||"").trim();
  if(!text)throw Error("server_not_configured");
  let sa=JSON.parse(text); if(typeof sa==="string")sa=JSON.parse(sa);
  const projectId=sa.project_id||sa.projectId;
  const clientEmail=sa.client_email||sa.clientEmail;
  const privateKey=String(sa.private_key||sa.privateKey||"").replace(/\\n/g,"\n");
  if(!projectId||!clientEmail||!privateKey)throw Error("invalid_service_account_json");
  return {projectId,clientEmail,privateKey};
}

function init(){
  if(!getApps().length){
    const sa=parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT);
    initializeApp({credential:cert(sa),projectId:sa.projectId});
  }
}

const out=(res,status,body)=>res.status(status).json(body);
const clean=(value)=>String(value??"").trim();

const NORMAL_SEATS=[8,10,12,15,20,20];
const NORMAL_MODERATORS=[3,4,5,7,9,12];
const AGENCY_SEATS=[10,12,14,16,20,22];
const AGENCY_MODERATORS=[5,6,7,9,11,14];

function level(value){
  const parsed=Number(value);
  if(!Number.isInteger(parsed)||parsed<1||parsed>6)throw Error("invalid_room_level");
  return parsed;
}

function boundedInt(value,{min,max,code}){
  if(value===null||value===undefined||value==="")return null;
  const parsed=Number(value);
  if(!Number.isInteger(parsed)||parsed<min||parsed>max)throw Error(code);
  return parsed;
}

function roomKind(room){
  const type=clean(room.roomType||room.type||"personal");
  const official=room.officialRoom===true||room.systemOwned===true||
    type==="administrative"||type==="official"||type==="customer_service";
  const agency=type==="agency";
  return {type,official,agency};
}

function basePolicy(room){
  const currentLevel=level(room.level||1);
  const kind=roomKind(room);
  return {
    level:currentLevel,
    seats:(kind.agency?AGENCY_SEATS:NORMAL_SEATS)[currentLevel-1],
    moderators:(kind.agency?AGENCY_MODERATORS:NORMAL_MODERATORS)[currentLevel-1],
    ...kind,
  };
}

function normalizeOverrides(room){
  const raw=room.controlOverrides&&typeof room.controlOverrides==="object"
    ? room.controlOverrides
    : {};
  return {
    seats:boundedInt(raw.seats,{min:1,max:50,code:"invalid_seat_override"}),
    moderators:boundedInt(raw.moderators,{min:0,max:30,code:"invalid_moderator_override"}),
    bypassLevelCapacity:raw.bypassLevelCapacity===true,
  };
}

function effectivePolicy(room){
  const base=basePolicy(room);
  const overrides=normalizeOverrides(room);
  const manual=base.official||overrides.bypassLevelCapacity;
  return {
    ...base,
    overrides,
    effectiveSeats:manual&&overrides.seats!==null?overrides.seats:base.seats,
    effectiveModerators:manual&&overrides.moderators!==null?overrides.moderators:base.moderators,
    capacityMode:manual?"manual":"level",
  };
}

function actorCanManageRooms(actor){
  const capabilities=Array.isArray(actor.capabilities)?actor.capabilities.map(String):[];
  return actor.adminEnabled===true&&(
    actor.role==="owner"||
    capabilities.includes("manageRooms")||
    capabilities.includes("globalRoomControl")
  );
}

function auditShape({actorUid,action,roomId,reason,before,after,operationId}){
  return {
    actorUid,
    action,
    targetType:"room",
    targetId:roomId,
    reason,
    before,
    after,
    operationId,
  };
}

export {
  basePolicy,
  normalizeOverrides,
  effectivePolicy,
  actorCanManageRooms,
  auditShape,
};

export default async function handler(req,res){
  if(req.method!=="POST")return out(res,405,{ok:false,code:"method_not_allowed"});
  try{
    init();
    const auth=req.headers.authorization||"";
    if(!auth.startsWith("Bearer "))return out(res,401,{ok:false,code:"unauthorized"});
    const decoded=await getAuth().verifyIdToken(auth.slice(7));

    const db=getFirestore();
    const actorSnap=await db.collection("users").doc(decoded.uid).get();
    const actor=actorSnap.data()||{};
    if(!actorSnap.exists||!actorCanManageRooms(actor)){
      return out(res,403,{ok:false,code:"forbidden"});
    }

    const body=req.body||{};
    const action=clean(body.action||"state");
    const roomId=clean(body.roomId);
    if(!/^[A-Za-z0-9_-]{1,180}$/.test(roomId)){
      return out(res,400,{ok:false,code:"invalid_room_id"});
    }

    if(action==="state"){
      const roomSnap=await db.collection("rooms").doc(roomId).get();
      if(!roomSnap.exists)return out(res,404,{ok:false,code:"room_not_found"});
      const room=roomSnap.data()||{};
      const policy=effectivePolicy(room);
      return out(res,200,{
        ok:true,
        code:"ok",
        roomId,
        publicId:clean(room.publicId),
        name:clean(room.name||room.title||"غرفة صوتية"),
        ownerUid:clean(room.ownerUid||room.ownerId||room.hostId),
        policy,
      });
    }

    const reason=clean(body.reason);
    const operationId=clean(body.idempotencyKey);
    if(reason.length<3||reason.length>160||!/^[A-Za-z0-9_-]{12,160}$/.test(operationId)){
      return out(res,400,{ok:false,code:"invalid_request"});
    }

    const roomRef=db.collection("rooms").doc(roomId);
    const opRef=db.collection("control_operations").doc(operationId);

    const result=await db.runTransaction(async tx=>{
      const [opSnap,roomSnap]=await Promise.all([tx.get(opRef),tx.get(roomRef)]);
      if(opSnap.exists){
        return {ok:true,code:"duplicate",operationId,...(opSnap.data()?.result||{})};
      }
      if(!roomSnap.exists)throw Error("room_not_found");

      const room=roomSnap.data()||{};
      const beforePolicy=effectivePolicy(room);
      const now=FieldValue.serverTimestamp();
      let patch={};
      let auditAction=action;

      if(action==="setLevel"||action==="raiseLevel"||action==="lowerLevel"){
        let nextLevel=beforePolicy.level;
        if(action==="setLevel"){
          nextLevel=level(body.level);
        }else if(action==="raiseLevel"){
          nextLevel=Math.min(6,beforePolicy.level+1);
        }else{
          nextLevel=Math.max(1,beforePolicy.level-1);
        }
        if(nextLevel===beforePolicy.level)throw Error("level_unchanged");
        patch={
          level:nextLevel,
          levelUpdatedAt:now,
          levelUpdatedBy:decoded.uid,
          updatedAt:now,
        };
      }else if(action==="setOverrides"){
        const current=normalizeOverrides(room);
        const nextSeats=Object.prototype.hasOwnProperty.call(body,"seats")
          ? boundedInt(body.seats,{min:1,max:50,code:"invalid_seat_override"})
          : current.seats;
        const nextModerators=Object.prototype.hasOwnProperty.call(body,"moderators")
          ? boundedInt(body.moderators,{min:0,max:30,code:"invalid_moderator_override"})
          : current.moderators;
        const nextBypass=Object.prototype.hasOwnProperty.call(body,"bypassLevelCapacity")
          ? body.bypassLevelCapacity===true
          : current.bypassLevelCapacity;

        patch={
          controlOverrides:{
            seats:nextSeats,
            moderators:nextModerators,
            bypassLevelCapacity:nextBypass,
            updatedBy:decoded.uid,
          },
          overrideUpdatedAt:now,
          updatedAt:now,
        };
      }else if(action==="resetOverrides"){
        patch={
          controlOverrides:{
            seats:null,
            moderators:null,
            bypassLevelCapacity:false,
            updatedBy:decoded.uid,
          },
          overrideUpdatedAt:now,
          updatedAt:now,
        };
      }else{
        throw Error("unsupported_action");
      }

      const simulated={...room,...patch};
      const afterPolicy=effectivePolicy(simulated);

      tx.update(roomRef,patch);

      const auditRef=db.collection("admin_audit_logs").doc();
      tx.create(auditRef,{
        ...auditShape({
          actorUid:decoded.uid,
          action:auditAction,
          roomId,
          reason,
          before:beforePolicy,
          after:afterPolicy,
          operationId,
        }),
        createdAt:now,
      });

      const resultData={
        roomId,
        before:beforePolicy,
        after:afterPolicy,
      };
      tx.create(opRef,{
        action,
        actorUid:decoded.uid,
        targetId:roomId,
        targetType:"room",
        status:"completed",
        result:resultData,
        createdAt:now,
      });

      return {ok:true,code:"ok",operationId,...resultData};
    });

    return out(res,200,result);
  }catch(error){
    const code=clean(error?.message||"server_failed");
    const badRequest=[
      "invalid_room_level",
      "invalid_seat_override",
      "invalid_moderator_override",
      "unsupported_action",
      "level_unchanged",
      "server_not_configured",
      "invalid_service_account_json",
    ];
    const status=code==="room_not_found"?404:badRequest.includes(code)?400:500;
    return out(res,status,{ok:false,code:code==="room_not_found"||badRequest.includes(code)?code:"server_failed"});
  }
}
