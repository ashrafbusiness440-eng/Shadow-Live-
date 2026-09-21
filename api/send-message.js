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

function init(){
  if(!getApps().length){
    const sa=parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT);
    initializeApp({credential:cert(sa),projectId:sa.projectId});
  }
}

function cors(req,res){
  res.setHeader("access-control-allow-origin","*");
  res.setHeader("access-control-allow-methods","POST,OPTIONS");
  res.setHeader("access-control-allow-headers","Authorization, Content-Type");
  if(req.method==="OPTIONS"){res.status(204).end();return true;}
  return false;
}

const out=(res,status,body)=>res.status(status).json(body);
const bounded=(value,fallback,min,max)=>{
  const n=Number(value);
  return Number.isFinite(n)?Math.max(min,Math.min(max,Math.floor(n))):fallback;
};

export default async function handler(req,res){
  if(cors(req,res))return;
  if(req.method!=="POST")return out(res,405,{ok:false,code:"method_not_allowed"});
  let phase="init";
  try{
    init();
    phase="verify_token";
    const auth=req.headers.authorization||"";
    if(!auth.startsWith("Bearer "))return out(res,401,{ok:false,code:"unauthorized"});
    const decoded=await getAuth().verifyIdToken(auth.slice(7));

    const body=req.body||{};
    const receiverId=String(body.receiverId||"").trim();
    const conversationId=String(body.conversationId||"").trim();
    const text=String(body.text||"").trim();
    const key=String(body.idempotencyKey||"").trim();
    if(
      !receiverId||
      receiverId===decoded.uid||
      !conversationId||
      conversationId.includes("/")||
      !text||
      text.length>2000||
      !/^[A-Za-z0-9_-]{12,220}$/.test(key)
    )return out(res,400,{ok:false,code:"invalid_request"});

    phase="transaction";
    const db=getFirestore();
    const nowMs=Date.now();
    const result=await db.runTransaction(async tx=>{
      const opRef=db.collection("message_operations").doc(key);
      const senderRef=db.collection("users").doc(decoded.uid);
      const receiverRef=db.collection("users").doc(receiverId);
      const conversationRef=db.collection("conversations").doc(conversationId);
      const outgoingFollowRef=db.collection("follows").doc(decoded.uid+"__"+receiverId);
      const incomingFollowRef=db.collection("follows").doc(receiverId+"__"+decoded.uid);
      const outgoingBlockRef=db.collection("user_blocks").doc(decoded.uid).collection("items").doc(receiverId);
      const incomingBlockRef=db.collection("user_blocks").doc(receiverId).collection("items").doc(decoded.uid);
      const senderLimitRef=db.collection("dm_limits").doc(conversationId+"__"+decoded.uid);
      const receiverLimitRef=db.collection("dm_limits").doc(conversationId+"__"+receiverId);
      const rateRef=db.collection("message_rate_limits").doc(decoded.uid);
      const configRef=db.collection("system_config").doc("messaging");

      const [op,sender,receiver,conversation,outgoingFollow,incomingFollow,outgoingBlock,incomingBlock,senderLimit,rate,config]=await Promise.all([
        tx.get(opRef),
        tx.get(senderRef),
        tx.get(receiverRef),
        tx.get(conversationRef),
        tx.get(outgoingFollowRef),
        tx.get(incomingFollowRef),
        tx.get(outgoingBlockRef),
        tx.get(incomingBlockRef),
        tx.get(senderLimitRef),
        tx.get(rateRef),
        tx.get(configRef),
      ]);

      if(op.exists)return {ok:true,code:"duplicate",...(op.data()?.result||{})};
      if(!sender.exists||!receiver.exists||!conversation.exists)throw Error("not_found");

      const conversationData=conversation.data()||{};
      const participants=Array.isArray(conversationData.participants)?conversationData.participants:[];
      if(participants.length!==2||!participants.includes(decoded.uid)||!participants.includes(receiverId))throw Error("invalid_conversation");
      if(outgoingBlock.exists||incomingBlock.exists)throw Error("blocked");

      const cfg=config.data()||{};
      const windowSeconds=bounded(cfg.messageRateWindowSeconds,10,2,60);
      const maxMessages=bounded(cfg.messageRateMax,8,1,50);
      const rateData=rate.data()||{};
      const startedMs=rateData.windowStartedAt?.toMillis?.()||0;
      const sameWindow=startedMs>0&&(nowMs-startedMs)<windowSeconds*1000;
      const currentCount=sameWindow?Math.max(0,Number(rateData.count||0)):0;
      if(currentCount>=maxMessages)throw Error("rate_limited");
      tx.set(rateRef,{
        windowStartedAt:Timestamp.fromMillis(sameWindow?startedMs:nowMs),
        count:currentCount+1,
        updatedAt:Timestamp.fromMillis(nowMs),
      },{merge:true});

      const mutual=outgoingFollow.exists&&incomingFollow.exists;
      const senderData=sender.data()||{};
      const assignedModerator=
        String(conversationData.customerServiceModeratorUid||"")===decoded.uid &&
        String(senderData.role||"")==="moderator";
      if(!mutual&&!assignedModerator&&!outgoingFollow.exists)throw Error("follow_required");

      const unanswered=Math.max(0,Number(senderLimit.data()?.unansweredCount||0));
      if(!mutual&&!assignedModerator&&unanswered>=3)throw Error("message_limit_reached");

      const now=FieldValue.serverTimestamp();
      const counts={...(conversationData.unreadCounts||{})};
      counts[decoded.uid]=0;
      counts[receiverId]=Number(counts[receiverId]||0)+1;

      const messageRef=conversationRef.collection("messages").doc();
      tx.update(conversationRef,{
        lastMessage:text,
        lastSenderId:decoded.uid,
        updatedAt:now,
        unreadCounts:counts,
      });
      tx.create(messageRef,{
        senderId:decoded.uid,
        receiverId,
        text,
        type:"text",
        createdAt:now,
      });

      if(mutual){
        tx.set(senderLimitRef,{unansweredCount:0,updatedAt:now},{merge:true});
        tx.set(receiverLimitRef,{unansweredCount:0,updatedAt:now},{merge:true});
      }else if(assignedModerator){
        tx.set(receiverLimitRef,{unansweredCount:0,updatedAt:now},{merge:true});
      }else{
        tx.set(senderLimitRef,{unansweredCount:unanswered+1,updatedAt:now},{merge:true});
        tx.set(receiverLimitRef,{unansweredCount:0,updatedAt:now},{merge:true});
      }

      const resultData={
        messageId:messageRef.id,
        mutual,
        assignedCustomerServiceModerator:assignedModerator,
        remaining:mutual||assignedModerator?null:Math.max(0,2-unanswered),
      };
      tx.create(opRef,{
        senderId:decoded.uid,
        receiverId,
        conversationId,
        action:"sendMessage",
        status:"completed",
        result:resultData,
        createdAt:now,
      });
      return {ok:true,code:"ok",...resultData};
    });

    return out(res,200,result);
  }catch(e){
    const raw=e?.message||"server_error";
    const known=["not_found","invalid_conversation","follow_required","message_limit_reached","blocked","rate_limited"];
    const code=known.includes(raw)?raw:"server_"+phase+"_failed";
    const status=
      raw==="not_found"?404:
      raw==="follow_required"||raw==="blocked"?403:
      raw==="message_limit_reached"||raw==="rate_limited"?429:
      raw==="invalid_conversation"?409:500;
    return out(res,status,{ok:false,code});
  }
}
