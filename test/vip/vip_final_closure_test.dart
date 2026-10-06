import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/admin/control_vip.dart';
import 'package:voice_chat_room/core/assets/shadow_asset_registry.dart';

void main() {
  test('VIP official cumulative benefit count is exactly 38', () {
    const expected = <int>[0, 3, 7, 10, 16, 21, 23, 27, 28, 32, 38];
    for (var level = 0; level <= 10; level++) {
      expect(
        VipEntitlementPolicy.cumulativeBenefitCount(level),
        expected[level],
        reason: 'VIP$level cumulative count changed',
      );
    }
  });

  test('Batch H legacy aliases normalize into canonical vip.vN namespace', () {
    expect(
      ShadowAssetKeys.canonicalizeVipAssetKey('vip.vip1.mainEmblem'),
      'vip.v1.mainBadge',
    );
    expect(
      ShadowAssetKeys.canonicalizeVipAssetKey('vip.vip10.badgeMini'),
      'vip.v10.miniBadge',
    );
    expect(
      ShadowAssetKeys.canonicalizeVipAssetKey('vip.vip9.roomEntryBanner'),
      'vip.v9.roomEntryBanner',
    );
    expect(
      ShadowAssetKeys.canonicalizeVipAssetKey('vip.v4.badge'),
      'vip.v4.badge',
    );
  });

  test('Batch H manifest has no vehicles and keeps entry assets', () {
    for (var level = 1; level <= 10; level++) {
      final keys = ShadowAssetKeys.vipBatchHKeys(level);
      expect(keys, isNotEmpty);
      expect(keys.toSet().length, keys.length);
      expect(
        keys.any((key) => key.toLowerCase().contains('vehicle')),
        isFalse,
      );
    }

    expect(
      ShadowAssetKeys.vipBatchHKeys(3),
      contains(ShadowAssetKeys.vipFancyIdPlate(3)),
    );
    expect(
      ShadowAssetKeys.vipBatchHKeys(4),
      contains(ShadowAssetKeys.vipEmojiPack(4)),
    );
    expect(
      ShadowAssetKeys.vipBatchHKeys(8),
      contains(ShadowAssetKeys.vipEntryStrip(8)),
    );
    expect(
      ShadowAssetKeys.vipBatchHKeys(10),
      contains(ShadowAssetKeys.vipGlobalEntryBanner(10)),
    );
    expect(
      ShadowAssetKeys.vipBatchHKeys(10),
      contains(ShadowAssetKeys.vipDynamicFx(10)),
    );
  });

  test('VIP cosmetic runtime is cached and Asset Studio preserves motion', () {
    final runtime = File(
      'lib/features/vip/widgets/vip_cosmetic_asset.dart',
    ).readAsStringSync();
    final manager = File(
      'lib/admin/control_asset_manager_page.dart',
    ).readAsStringSync();
    final policy =
        File('lib/admin/control_vip.dart').readAsStringSync();

    expect(runtime, contains('CachedNetworkImage'));
    expect(runtime, isNot(contains('Image.network(')));
    expect(manager, contains('decoded.numFrames > 1'));
    expect(manager, contains('Animated Preview'));

    expect(policy, isNot(contains('static bool vehicle(')));
    expect(policy, isNot(contains('profileVehicleDisplay')));
    expect(policy, isNot(contains('specialVehicle')));
    expect(policy, contains('entryStrip'));
  });
}
