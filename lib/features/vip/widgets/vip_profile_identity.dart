import 'package:flutter/material.dart';

import '../utils/vip_cosmetic_policy.dart';
import 'vip_cosmetic_asset.dart';

class VipProfileIdentitySurface extends StatelessWidget {
  const VipProfileIdentitySurface({
    super.key,
    required this.vipLevel,
    required this.child,
    this.borderRadius = BorderRadius.zero,
    this.backgroundOpacity = .24,
    this.dataCardOpacity = .34,
    this.decorationOpacity = .58,
  });

  final int vipLevel;
  final Widget child;
  final BorderRadius borderRadius;
  final double backgroundOpacity;
  final double dataCardOpacity;
  final double decorationOpacity;

  @override
  Widget build(BuildContext context) {
    final level = VipCosmeticPolicy.normalizedLevel(vipLevel);
    final backgroundKey = VipCosmeticPolicy.profileBackgroundKey(level);
    final dataCardKey = VipCosmeticPolicy.dataCardKey(level);
    final decorationKey = VipCosmeticPolicy.profileDecorationKey(level);
    if (backgroundKey.isEmpty &&
        dataCardKey.isEmpty &&
        decorationKey.isEmpty) {
      return child;
    }

    return ClipRRect(
      borderRadius: borderRadius,
      child: Stack(
        fit: StackFit.passthrough,
        children: [
          child,
          if (backgroundKey.isNotEmpty)
            Positioned.fill(
              child: VipCosmeticAssetLayer(
                assetKey: backgroundKey,
                fit: BoxFit.cover,
                opacity: backgroundOpacity,
              ),
            ),
          if (dataCardKey.isNotEmpty)
            Positioned.fill(
              child: VipCosmeticAssetLayer(
                assetKey: dataCardKey,
                fit: BoxFit.fill,
                opacity: dataCardOpacity,
              ),
            ),
          if (decorationKey.isNotEmpty)
            Positioned.fill(
              child: VipCosmeticAssetLayer(
                assetKey: decorationKey,
                fit: BoxFit.fill,
                opacity: decorationOpacity,
              ),
            ),
        ],
      ),
    );
  }
}

class VipStyledName extends StatelessWidget {
  const VipStyledName({
    super.key,
    required this.vipLevel,
    required this.name,
    required this.style,
    this.textAlign,
    this.maxLines = 1,
    this.overflow = TextOverflow.ellipsis,
  });

  final int vipLevel;
  final String name;
  final TextStyle style;
  final TextAlign? textAlign;
  final int maxLines;
  final TextOverflow overflow;

  @override
  Widget build(BuildContext context) {
    final level = VipCosmeticPolicy.normalizedLevel(vipLevel);
    final effectKey = VipCosmeticPolicy.nameEffectKey(level);
    final text = Text(
      name,
      textAlign: textAlign,
      maxLines: maxLines,
      overflow: overflow,
      style: style.copyWith(
        color: level >= VipCosmeticPolicy.styledNameLevel
            ? VipCosmeticPolicy.nameColor(level, mine: false)
            : style.color,
      ),
    );
    if (effectKey.isEmpty) return text;

    return Stack(
      alignment: Alignment.center,
      children: [
        Positioned.fill(
          child: VipCosmeticAssetLayer(
            assetKey: effectKey,
            fit: BoxFit.fill,
            opacity: .82,
          ),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
          child: text,
        ),
      ],
    );
  }
}
