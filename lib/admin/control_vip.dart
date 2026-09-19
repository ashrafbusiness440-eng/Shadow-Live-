abstract final class VipEntitlementPolicy {
 static bool hideWealth(int level)=>level>=2;
 static bool hidePopularity(int level)=>level>=2;
 static bool hideUserLevel(int level)=>level>=3;
 static bool hideOnline(int level)=>level>=3;
 static bool hideCurrentRoom(int level)=>level>=4;
 static bool hideGamePkActivity(int level)=>level>=4;
 static bool hideVisitIdentity(int level)=>level>=5;
 static bool silentRoomEntry(int level)=>level>=5;
 static bool hideSocialCounts(int level)=>level>=5;
 static bool specialIdEligible(int level)=>level>=3;
 static void validateLevel(int level){if(level<0||level>5)throw ArgumentError('VIP level must be 0..5');}
}
