import 'package:flutter/material.dart';

import '../../room/widgets/cosmetic_effect_widgets.dart';
import '../../vip/widgets/vip_avatar_frame.dart';
import '../../vip/widgets/vip_profile_avatar.dart';
import '../services/profile_visual_identity_service.dart';

class ProfileAvatarWithFrame extends StatefulWidget {
  const ProfileAvatarWithFrame({
    super.key,
    required this.diameter,
    required this.userId,
    this.fallbackProfile = const <String, dynamic>{},
    this.vipLevel = 0,
    this.vipFrameLevel,
    this.backgroundColor = const Color(0xFF25183F),
    this.placeholderColor = const Color(0xFFFFD54A),
    this.placeholderIcon = Icons.person_rounded,
    this.useVipFallback = false,
    this.frameScale = 1.22,
  });

  final double diameter;
  final String userId;
  final Map<String, dynamic> fallbackProfile;
  final int vipLevel;
  final int? vipFrameLevel;
  final Color backgroundColor;
  final Color placeholderColor;
  final IconData placeholderIcon;
  final bool useVipFallback;
  final double frameScale;

  @override
  State<ProfileAvatarWithFrame> createState() => _ProfileAvatarWithFrameState();
}

class _ProfileAvatarWithFrameState extends State<ProfileAvatarWithFrame> {
  Future<ProfileVisualIdentity>? _future;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  @override
  void didUpdateWidget(covariant ProfileAvatarWithFrame oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.userId != widget.userId) {
      _reload();
    }
  }

  void _reload() {
    final uid = widget.userId.trim();
    _future = uid.isEmpty
        ? null
        : ProfileVisualIdentityService.instance.load(uid);
  }

  String _text(Map<String, dynamic> profile, String key) =>
      (profile[key] ?? '').toString().trim();

  bool _frameActive(Map<String, dynamic> profile) {
    final key = _text(profile, 'activeProfileFrameAssetKey');
    if (key.isEmpty) return false;
    if (profile['activeProfileFramePermanent'] == true) return true;
    final expiresAt =
        (profile['activeProfileFrameExpiresAtMs'] as num?)?.toInt() ??
            int.tryParse(
              _text(profile, 'activeProfileFrameExpiresAtMs'),
            ) ??
            0;
    return expiresAt <= 0 ||
        expiresAt > DateTime.now().millisecondsSinceEpoch;
  }

  Widget _baseAvatar(Map<String, dynamic> profile) {
    final provider = effectiveProfileAvatarProvider(profile);
    return CircleAvatar(
      radius: widget.diameter / 2,
      backgroundColor: widget.backgroundColor,
      backgroundImage: provider,
      child: provider == null
          ? Icon(
              widget.placeholderIcon,
              color: widget.placeholderColor,
              size: widget.diameter * .46,
            )
          : null,
    );
  }

  Widget _render(Map<String, dynamic> profile) {
    final avatar = SizedBox.square(
      dimension: widget.diameter,
      child: _baseAvatar(profile),
    );

    if (_frameActive(profile)) {
      final frameAssetKey =
          _text(profile, 'activeProfileFrameAssetKey');
      final frameImageUrl =
          _text(profile, 'activeProfileFrameImageUrl');
      final frameSize = widget.diameter * widget.frameScale;
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

    if (widget.useVipFallback && widget.vipLevel > 0) {
      return VipAvatarFrame(
        vipLevel: widget.vipLevel,
        frameLevel: widget.vipFrameLevel,
        avatarDiameter: widget.diameter,
        child: _baseAvatar(profile),
      );
    }

    return avatar;
  }

  @override
  Widget build(BuildContext context) {
    final fallback = widget.fallbackProfile;
    final future = _future;
    if (future == null) return _render(fallback);

    return FutureBuilder<ProfileVisualIdentity>(
      future: future,
      builder: (context, snapshot) {
        final identity = snapshot.data;
        if (identity == null) return _render(fallback);

        return _render(<String, dynamic>{
          ...fallback,
          ...identity.toProfileMap(),
        });
      },
    );
  }
}
