import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/profile/services/reward_inventory_service.dart';

void main() {
  test('permanent level rewards do not expire in the client model', () {
    const item = MyItemReward(
      docId: 'wealth',
      rewardId: 'level_wealth_lv26_30_vehicle',
      type: 'vehicle',
      nameAr: 'المركبة LV26–30',
      assetKey: 'levels.wealth.lv26_30.vehicle',
      imageUrl: '',
      expiresAtMs: 0,
      active: false,
      expired: false,
      permanent: true,
    );

    expect(item.permanent, isTrue);
    expect(item.remainingSeconds(), 0);
  });

  test('wealth level rewards are materialized server-side into inventory', () {
    final source = File(
      'cloudflare-worker/src/legacy-economy/reward-inventory.js',
    ).readAsStringSync();

    expect(source.contains('syncWealthLevelRewards'), isTrue);
    expect(source.contains('levelFromPoints'), isTrue);
    expect(source.contains('source: "level_wealth"'), isTrue);
    expect(source.contains('levels.wealth.'), isTrue);
    expect(source.contains('wealthRewardSyncedBucketIndex'), isTrue);
    expect(source.contains('WEALTH_REWARD_SCHEMA_VERSION'), isTrue);
    expect(source.contains('limit(200)'), isTrue);

    for (final type in <String>[
      'wealth_badge',
      'upgrade_announcement',
      'entrance',
      'chat_bubble',
      'frame',
      'support_bar',
      'gift_privilege',
      'entry_bar',
      'vehicle',
    ]) {
      expect(source.contains('"$type"'), isTrue, reason: type);
    }
  });

  test('My Items exposes one grouped section for wealth level privileges', () {
    final source = File(
      'lib/features/profile/screens/my_items_screen.dart',
    ).readAsStringSync();

    expect(source.contains("'level_privileges'"), isTrue);
    expect(source.contains("'امتيازات المستوى'"), isTrue);
    expect(source.contains("_levelPrivilegeTypes.contains(item.type)"), isTrue);
    expect(source.contains("if (item.permanent) return 'دائم';"), isTrue);

    for (final type in <String>[
      'wealth_badge',
      'upgrade_announcement',
      'chat_bubble',
      'support_bar',
      'gift_privilege',
      'entry_bar',
      'vehicle',
    ]) {
      expect(source.contains("'$type'"), isTrue, reason: type);
    }
  });
}
