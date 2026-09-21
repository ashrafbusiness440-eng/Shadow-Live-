import {getApps,initializeApp,cert} from "firebase-admin/app";
import {getAuth} from "firebase-admin/auth";
import {getFirestore,FieldValue} from "firebase-admin/firestore";
function parseServiceAccount(raw){const text=String(raw||"").trim();if(!text)throw Error("server_not_configured");let sa=JSON.parse(text);if(typeof sa==="string")sa=JSON.parse(sa);const projectId=sa.project_id||sa.projectId,clientEmail=sa.client_email||sa.clientEmail;const privateKey=String(sa.private_key||sa.privateKey||"").replace(/\\n/g,"\n");if(!projectId||!clientEmail||!privateKey)throw Error("invalid_service_account_json");return {projectId,clientEmail,privateKey};}
function init(){if(!getApps().length){const sa=parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT);initializeApp({credential:cert(sa),projectId:sa.projectId});}}
function cors(req,res){res.setHeader("access-control-allow-origin","*");res.setHeader("access-control-allow-methods","POST,OPTIONS");res.setHeader("access-control-allow-headers","Authorization, Content-Type");if(req.method==="OPTIONS"){res.status(204).end();return true;}return false;}
const out=(res,status,body)=>res.status(status).json(body);
export default async function handler(req,res){
 if(cors(req,res))return;if(req.method!=="POST")return out(res,405,{ok:false,code:"method_not_allowed"});let phase="init";
 try{
  init();phase="verify_token";const auth=req.headers.authorization||"";if(!auth.startsWith("Bearer "))return out(res,401,{ok:false,code:"unauthorized"});const decoded=await getAuth().verifyIdToken(auth.slice(7));
  const body=req.body||{},receiverId=String(body.receiverId||"").trim(),giftId=String(body.giftId||"").trim(),conversationId=String(body.conversationId||"").trim(),key=String(body.idempotencyKey||"").trim(),quantity=Number(body.quantity||1);
  if(!receiverId||receiverId===decoded.uid||!giftId||!conversationId||![1,7,77,777].includes(quantity)||!/^[A-Za-z0-9_-]{12,220}$/.test(key))return out(res,400,{ok:false,code:"invalid_request"});
  phase="transaction";const db=getFirestore();
  const result=await db.runTransaction(async tx=>{
   const opRef=db.collection("gift_operations").doc(key),senderRef=db.collection("users").doc(decoded.uid),receiverRef=db.collection("users").doc(receiverId),giftRef=db.collection("gifts").doc(giftId),conversationRef=db.collection("conversations").doc(conversationId),outgoingBlockRef=db.collection("user_blocks").doc(decoded.uid).collection("items").doc(receiverId),incomingBlockRef=db.collection("user_blocks").doc(receiverId).collection("items").doc(decoded.uid);
   const [op,sender,receiver,gift,conversation,outgoingBlock,incomingBlock]=await Promise.all([tx.get(opRef),tx.get(senderRef),tx.get(receiverRef),tx.get(giftRef),tx.get(conversationRef),tx.get(outgoingBlockRef),tx.get(incomingBlockRef)]);
   if(op.exists)return {ok:true,code:"duplicate",...(op.data()?.result||{})};if(!sender.exists||!receiver.exists||!gift.exists||!conversation.exists)throw Error("not_found");
   const participants=Array.isArray(conversation.data()?.participants)?conversation.data().participants:[];if(participants.length!==2||!participants.includes(decoded.uid)||!participants.includes(receiverId))throw Error("invalid_conversation");
   if(outgoingBlock.exists||incomingBlock.exists)throw Error("blocked");
   const giftData=gift.data()||{};if(giftData.isActive!==true)throw Error("gift_inactive");const unitCoins=Number(giftData.price??giftData.coins??giftData.unitCoins??0);if(!Number.isFinite(unitCoins)||unitCoins<=0)throw Error("invalid_gift_price");
   const totalCost=unitCoins*quantity,before=Number(sender.data()?.coins||0);if(before<totalCost)throw Error("insufficient_balance");const after=before-totalCost,now=FieldValue.serverTimestamp(),giftName=String(giftData.name??giftData.title??"هدية"),imageUrl=String(giftData.imageUrl??""),assetKey=String(giftData.assetKey??"");
   const messageRef=conversationRef.collection("messages").doc(),transactionRef=db.collection("gift_transactions").doc(key),ledgerRef=db.collection("financial_ledger").doc("gift_"+key),showcaseRef=db.collection("public_gift_showcases").doc(receiverId).collection("items").doc(giftId);
   const counts={...(conversation.data()?.unreadCounts||{})};counts[decoded.uid]=0;counts[receiverId]=Number(counts[receiverId]||0)+1;
   tx.update(senderRef,{coins:after,totalGiftsSent:FieldValue.increment(quantity)});tx.update(receiverRef,{totalGiftsReceived:FieldValue.increment(quantity),totalValueReceived:FieldValue.increment(totalCost)});
   tx.update(conversationRef,{lastMessage:"🎁 "+giftName+" ×"+quantity,lastSenderId:decoded.uid,updatedAt:now,unreadCounts:counts});
   tx.create(messageRef,{senderId:decoded.uid,receiverId,type:"gift",giftId,giftName,quantity,unitCoins,totalCost,imageUrl,assetKey,createdAt:now});
   tx.create(transactionRef,{senderId:decoded.uid,receiverId,conversationId,giftId,giftName,quantity,unitCoins,totalCost,createdAt:now});
   tx.create(ledgerRef,{userId:decoded.uid,asset:"coins",delta:-totalCost,openingBalance:before,closingBalance:after,reason:"gift_send",sourceType:"gift",sourceId:key,actorUid:decoded.uid,idempotencyKey:key,createdAt:now});
   tx.set(showcaseRef,{giftId,name:giftName,imageUrl,assetKey,count:FieldValue.increment(quantity),updatedAt:now},{merge:true});
   const resultData={giftId,giftName,quantity,totalCost,messageId:messageRef.id,balance:after};tx.create(opRef,{senderId:decoded.uid,receiverId,action:"sendGift",status:"completed",result:resultData,createdAt:now});return {ok:true,code:"ok",...resultData};
  });
  return out(res,200,result);
 }catch(e){const raw=e?.message||"server_error",known=["not_found","invalid_conversation","gift_inactive","invalid_gift_price","insufficient_balance","blocked"],code=known.includes(raw)?raw:"server_"+phase+"_failed",status=raw==="not_found"?404:raw==="blocked"?403:["invalid_conversation","gift_inactive","invalid_gift_price","insufficient_balance"].includes(raw)?409:500;return out(res,status,{ok:false,code});}
}
