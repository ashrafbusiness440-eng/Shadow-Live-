import 'package:flutter/material.dart';

import '../../../core/assets/shadow_asset_registry.dart';

abstract final class VipCosmeticPolicy {
  static const int badgeLevel = 1;
  static const int chatBubbleLevel = 2;
  static const int styledNameLevel = 2;
  static const int profileFrameLevel = 3;
  static const int giftVisualLevel = 4;
  static const int profileBackgroundLevel = 5;
  static const int dataCardLevel = 5;
  static const int audioWaveLevel = 7;
  static const int entryStripLevel = 8;
  static const int profileDecorationLevel = 9;
  static const int nameEffectLevel = 10;

  static int normalizedLevel(int value) => value.clamp(0, 10);

  static String chatBubbleKey(int level) =>
      normalizedLevel(level) >= chatBubbleLevel
          ? ShadowAssetKeys.vipChatBubble(normalizedLevel(level))
          : '';

  static String giftVisualKey(int level) =>
      normalizedLevel(level) >= giftVisualLevel
          ? ShadowAssetKeys.vipGiftVisual(normalizedLevel(level))
          : '';

  static String profileBackgroundKey(int level) =>
      normalizedLevel(level) >= profileBackgroundLevel
          ? ShadowAssetKeys.vipProfileBackground(normalizedLevel(level))
          : '';

  static String dataCardKey(int level) =>
      normalizedLevel(level) >= dataCardLevel
          ? ShadowAssetKeys.vipDataCard(normalizedLevel(level))
          : '';

  static String profileDecorationKey(int level) =>
      normalizedLevel(level) >= profileDecorationLevel
          ? ShadowAssetKeys.vipProfileDecoration(normalizedLevel(level))
          : '';

  static String nameEffectKey(int level) =>
      normalizedLevel(level) >= nameEffectLevel
          ? ShadowAssetKeys.vipNameEffect(normalizedLevel(level))
          : '';

  static Color nameColor(int level, {required bool mine}) {
    final normalized = normalizedLevel(level);
    if (normalized >= nameEffectLevel) {
      return const Color(0xFFFFD166);
    }
    if (normalized >= styledNameLevel) {
      return mine
          ? const Color(0xFFFFD54A)
          : const Color(0xFFC9B1FF);
    }
    return mine
        ? const Color(0xFFFFD54A)
        : const Color(0xFFBFA5FF);
  }
}
