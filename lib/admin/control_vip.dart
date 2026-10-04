abstract final class VipEntitlementPolicy {
  static const int minLevel = 0;
  static const int maxLevel = 10;

  static bool hasVip(int level) => level >= 1;
  static bool hasBadge(int level) => level >= 1;
  static bool vipCustomerService(int level) => level >= 1;
  static bool viewProfileVisits(int level) => level >= 1;

  static bool priorityOnlineList(int level) => level >= 2;
  static bool customNameColor(int level) => level >= 2;
  static bool unlimitedGreetings(int level) => level >= 2;
  static bool chatBubble(int level) => level >= 2;

  static bool hideLevels(int level) => level >= 3;
  static bool specialIdEligible(int level) => level >= 3;
  static bool profileFrame(int level) => level >= 3;

  static bool vipGifts(int level) => level >= 4;
  static bool exclusiveCustomerService(int level) => level >= 4;
  static bool levelProtection(int level) => level >= 4;
  static bool exclusiveEmoji(int level) => level >= 4;
  static bool animatedProfileAvatar(int level) => level >= 4;
  static bool hideWinMessageNotifications(int level) => level >= 4;

  static bool dataCard(int level) => level >= 5;
  static bool globalLevelUpgradeBroadcast(int level) => level >= 5;
  static bool hideOnline(int level) => level >= 5;
  static bool customGifts(int level) => level >= 5;
  static bool profileBackground(int level) => level >= 5;

  static bool vehicle(int level) => level >= 6;
  static bool kickProtection(int level) => level >= 6;
  static bool customizableProfileFrame(int level) => level >= 6;

  static bool extendedValidity(int level) => level >= 7;
  static bool silentRoomEntry(int level) => level >= 7;
  static bool hideCurrentRoom(int level) => level >= 7;
  static bool audioWave(int level) => level >= 7;

  static bool profileVehicleDisplay(int level) => level >= 8;
  static bool entryStrip(int level) => level >= 8;
  static bool specialVehicle(int level) => level >= 8;

  static bool hideVisitIdentity(int level) => level >= 9;
  static bool roomEntryBroadcast(int level) => level >= 9;
  static bool vipProfileBackground(int level) => level >= 9;
  static bool profileDecoration(int level) => level >= 9;

  static bool muteProtection(int level) => level >= 10;
  static bool customNameEffects(int level) => level >= 10;
  static bool vipTrialCard(int level) => level >= 10;
  static bool extraVipBadge(int level) => level >= 10;
  static bool globalAppEntryBanner(int level) => level >= 10;
  static bool vipGiftDecoration(int level) => level >= 10;

  static void validateLevel(int level) {
    if (level < minLevel || level > maxLevel) {
      throw ArgumentError('VIP level must be 0..10');
    }
  }
}
