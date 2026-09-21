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
    const following=req.body?.following===true;
    if(!targetUserId||targetUserId===decoded.uid)return out(res,400,{ok:false,code:"invalid_request"});

    const db=getFirestore();
    const result=await db.runTransaction(async tx=>{
      const targetRef=db.collection("users").doc(targetUserId);
      const relationRef=db.collection("follows").doc(decoded.uid+"__"+targetUserId);
      const outgoingBlockRef=db.collection("user_blocks").doc(decoded.uid).collection("items").doc(targetUserId);
      const incomingBlockRef=db.collection("user_blocks").doc(targetUserId).collection("items").doc(decoded.uid);
      const [target,relation,outgoingBlock,incomingBlock]=await Promise.all([
        tx.get(targetRef),tx.get(relationRef),tx.get(outgoingBlockRef),tx.get(incomingBlockRef)
      ]);
      if(!target.exists)throw Error("not_found");
      if(following&&(outgoingBlock.exists||incomingBlock.exists))throw Error("blocked");

      if(following&&!relation.exists){
        tx.create(relationRef,{
          followerUid:decoded.uid,
          followingUid:targetUserId,
          createdAt:FieldValue.serverTimestamp(),
        });
      }else if(!following&&relation.exists){
        tx.delete(relationRef);
      }
      return {following};
    });
    return out(res,200,{ok:true,...result});
  }catch(e){
    const raw=e?.message||"server_error";
    const code=raw==="not_found"||raw==="blocked"?raw:"server_failed";
    const status=raw==="not_found"?404:raw==="blocked"?403:500;
    return out(res,status,{ok:false,code});
  }
}
