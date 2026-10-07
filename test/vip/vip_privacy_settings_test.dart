import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('VIP privacy settings is the single settings integration surface', () {
    final settings =
        File('lib/screens/settings/settings_screen.dart').readAsStringSync();
    final privacy = File(
      'lib/screens/settings/vip_privacy_settings_screen.dart',
    ).readAsStringSync();

    expect(settings.contains("'إعداد التخفي'"), isTrue);
    expect(settings.contains('VipPrivacySettingsScreen'), isTrue);
    expect(settings.contains('VipScreen'), isTrue);

    expect(privacy.contains("'vip-privacy-hide-wealth'"), isTrue);
    expect(privacy.contains("'vip-privacy-hide-attraction'"), isTrue);
    expect(privacy.contains("'vip-privacy-hide-games'"), isTrue);
    expect(privacy.contains("'vip-privacy-hide-presence'"), isTrue);
    expect(privacy.contains("'vip-privacy-hidden-entry'"), isTrue);
    expect(privacy.contains("'vip-privacy-hide-ranking-lists'"), isTrue);
    expect(privacy.contains("'vip-privacy-friends-only-messages'"), isTrue);
    expect(privacy.contains("'vip-privacy-hide-profile-visits'"), isTrue);
    expect(privacy.contains("'vip-privacy-hide-noble-level'"), isTrue);
    expect(privacy.contains("'vip-privacy-hide-game-win-banner'"), isTrue);
    expect(
      privacy.contains("'vip-privacy-hide-bet-win-notification'"),
      isTrue,
    );
    expect(privacy.contains("'vip-profile-visit-history'"), isTrue);
    expect(privacy.contains("'mysterious-person-entry'"), isTrue);
    expect(privacy.contains('MysteriousPersonScreen'), isTrue);

    expect(privacy.contains('_levels.updateVisibility('), isTrue);
    expect(privacy.contains('_rooms.setGhostMode(enabled)'), isTrue);
    expect(privacy.contains('_rooms.setHiddenEntry(enabled)'), isTrue);
    expect(privacy.contains('_vip.setHideRankingLists(enabled)'), isTrue);
    expect(privacy.contains('_vip.setHideProfileVisits(enabled)'), isTrue);
    expect(privacy.contains('_vip.setFriendsOnlyMessages(enabled)'), isTrue);
    expect(privacy.contains('_vip.setVip4PrivacyPreference('), isTrue);
    expect(privacy.contains('_mysterious.setEnabled(enabled)'), isTrue);

    // Privacy settings must reuse bounded server APIs. No Firestore listener,
    // direct user-document write, polling, or duplicated room hot-path IO.
    expect(privacy.contains('FirebaseFirestore'), isFalse);
    expect(privacy.contains('.snapshots()'), isFalse);
    expect(privacy.contains('Timer.periodic'), isFalse);
  });

  test('Hidden Entry remains absent from Room Menu', () {
    final main = File('lib/main.dart').readAsStringSync();
    expect(main.contains("'الدخول المخفي'"), isFalse);
  });
}
