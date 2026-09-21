import {getApps,initializeApp,cert} from "firebase-admin/app";
import {getAuth} from "firebase-admin/auth";
import {getFirestore,FieldValue,Timestamp} from "firebase-admin/firestore";

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
const bounded=(value,fallback,min,max)=>{const n=Number(value);return Number.isFinite(n)?Math.max(min,Math.min(max,Math.floor(n))):fallback;};

export default async function handler(req,res){
  if(cors(req,res))return;
  if(req.method!=="POST")return out(res,405,{ok:false,code:"method_not_allowed"});
  try{
    init();
    const auth=req.headers.authorization||"";
    if(!auth.startsWith("Bearer "))return out(res,401,{ok:false,code:"unauthorized"});
    const decoded=await getAuth().verifyIdToken(auth.slice(7));
    const body=req.body||{};
    const targetUserId=String(body.targetUserId||"").trim();
    const conversationId=String(body.conversationId||"").trim();
    const reason=String(body.reason||"").trim();
    const details=String(body.details||"").trim();
    const key=String(body.idempotencyKey||"").trim();
    const allowedReasons=new Set(["spam","harassment","inappropriate_content","scam","other"]);
    if(!targetUserId||targetUserId===decoded.uid||!conversationId||conversationId.includes("/")||!allowedReasons.has(reason)||details.length>500||!/^[A-Za-z0-9_-]{12,220}$/.test(key)){
      return out(res,400,{ok:false,code:"invalid_request"});
    }

    const db=getFirestore();
    const nowMs=Date.now();
    const result=await db.runTransaction(async tx=>{
      const opRef=db.collection("report_operations").doc(key);
      const targetRef=db.collection("users").doc(targetUserId);
      const conversationRef=db.collection("conversations").doc(conversationId);
      const rateRef=db.collection("report_rate_limits").doc(decoded.uid);
      const configRef=db.collection("system_config").doc("messaging");
      const reportRef=db.collection("reports").doc();

      const [op,target,conversation,rate,config]=await Promise.all([
        tx.get(opRef),tx.get(targetRef),tx.get(conversationRef),tx.get(rateRef),tx.get(configRef)
      ]);
      if(op.exists)return {ok:true,code:"duplicate",...(op.data()?.result||{})};
      if(!target.exists||!conversation.exists)throw Error("not_found");

      const participants=Array.isArray(conversation.data()?.participants)?conversation.data().participants:[];
      if(participants.length!==2||!participants.includes(decoded.uid)||!participants.includes(targetUserId))throw Error("invalid_conversation");

      const cfg=config.data()||{};
      const windowMinutes=bounded(cfg.reportRateWindowMinutes,60,5,1440);
      const maxReports=bounded(cfg.reportRateMax,5,1,20);
      const rateData=rate.data()||{};
      const startedMs=rateData.windowStartedAt?.toMillis?.()||0;
      const sameWindow=startedMs>0&&(nowMs-startedMs)<windowMinutes*60*1000;
      const currentCount=sameWindow?Math.max(0,Number(rateData.count||0)):0;
      if(currentCount>=maxReports)throw Error("rate_limited");

      tx.set(rateRef,{
        windowStartedAt:Timestamp.fromMillis(sameWindow?startedMs:nowMs),
        count:currentCount+1,
        updatedAt:Timestamp.fromMillis(nowMs),
      },{merge:true});

      const now=FieldValue.serverTimestamp();
      tx.create(reportRef,{
        type:"user",
        reporterId:decoded.uid,
        targetUserId,
        conversationId,
        reason,
        details,
        source:"private_chat",
        status:"open",
        createdAt:now,
        updatedAt:now,
      });
      const resultData={reportId:reportRef.id};
      tx.create(opRef,{
        reporterId:decoded.uid,
        targetUserId,
        action:"reportUser",
        status:"completed",
        result:resultData,
        createdAt:now,
      });
      return {ok:true,code:"ok",...resultData};
    });
    return out(res,200,result);
  }catch(e){
    const raw=e?.message||"server_error";
    const known=["not_found","invalid_conversation","rate_limited"];
    const code=known.includes(raw)?raw:"server_failed";
    const status=raw==="not_found"?404:raw==="invalid_conversation"?409:raw==="rate_limited"?429:500;
    return out(res,status,{ok:false,code});
  }
}
