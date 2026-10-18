import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('default room wallpaper is published Asset Studio key with offline asset', () {
    final registry =
        File('lib/core/assets/shadow_asset_registry.dart').readAsStringSync();
    final room = File('lib/main.dart').readAsStringSync();
    final pubspec = File('pubspec.yaml').readAsStringSync();

    expect(registry, contains("roomDefaultBackground = 'room.background.default'"));
    expect(
      registry,
      contains("'assets/images/rooms/shadow_room_default.png'"),
    );
    expect(
      File('assets/images/rooms/shadow_room_default.png').existsSync(),
      isTrue,
    );
    expect(pubspec, contains('assets/images/rooms/'));
    expect(
      room,
      contains('ShadowAssetKeys.roomDefaultBackgroundBundledPath'),
    );
    expect(room, contains('ShadowAssetKeys.roomDefaultBackground'));
  });

  test('equipped room background has priority, with default on all failures', () {
    final room = File('lib/main.dart').readAsStringSync();
    final start = room.indexOf('Widget _buildRoomBackground({');
    final end = room.indexOf('@override\n  Widget build(BuildContext context)', start);
    expect(start, greaterThan(0));
    expect(end, greaterThan(start));
    final background = room.substring(start, end);

    expect(background, contains('if (rewardImageUrl.isNotEmpty)'));
    expect(background, contains('if (rewardAssetKey.isNotEmpty)'));
    expect(
      background.indexOf('if (rewardImageUrl.isNotEmpty)'),
      lessThan(background.indexOf('if (rewardAssetKey.isNotEmpty)')),
    );
    expect(background, contains('return publishedDefault();'));
    expect(background, contains('errorBuilder: (_, __, ___) => publishedDefault()'));
    expect(background, contains('errorBuilder: (_, __, ___) => bundledDefault()'));
    expect(background, contains('return bundledDefault();'));
    expect(
      background,
      contains('_defaultRoomBackgroundFuture ??='),
    );
    expect(background, contains('const Duration(seconds: 8)'));
  });

  test('room background expires before a skin is applied', () {
    final room = File('lib/main.dart').readAsStringSync();
    expect(room, contains('final rewardBackgroundValid = hasRewardBackground &&'));
    expect(
      room,
      contains('rewardBackgroundValid ? rawRewardBackgroundImageUrl :'),
    );
    expect(
      room,
      contains('rewardBackgroundValid ? rawRewardBackgroundAssetKey :'),
    );
    // Background fetching only concerns presentation, not room audio/seat state.
    expect(room, contains('RoomEffectCoordinatorHost('));
    expect(room, contains('child: _buildRoomBackground('));
  });
}
