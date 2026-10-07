import 'package:flutter/material.dart';

import '../../vip/widgets/vip_avatar_frame.dart';
import '../../vip/widgets/vip_profile_avatar.dart';
import '../../room/widgets/cosmetic_effect_widgets.dart';

class ProfileAvatarWithFrame extends StatelessWidget {
  const ProfileAvatarWithFrame({
    super.key,
    required this.diameter,
    required this.profile,
    this.vipLevel = 0,
    this.vipFrameLevel,
    this.backgroundColor = const Color(0xFF25183F),
    this.placeholderColor = const Color(0xFFFFD54A),
    this.placeholderIcon = Icons.person_rounded,
    this.useVipFallback = false,
    this.frameScale = 1.22,
  });

  final double diameter;
  final Map<String, dynamic> profile;
  final int vipLevel;
  final int? vipFrameLevel;
  final Color backgroundColor;
  final Color placeholderColor;
  final IconData placeholderIcon;
  final bool useVipFallback;
  final double frameScale;

  String _text(String key) => (profile[key] ?? '').toString().trim();

  bool get _frameActive {
    final key = _text('activeProfileFrameAssetKey');
    if (key.isEmpty) return false;
    if (profile['activeProfileFramePermanent'] == true) return true;
    final expiresAt =
        (profile['activeProfileFrameExpiresAtMs'] as num?)?.toInt() ??
            int.tryParse(_text('activeProfileFrameExpiresAtMs')) ??
            0;
    return expiresAt <= 0 || expiresAt > DateTime.now().millisecondsSinceEpoch;
  }

  Widget _baseAvatar() {
    final provider = effectiveProfileAvatarProvider(profile);
    return CircleAvatar(
      radius: diameter / 2,
      backgroundColor: backgroundColor,
      backgroundImage: provider,
      child: provider == null
          ? Icon(
              placeholderIcon,
              color: placeholderColor,
              size: diameter * .46,
            )
          : null,
    );
  }

  @override
  Widget build(BuildContext context) {
    final avatar = SizedBox.square(
      dimension: diameter,
      child: _baseAvatar(),
    );

    if (_frameActive) {
      final frameAssetKey = _text('activeProfileFrameAssetKey');
      final frameImageUrl = _text('activeProfileFrameImageUrl');
      final frameSize = diameter * frameScale;
      return SizedBox.square(
        dimension: frameSize,
        child: Stack(
          alignment: Alignment.center,
          clipBehavior: Clip.none,
          children: [
            avatar,
            Positioned.fill(
              child: IgnorePointer(
                child: AnimatedProfileFrameVisual(
                  assetKey: frameAssetKey,
                  imageUrl: frameImageUrl,
                ),
              ),
            ),
          ],
        ),
      );
    }

    if (useVipFallback && vipLevel > 0) {
      return VipAvatarFrame(
        vipLevel: vipLevel,
        frameLevel: vipFrameLevel,
        avatarDiameter: diameter,
        child: _baseAvatar(),
      );
    }

    return avatar;
  }
}

Map<String, dynamic> profileAvatarFrameData({
  String? imageUrl,
  String? avatarAsset,
  String? frameAssetKey,
  String? frameImageUrl,
  int? frameExpiresAtMs,
  bool framePermanent = false,
}) {
  return <String, dynamic>{
    if ((imageUrl ?? '').trim().isNotEmpty)
      'profileImageUrl': imageUrl!.trim(),
    if ((avatarAsset ?? '').trim().isNotEmpty)
      'profileAvatarAsset': avatarAsset!.trim(),
    if ((frameAssetKey ?? '').trim().isNotEmpty)
      'activeProfileFrameAssetKey': frameAssetKey!.trim(),
    if ((frameImageUrl ?? '').trim().isNotEmpty)
      'activeProfileFrameImageUrl': frameImageUrl!.trim(),
    if (frameExpiresAtMs != null)
      'activeProfileFrameExpiresAtMs': frameExpiresAtMs,
    if (framePermanent) 'activeProfileFramePermanent': true,
  };
}
