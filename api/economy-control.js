import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

function clean(value){return String(value??"").trim();}
function parseServiceAccount(raw){
  const text=clean(raw);
  if(!text)throw Error("server_not_configured");
  let sa=JSON.parse(text);
  if(typeof sa==="string")sa=JSON.parse(sa);
  const projectId=sa.project_id||sa.projectId;
  const clientEmail=sa.client_email||sa.clientEmail;
  const privateKey=String(sa.private_key||sa.privateKey||"").replace(/\\n/g,"\n");
  if(!projectId||!clientEmail||!privateKey)throw Error("invalid_service_account_json");
  return {projectId,clientEmail,privateKey};
}
function initFirebase(){
  if(!getApps().length){
    const sa=parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT);
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
  if(!authorization.startsWith("Bearer "))throw Error("unauthorized");
  const decoded=await getAuth().verifyIdToken(authorization.slice(7));
  const db=getFirestore();
  const snap=await db.collection("users").doc(decoded.uid).get();
  if(!snap.exists)throw Error("forbidden");
  const user=snap.data()||{};
  const caps=Array.isArray(user.capabilities)?user.capabilities:[];
  const canEconomy=user.role==="owner"||(user.adminEnabled===true&&caps.includes("manageEconomy"));
  if(!canEconomy)throw Error("forbidden");
  return {uid:decoded.uid,db,isOwner:user.role==="owner"};
}

function safeUser(uid,data){
  return {
    uid,
    publicId:clean(data.publicId),
    displayName:clean(data.displayName||data.username||"مستخدم Shadow Live"),
    username:clean(data.username),
    coins:Math.max(0,Number(data.coins??data.balance??0)),
    diamonds:Math.max(0,Number(data.diamonds||0)),
    pendingGiftEarningCoins:Math.max(0,Number(data.pendingGiftEarningCoins||0)),
    giftEarningCoinsLifetime:Math.max(0,Number(data.giftEarningCoinsLifetime||0)),
    giftDiamondsLifetime:Math.max(0,Number(data.giftDiamondsLifetime||0)),
    giftSupportReceivedCoins:Math.max(0,Number(data.giftSupportReceivedCoins||0)),
    totalGiftsSent:Math.max(0,Number(data.totalGiftsSent||0)),
    totalGiftsReceived:Math.max(0,Number(data.totalGiftsReceived||0)),
    totalValueReceived:Math.max(0,Number(data.totalValueReceived||0)),
    agencyId:clean(data.agencyId),
    role:clean(data.role||"user"),
  };
}

async function findUser(db,query){
  const q=clean(query);
  if(!q||q.length>180)throw Error("invalid_query");
  const direct=await db.collection("users").doc(q).get();
  if(direct.exists)return safeUser(direct.id,direct.data()||{});

  const byPublic=await db.collection("public_profiles").where("publicId","==",q).limit(1).get();
  if(!byPublic.empty){
    const uid=byPublic.docs[0].id;
    const user=await db.collection("users").doc(uid).get();
    if(user.exists)return safeUser(uid,user.data()||{});
  }

  const byUsername=await db.collection("public_profiles").where("username","==",q).limit(1).get();
  if(!byUsername.empty){
    const uid=byUsername.docs[0].id;
    const user=await db.collection("users").doc(uid).get();
    if(user.exists)return safeUser(uid,user.data()||{});
  }
  throw Error("user_not_found");
}

async function userLedger(db,uid){
  const snap=await db.collection("financial_ledger").where("userId","==",uid).limit(50).get();
  return snap.docs.map(doc=>({id:doc.id,...(doc.data()||{})}));
}

async function searchOperations(db,query){
  const q=clean(query);
  if(!/^[A-Za-z0-9_-]{3,220}$/.test(q))throw Error("invalid_query");
  const collections=[
    "financial_ledger",
    "gift_transactions",
    "wallet_operations",
    "gift_operations",
    "google_play_purchases",
    "control_operations",
    "wallet_transfers",
  ];
  const results=[];
  const direct=await Promise.all(collections.map(name=>db.collection(name).doc(q).get()));
  for(let i=0;i<direct.length;i++){
    const snap=direct[i];
    if(snap.exists)results.push({collection:collections[i],id:snap.id,data:snap.data()||{}});
  }

  const [byIdempotency,bySource]=await Promise.all([
    db.collection("financial_ledger").where("idempotencyKey","==",q).limit(20).get(),
    db.collection("financial_ledger").where("sourceId","==",q).limit(20).get(),
  ]);
  for(const doc of [...byIdempotency.docs,...bySource.docs]){
    if(!results.some(item=>item.collection==="financial_ledger"&&item.id===doc.id)){
      results.push({collection:"financial_ledger",id:doc.id,data:doc.data()||{}});
    }
  }
  return results.slice(0,50);
}

export default async function handler(req,res){
  if(cors(req,res))return;
  if(req.method!=="POST")return out(res,405,{ok:false,code:"method_not_allowed"});
  try{
    initFirebase();
    const {uid,db,isOwner}=await actor(req);
    const action=clean(req.body?.action);

    if(action==="state"){
      const lock=await db.collection("system_config").doc("emergency_lock").get();
      return out(res,200,{
        ok:true,
        isOwner,
        emergencyLock:lock.exists?lock.data():{enabled:false},
      });
    }

    if(action==="setEmergencyLock"){
      if(!isOwner)throw Error("owner_required");
      const enabled=req.body?.enabled===true;
      const reason=clean(req.body?.reason);
      if(reason.length<3||reason.length>240)throw Error("invalid_reason");
      const ref=db.collection("system_config").doc("emergency_lock");
      const before=await ref.get();
      const auditRef=db.collection("admin_audit_logs").doc();
      await db.runTransaction(async tx=>{
        tx.set(ref,{
          enabled,
          reason,
          updatedBy:uid,
          updatedAt:FieldValue.serverTimestamp(),
        },{merge:true});
        tx.create(auditRef,{
          actorUid:uid,
          action:enabled?"enableEmergencyEconomyLock":"disableEmergencyEconomyLock",
          targetType:"system_config",
          targetId:"emergency_lock",
          reason,
          before:before.exists?before.data():null,
          after:{enabled,reason},
          createdAt:FieldValue.serverTimestamp(),
        });
      });
      return out(res,200,{ok:true,enabled,reason});
    }

    if(action==="searchUser"){
      const user=await findUser(db,req.body?.query);
      const ledger=await userLedger(db,user.uid);
      return out(res,200,{ok:true,user,ledger});
    }

    if(action==="searchOperation"){
      const operations=await searchOperations(db,req.body?.query);
      return out(res,200,{ok:true,operations});
    }

    return out(res,400,{ok:false,code:"invalid_action"});
  }catch(error){
    const code=clean(error?.message)||"server_error";
    const status=code==="unauthorized"?401:
      ["forbidden","owner_required"].includes(code)?403:
      code==="user_not_found"?404:
      ["invalid_query","invalid_reason","invalid_action"].includes(code)?400:500;
    return out(res,status,{ok:false,code});
  }
}
