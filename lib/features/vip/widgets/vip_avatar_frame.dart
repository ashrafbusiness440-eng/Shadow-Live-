import 'package:flutter/material.dart';

import '../../../core/assets/shadow_asset_registry.dart';
import '../../profile/widgets/level_asset_image.dart';

class VipAvatarFrame extends StatelessWidget {
  const VipAvatarFrame({
    super.key,
    required this.vipLevel,
    required this.avatarDiameter,
    required this.child,
    this.frameLevel,
    this.resolveUri,
  });

  final int vipLevel;
  final int? frameLevel;
  final double avatarDiameter;
  final Widget child;
  final LevelAssetUriResolver? resolveUri;

  @override
  Widget build(BuildContext context) {
    final effectiveVip = vipLevel.clamp(0, 10).toInt();
    if (effectiveVip <= 0) return child;
    final selected = (frameLevel ?? effectiveVip).clamp(0, 10).toInt();
    final level = selected >= 3 && selected <= effectiveVip
        ? selected
        : effectiveVip;

    final frameSize = avatarDiameter * 1.22;
    return SizedBox.square(
      dimension: frameSize,
      child: Stack(
        alignment: Alignment.center,
        clipBehavior: Clip.none,
        children: [
          SizedBox.square(
            dimension: avatarDiameter,
            child: child,
          ),
          Positioned.fill(
            child: IgnorePointer(
              child: LevelAssetImage(
                assetKey: ShadowAssetKeys.vipProfileFrame(level),
                resolveUri: resolveUri,
                fit: BoxFit.contain,
                fallback: const SizedBox.shrink(),
              ),
            ),
          ),
        ],
      ),
    );
  }
}


class VipInlineBadge extends StatelessWidget {
  const VipInlineBadge({
    super.key,
    required this.vipLevel,
    this.micro = false,
    this.resolveUri,
  });

  final int vipLevel;
  final bool micro;
  final LevelAssetUriResolver? resolveUri;

  @override
  Widget build(BuildContext context) {
    final level = vipLevel.clamp(0, 10).toInt();
    if (level <= 0) return const SizedBox.shrink();

    final iconSize = micro ? 13.0 : 17.0;
    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: micro ? 5 : 7,
        vertical: micro ? 2 : 4,
      ),
      decoration: BoxDecoration(
        color: const Color(0xFF3A220F),
        borderRadius: BorderRadius.circular(99),
        border: Border.all(color: const Color(0x88FFD98A)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          SizedBox.square(
            dimension: iconSize,
            child: LevelAssetImage(
              assetKey: ShadowAssetKeys.vipLevelBadge(level),
              resolveUri: resolveUri,
              fit: BoxFit.contain,
              fallback: Icon(
                Icons.workspace_premium_rounded,
                size: iconSize,
                color: const Color(0xFFFFD98A),
              ),
            ),
          ),
          SizedBox(width: micro ? 3 : 4),
          Text(
            'VIP$level',
            textDirection: TextDirection.ltr,
            style: TextStyle(
              color: const Color(0xFFFFE2B5),
              fontSize: micro ? 8.5 : 10.5,
              fontWeight: FontWeight.w900,
            ),
          ),
        ],
      ),
    );
  }
}
