abstract final class StorePolicy {
 static const categories={'frames','entranceEffects','profileCards','voiceWaves','chatBubbles','roomFrames','backgrounds'};
 static const durationsDays={3,7,30};
 static bool validCategory(String value)=>categories.contains(value);
 static bool validDuration(int? days,{bool permanent=false})=>permanent||(days!=null&&durationsDays.contains(days));
}
