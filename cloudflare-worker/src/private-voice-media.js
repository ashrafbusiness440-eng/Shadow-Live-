import { json, readJson } from "./http.js";
import { verifyFirebaseIdToken } from "./firebase-auth.js";
import { firestoreClient } from "./firestore.js";
import { presignR2Put, presignR2Get } from "./r2-presign.js";
import {
  requireMutualPrivateVoice, validVoiceDuration, PrivateVoicePolicyError,
} from "./private-voice-eligibility.js";

const clean = (v) => String(v ?? "").trim();
const MAX_BYTES = 3 * 1024 * 1024;
const UPLOAD_TTL_MS = 5 * 60_000;
const DOWNLOAD_TTL_SECONDS = 120;
// Until codecs can be probed authoritatively, only strict PCM16 WAV is
// accepted. The client creates mono 16 kHz WAV for Android and browser.
const AUDIO = Object.freeze({ "audio/wav": "wav" });

export function validateVoiceWavHeader(bytes, expectedSize, durationSeconds) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 44 ||
      !Number.isSafeInteger(expectedSize) || expectedSize < 46 ||
      expectedSize > MAX_BYTES) {
    throw new VoiceMediaError("invalid_voice_wav_header", 400);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const label = (offset, value) => [...value].every(
    (char, n) => bytes[offset + n] === char.charCodeAt(0),
  );
  const pcm = expectedSize - 44;
  const seconds = pcm / (16000 * 2);
  if (!label(0, "RIFF") || !label(8, "WAVE") ||
      !label(12, "fmt ") || !label(36, "data") ||
      view.getUint32(4, true) !== expectedSize - 8 ||
      view.getUint32(16, true) !== 16 ||
      view.getUint16(20, true) !== 1 ||
      view.getUint16(22, true) !== 1 ||
      view.getUint32(24, true) !== 16000 ||
      view.getUint32(28, true) !== 32000 ||
      view.getUint16(32, true) !== 2 ||
      view.getUint16(34, true) !== 16 ||
      view.getUint32(40, true) !== pcm ||
      pcm % 2 !== 0 || seconds <= 0 || seconds > 60 ||
      Math.ceil(seconds) !== durationSeconds) {
    throw new VoiceMediaError("invalid_voice_wav_header", 400);
  }
  return true;
}
const identifier = /^[A-Za-z0-9_-]{1,180}$/;
const objectIdPattern = /^[a-f0-9]{32}$/;
export class VoiceMediaError extends Error {
  constructor(code,status=400) { super(code); this.code=code; this.status=status; }
}
function validTextId(text) {
  return identifier.test(clean(text));
}
function objectPath(objectId) { return "private_voice_objects/" + objectId; }
function details(body) {
  const conversationId=clean(body.conversationId);
  const otherUid=clean(body.otherUid);
  if (!validTextId(conversationId) || !validTextId(otherUid)) {
    throw new VoiceMediaError("invalid_target",400);
  }
  return {conversationId,otherUid};
}
export function validateVoiceUpload(body) {
  const scope=details(body), mimeType=clean(body.mimeType).toLowerCase();
  const byteLength=Number(body.byteLength), durationSeconds=Number(body.durationSeconds);
  if (!AUDIO[mimeType]) throw new VoiceMediaError("unsupported_audio_type",400);
  if (!Number.isSafeInteger(byteLength) || byteLength<=0 || byteLength>MAX_BYTES) {
    throw new VoiceMediaError("audio_too_large",400);
  }
  if (!validVoiceDuration(durationSeconds)) {
    throw new VoiceMediaError("voice_duration_invalid",400);
  }
  return {...scope,mimeType,byteLength,durationSeconds,extension:AUDIO[mimeType]};
}
async function eligibility(db, uid, otherUid, conversationId, transaction=null) {
  return requireMutualPrivateVoice(db,{
    actorUid:uid,otherUid,conversationId,kind:"voice_note",
    transaction,
  });
}
async function objectRecord(db, objectId, transaction=null) {
  if (!objectIdPattern.test(clean(objectId))) throw new VoiceMediaError("invalid_object_id");
  const value=await db.get(objectPath(objectId),transaction);
  if (!value.exists) throw new VoiceMediaError("voice_object_not_found",404);
  return value.data || {};
}
async function transactionRun(db,fn) {
  for(let n=0;n<3;n++) {
    const tx=await db.beginTransaction();
    try {return await fn(tx);}
    catch(e) {
      await db.rollback(tx).catch(()=>{});
      if ((e?.message==="ABORTED" || e?.status===409) && n<2) continue;
      throw e;
    }
  }
  throw new VoiceMediaError("transaction_failed",500);
}
export async function voicePrepare(db, env, uid, body) {
  const input=validateVoiceUpload(body);
  await eligibility(db,uid,input.otherUid,input.conversationId);
  if (typeof env.USER_STORAGE?.head !== "function") {
    throw new VoiceMediaError("r2_not_ready",503);
  }
  const objectId=crypto.randomUUID().replaceAll("-","");
  const key=`private-voice/${input.conversationId}/${uid}/${objectId}.${input.extension}`;
  const uploadUrl=await presignR2Put(env,{
    key,mimeType:input.mimeType,expiresSeconds:300,
  });
  const now=Date.now();
  // Bounded, persistent per-user admission rate: never sign unlimited uploads.
  await transactionRun(db,async tx=>{
    const ratePath="private_voice_upload_rate/"+uid;
    const prior=await db.get(ratePath,tx);
    const started=new Date(prior.data?.windowStartedAt||0).getTime();
    const active=Number.isFinite(started)&&started>0&&now-started<60_000;
    const count=active?Math.max(0,Number(prior.data?.count||0)):0;
    if(count>=6)throw new VoiceMediaError("voice_upload_rate_limited",429);
    await db.commit(tx,[
      db.writeUpdate(ratePath,{
        windowStartedAt:new Date(active?started:now),count:count+1,updatedAt:new Date(now),
      },["windowStartedAt","count","updatedAt"]),
      db.writeCreate(objectPath(objectId),{
        objectId,ownerUid:uid,otherUid:input.otherUid,
        conversationId:input.conversationId,storageKey:key,
        mimeType:input.mimeType,expectedSizeBytes:input.byteLength,
        durationSeconds:input.durationSeconds,
        state:"pending_upload",createdAt:new Date(now),
        uploadExpiresAt:new Date(now+UPLOAD_TTL_MS),
      }),
      db.writeCreate("private_voice_drafts/"+objectId,{
        objectId,ownerUid:uid,storageKey:key,
        expiresAt:new Date(now+24*60*60*1000),createdAt:new Date(now),
      }),
    ]);
  });
  return {ok:true,objectId,uploadUrl,requiredHeaders:{"content-type":input.mimeType},
    expiresAtMs:now+UPLOAD_TTL_MS};
}
export async function voiceConfirm(db, env, uid, body) {
  const objectId=clean(body.objectId),raw=await objectRecord(db,objectId);
  if (raw.ownerUid!==uid)throw new VoiceMediaError("forbidden",403);
  await eligibility(db,uid,raw.otherUid,raw.conversationId);
  if (raw.state==="uploaded" || raw.state==="sent") {
    return {ok:true,objectId,code:"already_confirmed"};
  }
  if (raw.state!=="pending_upload")throw new VoiceMediaError("invalid_voice_state",409);
  if (new Date(raw.uploadExpiresAt).getTime()<Date.now()) {
    throw new VoiceMediaError("upload_ticket_expired",410);
  }
  const object=await env.USER_STORAGE?.head(raw.storageKey);
  if (!object || Number(object.size)!==raw.expectedSizeBytes ||
      (clean(object.httpMetadata?.contentType) &&
       clean(object.httpMetadata.contentType).toLowerCase()!==raw.mimeType)) {
    throw new VoiceMediaError("voice_upload_integrity_failed",409);
  }
  // Authoritatively parse 44 bytes from the private R2 object. Clients
  // cannot forge a 60-second duration by altering JSON metadata.
  if (typeof env.USER_STORAGE?.get !== "function") {
    throw new VoiceMediaError("r2_not_ready",503);
  }
  const head = await env.USER_STORAGE.get(raw.storageKey,{
    range:{offset:0,length:44},
  });
  if (!head || typeof head.arrayBuffer !== "function") {
    throw new VoiceMediaError("voice_upload_integrity_failed",409);
  }
  const header = new Uint8Array(await head.arrayBuffer());
  validateVoiceWavHeader(header,raw.expectedSizeBytes,raw.durationSeconds);
  return transactionRun(db,async tx=>{
    const current=await objectRecord(db,objectId,tx);
    if(current.ownerUid!==uid)throw new VoiceMediaError("forbidden",403);
    if(current.state==="sent"||current.state==="uploaded"){
      await db.rollback(tx); return {ok:true,objectId,code:"already_confirmed"};
    }
    if(current.state!=="pending_upload" ||
       new Date(current.uploadExpiresAt).getTime()<Date.now()){
      throw new VoiceMediaError("invalid_voice_state",409);
    }
    await db.commit(tx,[db.writeUpdate(objectPath(objectId),{
      state:"uploaded",confirmedAt:new Date(),
    },["state","confirmedAt"])]);
    return {ok:true,objectId,code:"ok"};
  });
}
export async function voiceSend(db,uid,body) {
  const {otherUid,conversationId}=details(body);
  const objectId=clean(body.objectId),key=clean(body.idempotencyKey);
  if(!objectIdPattern.test(objectId) || !/^[A-Za-z0-9_-]{12,220}$/.test(key)){
    throw new VoiceMediaError("invalid_voice_request");
  }
  return transactionRun(db,async tx=>{
    const opPath="message_operations/"+key;
    const op=await db.get(opPath,tx);
    if(op.exists){
      if(op.data?.action!=="sendVoiceNote" || op.data?.senderId!==uid ||
         op.data?.receiverId!==otherUid || op.data?.objectId!==objectId ||
         op.data?.conversationId!==conversationId){
        throw new VoiceMediaError("idempotency_conflict",409);
      }
      await db.rollback(tx);
      return {ok:true,code:"duplicate",messageId:op.data.messageId};
    }
    await eligibility(db,uid,otherUid,conversationId,tx);
    const raw=await objectRecord(db,objectId,tx);
    if(raw.ownerUid!==uid || raw.otherUid!==otherUid ||
       raw.conversationId!==conversationId || raw.state!=="uploaded" ||
       !validVoiceDuration(raw.durationSeconds)) {
      throw new VoiceMediaError("voice_object_not_sendable",409);
    }
    const ratePath="private_voice_rate/"+uid;
    const rate=await db.get(ratePath,tx);
    const nowMs=Date.now();
    const windowMs=60_000;
    const started=new Date(rate.data?.windowStartedAt||0).getTime();
    const same=Number.isFinite(started) && started>0 && nowMs-started<windowMs;
    const count=same?Math.max(0,Number(rate.data?.count||0)):0;
    if(count>=5)throw new VoiceMediaError("rate_limited",429);
    const other=await db.get("conversations/"+conversationId,tx);
    const unread={...(other.data?.unreadCounts||{})};
    unread[uid]=0; unread[otherUid]=Math.max(0,Number(unread[otherUid]||0))+1;
    const messageId="voice_"+crypto.randomUUID().replaceAll("-","");
    const now=new Date(nowMs);
    const writes=[
      db.writeUpdate("conversations/"+conversationId,{
        lastMessage:"🎤 رسالة صوتية",lastMessageId:messageId,
        lastSenderId:uid,updatedAt:now,unreadCounts:unread,
      },["lastMessage","lastMessageId","lastSenderId","updatedAt","unreadCounts"]),
      db.writeCreate(`conversations/${conversationId}/messages/${messageId}`,{
        type:"voice_note",senderId:uid,receiverId:otherUid,
        storageObjectId:objectId,mimeType:raw.mimeType,
        sizeBytes:raw.expectedSizeBytes,durationSeconds:raw.durationSeconds,
        createdAt:now,
      }),
      db.writeUpdate(objectPath(objectId),{
        state:"sent",messageId,sentAt:now,
      },["state","messageId","sentAt"]),
      db.writeDelete("private_voice_drafts/"+objectId),
      db.writeUpdate(ratePath,{
        windowStartedAt:new Date(same?started:nowMs),count:count+1,updatedAt:now,
      },["windowStartedAt","count","updatedAt"]),
      db.writeCreate(opPath,{
        action:"sendVoiceNote",senderId:uid,receiverId:otherUid,
        conversationId,objectId,messageId,createdAt:now,status:"completed",
      }),
    ];
    await db.commit(tx,writes);
    return {ok:true,code:"ok",messageId};
  });
}
export async function voiceRead(db,env,uid,body) {
  const objectId=clean(body.objectId),raw=await objectRecord(db,objectId);
  const peer=uid===raw.ownerUid?raw.otherUid:uid===raw.otherUid?raw.ownerUid:"";
  if (!peer)throw new VoiceMediaError("forbidden",403);
  await eligibility(db,uid,peer,raw.conversationId);
  if(raw.state!=="sent"||!validTextId(raw.messageId)) {
    throw new VoiceMediaError("voice_message_unavailable",404);
  }
  const message=await db.get(
    `conversations/${raw.conversationId}/messages/${raw.messageId}`);
  if(!message.exists || message.data?.type!=="voice_note" ||
     message.data?.deletedForEveryone===true ||
     message.data?.storageObjectId!==objectId ||
     message.data?.senderId!==raw.ownerUid ||
     message.data?.receiverId!==raw.otherUid) {
    throw new VoiceMediaError("voice_message_unavailable",404);
  }
  const readUrl=await presignR2Get(env,{
    key:raw.storageKey,expiresSeconds:DOWNLOAD_TTL_SECONDS,
  });
  return {ok:true,objectId,readUrl,expiresAtMs:Date.now()+DOWNLOAD_TTL_SECONDS*1000,
    mimeType:raw.mimeType,durationSeconds:raw.durationSeconds};
}
// Process only expired, unlinked drafts using the existing bounded Worker cron.
// A sent voice message has no draft queue entry, so it is never cleaned here.
export async function runPrivateVoiceDraftCleanup(env,{nowMs=Date.now(),limit=10}={}) {
  const db=firestoreClient(env);
  const max=Math.max(1,Math.min(10,Number(limit)||10));
  const drafts=await db.runQuery("private_voice_drafts",{
    filters:[{field:"expiresAt",op:"<=",value:new Date(nowMs)}],
    orderBy:[{field:"expiresAt",direction:"asc"}],
    limit:max,
  });
  let cleaned=0,failed=0;
  for(const draft of drafts) {
    const id=clean(draft.data?.objectId||draft.id);
    if(!objectIdPattern.test(id)) {failed++;continue;}
    try {
      const storageKey=clean(draft.data?.storageKey);
      const ready=await transactionRun(db,async tx=>{
        const [queue,meta]=await Promise.all([
          db.get("private_voice_drafts/"+id,tx),db.get(objectPath(id),tx),
        ]);
        if(!queue.exists){await db.rollback(tx);return false;}
        if(!meta.exists||meta.data?.state==="sent") {
          await db.commit(tx,[db.writeDelete("private_voice_drafts/"+id)]);
          return false;
        }
        if(meta.data?.storageKey!==storageKey ||
           !["pending_upload","uploaded","deleting"].includes(meta.data?.state)) {
          throw new VoiceMediaError("voice_cleanup_conflict",409);
        }
        if(meta.data.state!=="deleting"){
          await db.commit(tx,[db.writeUpdate(objectPath(id),{
            state:"deleting",deletingAt:new Date(nowMs),
          },["state","deletingAt"])]);
        }else{await db.rollback(tx);}
        return true;
      });
      if(!ready)continue;
      if(typeof env.USER_STORAGE?.delete!=="function"){
        throw new VoiceMediaError("r2_not_ready",503);
      }
      await env.USER_STORAGE.delete(storageKey);
      await db.commit(null,[
        db.writeDelete(objectPath(id)),
        db.writeDelete("private_voice_drafts/"+id),
      ]);
      cleaned++;
    }catch(e){failed++;}
  }
  return {checked:drafts.length,cleaned,failed};
}

export async function privateVoiceMedia(request,env) {
  if(request.method!=="POST")return json(request,env,{ok:false,code:"method_not_allowed"},405);
  try{
    const decoded=await verifyFirebaseIdToken(request,env);
    if(clean(decoded?.firebase?.sign_in_provider)==="anonymous"){
      throw new VoiceMediaError("registered_account_required",403);
    }
    const uid=clean(decoded.sub);
    if(!uid)throw new VoiceMediaError("unauthorized",401);
    const body=await readJson(request),action=clean(body.action);
    const db=firestoreClient(env);
    const result=action==="prepareUpload"?await voicePrepare(db,env,uid,body)
      :action==="confirmUpload"?await voiceConfirm(db,env,uid,body)
      :action==="send"?await voiceSend(db,uid,body)
      :action==="prepareRead"?await voiceRead(db,env,uid,body)
      :null;
    if(!result)throw new VoiceMediaError("invalid_action",400);
    return json(request,env,result,200);
  }catch(error) {
    const known=error instanceof VoiceMediaError || error instanceof PrivateVoicePolicyError;
    return json(request,env,{ok:false,code:known?error.code:"voice_media_unavailable"},
      known?error.status:500);
  }
}
