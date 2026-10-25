import { accountDeletionHasActiveHold as held } from "./account-deletion-active-holds.js";
import { recheckErasureCertificatesInTransaction }
  from "./account-deletion-erasure-transactional-cert-gate.js";
// Internal, intentionally unrouted erasure primitive for ONE already-enumerated
// private text message. This cannot perform financial, media or R2 deletion.
// The production preflight always has destructiveAllowed=false.
const clean = v => String(v ?? "").trim();
const validUid = v => /^[A-Za-z0-9_-]{3,128}$/.test(clean(v));
const validId = v => /^[A-Za-z0-9_-]{12,180}$/.test(clean(v));


export class PrivateTextErasureError extends Error {
  constructor(code, status=409) { super(code); this.code=code; this.status=status; }
}
const safeTextTypes = new Set(["text", "animated_emoji"]);
const messageIdentityKeys = new Set([
  "senderId","receiverId","createdAt","type","deletedForEveryone",
  "deletedAt","erasureRequestId","hiddenForUids",
]);
const redactableTextKeys = new Set([
  "text","vipLevel","animatedEmojiId","animatedEmojiAssetKey",
  "animatedEmojiFallbackGlyph","animatedEmojiMinVipLevel",
]);

// All unidentified legacy fields require schema-specific legal review
// instead of silently wiping evidence or retaining unknown private data.
function assertKnownTextSchema(message) {
  for (const key of Object.keys(message || {})) {
    if (!messageIdentityKeys.has(key) && !redactableTextKeys.has(key)) {
      throw new PrivateTextErasureError("unknown_private_message_fields");
    }
  }
}

export async function redactDeletedPrivateTextMessage(db, {
  uid, requestId, conversationId, messageId, now = new Date(),
} = {}) {
  if (!validUid(uid) || !validId(requestId) ||
      !validId(conversationId) || !validId(messageId) ||
      !(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new PrivateTextErasureError("invalid_private_erasure_target",400);
  }
  const conversationPath="conversations/"+conversationId;
  const messagePath=conversationPath+"/messages/"+messageId;
  const tx=await db.beginTransaction();
  try {
    // One bounded, transaction-scoped batchGet. Do not turn missing or
    // truncated Firestore REST rows into seemingly absent moderation evidence.
    const paths=[
      "account_deletion_requests/"+uid,
      "account_deletion_erasure_checkpoints/"+uid,
      "users/"+uid,
      conversationPath,
      messagePath,
      "content_filter_flags/"+messageId,
    ];
    const snapshots=typeof db.getMany==="function"
      ? await db.getMany(paths,tx)
      : await Promise.all(paths.map(path=>db.get(path,tx)));
    if (!Array.isArray(snapshots) || snapshots.length!==paths.length ||
        snapshots.some(doc=>!doc || typeof doc.exists!=="boolean")) {
      throw new PrivateTextErasureError("private_text_transaction_read_failed",503);
    }
    const [request,checkpoint,user,conversation,message,filterFlag]=snapshots;
    if (!request.exists || !checkpoint.exists || !user.exists ||
        clean(request.data?.uid)!==uid ||
        clean(request.data?.requestId)!==requestId ||
        clean(checkpoint.data?.requestId)!==requestId ||
        clean(request.data?.status)!=="processing" ||
        clean(checkpoint.data?.phase)!=="private_text" ||
        checkpoint.data?.destructiveAllowed!==true ||
        checkpoint.data?.privateMessageRetentionCleared!==true ||
        checkpoint.data?.legalEvidenceReviewComplete!==true ||
        clean(user.data?.accountStatus)!=="deletion_processing" ||
        clean(user.data?.role)==="owner" || user.data?.authDeleted===true ||
        held(request.data)||held(checkpoint.data)||held(user.data)) {
      throw new PrivateTextErasureError("private_text_erasure_blocked");
    }
    // This same transaction contains the six approval+immutable-audit
    // reads AND any masked text/preview writes. A revoked financial, Play,
    // legal, media or retention signoff cannot be hidden by the earlier
    // nontransactional batch preflight, or by a duplicate tombstone.
    await recheckErasureCertificatesInTransaction(db,tx,{
      uid,requestId,requestedAt:request.data?.requestedAt,nowMs:now.getTime(),
    });
    if (!conversation.exists || held(conversation.data) ||
        !Array.isArray(conversation.data?.participants) ||
        conversation.data.participants.length!==2 ||
        new Set(conversation.data.participants).size!==2 ||
        !conversation.data.participants.includes(uid) ||
        !conversation.data.participants.every(validUid)) {
      throw new PrivateTextErasureError("private_conversation_invalid");
    }
    if (!message.exists) {
      await db.rollback(tx);
      return {ok:true,redacted:false,duplicate:true};
    }
    const data=message.data||{};
    if (clean(data.senderId)!==uid ||
        !conversation.data.participants.includes(clean(data.receiverId)) ||
        clean(data.receiverId)===uid) {
      // Never erase the other participant's messages.
      throw new PrivateTextErasureError("private_message_owner_mismatch");
    }
    if (filterFlag.exists || held(data)) {
      throw new PrivateTextErasureError("protected_private_message");
    }
    if (data.deletedForEveryone===true && data.type==="deleted" &&
        data.erasureRequestId===requestId &&
        ![...redactableTextKeys].some(key => key in data)) {
      await db.rollback(tx);
      return {ok:true,redacted:false,duplicate:true};
    }
    if (!safeTextTypes.has(clean(data.type))) {
      // Media, voice, gifts and room invitations use independent retention plans.
      throw new PrivateTextErasureError("private_message_type_requires_review");
    }
    assertKnownTextSchema(data);
    const tombstone={
      senderId:uid,receiverId:clean(data.receiverId),
      ...(data.createdAt != null ? {createdAt:data.createdAt} : {}),
      ...(Array.isArray(data.hiddenForUids) ? {
        hiddenForUids:data.hiddenForUids.filter(x =>
          conversation.data.participants.includes(x)),
      } : {}),
      type:"deleted",deletedForEveryone:true,
      deletedAt:now,erasureRequestId:requestId,
    };
    // The existing document retains routing metadata for the counterparty.
    // Omitted text/emoji fields in the field mask are deleted at rest.
    const fieldMask=[
      ...new Set([...Object.keys(data),...Object.keys(tombstone)]),
    ];
    const writes=[db.writeMaskedUpdate(messagePath,tombstone,fieldMask)];
    if (clean(conversation.data?.lastSenderId)===uid) {
      writes.push(db.writeUpdate(conversationPath,{
        lastMessage:"رسالة من حساب محذوف",
      },["lastMessage"]));
    }
    await db.commit(tx,writes);
    return {ok:true,redacted:true,duplicate:false};
  } catch(error) {
    await db.rollback(tx).catch(()=>{});
    throw error;
  }
}
