import 'package:flutter/material.dart';

import '../../../core/assets/shadow_asset_registry.dart';
import '../../profile/widgets/level_asset_image.dart';

class VipAvatarFrame extends StatelessWidget {
  const VipAvatarFrame({
    super.key,
    required this.vipLevel,
    required this.avatarDiameter,
    required this.child,
    this.resolveUri,
  });

  final int vipLevel;
  final double avatarDiameter;
  final Widget child;
  final LevelAssetUriResolver? resolveUri;

  @override
  Widget build(BuildContext context) {
    final level = vipLevel.clamp(0, 10).toInt();
    if (level <= 0) return child;

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
