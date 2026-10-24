// Internal, intentionally unrouted erasure primitive for ONE already-enumerated
// private text message. This cannot perform financial, media or R2 deletion.
// The production preflight always has destructiveAllowed=false.
const clean = v => String(v ?? "").trim();
const validUid = v => /^[A-Za-z0-9_-]{3,128}$/.test(clean(v));
const validId = v => /^[A-Za-z0-9_-]{12,180}$/.test(clean(v));
const held = data => [
  data?.legalHold, data?.retentionHold, data?.deletionHold,
  data?.reviewHold, data?.evidenceHold, data?.reported,
].some(flag => flag === true);

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
    const [request,checkpoint,user,conversation,message,filterFlag] =
      await Promise.all([
        db.get("account_deletion_requests/"+uid,tx),
        db.get("account_deletion_erasure_checkpoints/"+uid,tx),
        db.get("users/"+uid,tx),
        db.get(conversationPath,tx),
        db.get(messagePath,tx),
        db.get("content_filter_flags/"+messageId,tx),
      ]);
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
        clean(user.data?.role)==="owner" ||
        held(request.data)||held(checkpoint.data)||held(user.data)) {
      throw new PrivateTextErasureError("private_text_erasure_blocked");
    }
    if (!conversation.exists || !Array.isArray(conversation.data?.participants) ||
        conversation.data.participants.length!==2 ||
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
    const tombstone={type:"deleted",deletedForEveryone:true,
      deletedAt:now,erasureRequestId:requestId};
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
