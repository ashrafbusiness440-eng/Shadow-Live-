import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/core/assets/shadow_asset_registry.dart';

void main() {
  test('Stage 08 level asset keys map Wealth tiers exactly', () {
    expect(
      ShadowAssetKeys.levelMainBadge('wealth', 1),
      'levels.wealth.lv01_05.mainBadge',
    );
    expect(
      ShadowAssetKeys.levelMiniBadge('wealth', 5),
      'levels.wealth.lv01_05.wealthBadge',
    );
    expect(
      ShadowAssetKeys.levelMainBadge('wealth', 6),
      'levels.wealth.lv06_10.mainBadge',
    );
    expect(
      ShadowAssetKeys.levelMiniBadge('wealth', 35),
      'levels.wealth.lv31_35.wealthBadge',
    );
  });

  test('Stage 08 level asset keys map Attraction tiers exactly', () {
    expect(
      ShadowAssetKeys.levelMainBadge('attraction', 1),
      'levels.attraction.lv01_05.mainBadge',
    );
    expect(
      ShadowAssetKeys.levelMiniBadge('attraction', 17),
      'levels.attraction.lv16_20.miniBadge',
    );
    expect(
      ShadowAssetKeys.levelMainBadge('attraction', 35),
      'levels.attraction.lv31_35.mainBadge',
    );
  });

  test('Stage 08 level asset keys map Game tiers exactly', () {
    expect(
      ShadowAssetKeys.levelMainBadge('game', 1),
      'levels.game.lv01_03.mainBadge',
    );
    expect(
      ShadowAssetKeys.levelMiniBadge('game', 4),
      'levels.game.lv04_06.miniBadge',
    );
    expect(
      ShadowAssetKeys.levelMainBadge('game', 21),
      'levels.game.lv19_21.mainBadge',
    );
  });

  test('Stage 08 invalid levels never invent an asset key', () {
    expect(ShadowAssetKeys.levelMainBadge('wealth', 0), isNull);
    expect(ShadowAssetKeys.levelMainBadge('wealth', 36), isNull);
    expect(ShadowAssetKeys.levelMainBadge('game', 22), isNull);
    expect(ShadowAssetKeys.levelMainBadge('unknown', 1), isNull);
  });
}
