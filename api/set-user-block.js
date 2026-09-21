import {getApps,initializeApp,cert} from "firebase-admin/app";
import {getAuth} from "firebase-admin/auth";
import {getFirestore,FieldValue} from "firebase-admin/firestore";

function parseServiceAccount(raw){
  const text=String(raw||"").trim();
  if(!text)throw Error("server_not_configured");
  let sa=JSON.parse(text);
  if(typeof sa==="string")sa=JSON.parse(sa);
  const projectId=sa.project_id||sa.projectId,clientEmail=sa.client_email||sa.clientEmail;
  const privateKey=String(sa.private_key||sa.privateKey||"").replace(/\\n/g,"\n");
  if(!projectId||!clientEmail||!privateKey)throw Error("invalid_service_account_json");
  return {projectId,clientEmail,privateKey};
}
function init(){if(!getApps().length){const sa=parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT);initializeApp({credential:cert(sa),projectId:sa.projectId});}}
function cors(req,res){res.setHeader("access-control-allow-origin","*");res.setHeader("access-control-allow-methods","POST,OPTIONS");res.setHeader("access-control-allow-headers","Authorization, Content-Type");if(req.method==="OPTIONS"){res.status(204).end();return true;}return false;}
const out=(res,status,body)=>res.status(status).json(body);

export default async function handler(req,res){
  if(cors(req,res))return;
  if(req.method!=="POST")return out(res,405,{ok:false,code:"method_not_allowed"});
  try{
    init();
    const auth=req.headers.authorization||"";
    if(!auth.startsWith("Bearer "))return out(res,401,{ok:false,code:"unauthorized"});
    const decoded=await getAuth().verifyIdToken(auth.slice(7));
    const targetUserId=String(req.body?.targetUserId||"").trim();
    const blocked=req.body?.blocked===true;
    if(!targetUserId||targetUserId===decoded.uid)return out(res,400,{ok:false,code:"invalid_request"});

    const db=getFirestore();
    const result=await db.runTransaction(async tx=>{
      const targetRef=db.collection("users").doc(targetUserId);
      const blockRef=db.collection("user_blocks").doc(decoded.uid).collection("items").doc(targetUserId);
      const outgoingFollowRef=db.collection("follows").doc(decoded.uid+"__"+targetUserId);
      const incomingFollowRef=db.collection("follows").doc(targetUserId+"__"+decoded.uid);
      const [target,currentBlock,outgoingFollow,incomingFollow]=await Promise.all([
        tx.get(targetRef),tx.get(blockRef),tx.get(outgoingFollowRef),tx.get(incomingFollowRef)
      ]);
      if(!target.exists)throw Error("not_found");
      if(blocked){
        tx.set(blockRef,{
          blockerUid:decoded.uid,
          blockedUid:targetUserId,
          createdAt:currentBlock.exists?(currentBlock.data()?.createdAt||FieldValue.serverTimestamp()):FieldValue.serverTimestamp(),
          updatedAt:FieldValue.serverTimestamp(),
        },{merge:true});
        if(outgoingFollow.exists)tx.delete(outgoingFollowRef);
        if(incomingFollow.exists)tx.delete(incomingFollowRef);
      }else if(currentBlock.exists){
        tx.delete(blockRef);
      }
      return {blocked};
    });
    return out(res,200,{ok:true,...result});
  }catch(e){
    const raw=e?.message||"server_error";
    return out(res,raw==="not_found"?404:500,{ok:false,code:raw==="not_found"?"not_found":"server_failed"});
  }
}
