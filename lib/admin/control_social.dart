abstract final class SocialPolicy {
 static const oneWayMessageLimit=3;
 static bool areFriends({required bool aFollowsB,required bool bFollowsA})=>aFollowsB&&bFollowsA;
 static bool canSend({required bool senderFollowsRecipient,required bool mutual,required int unansweredCount}){
  if(!senderFollowsRecipient)return false;
  return mutual||unansweredCount<oneWayMessageLimit;
 }
}
