import 'dart:async';

import 'package:flutter/material.dart';

import '../../room/widgets/cosmetic_effect_widgets.dart';
import '../../vip/widgets/vip_avatar_frame.dart';
import '../../vip/widgets/vip_profile_avatar.dart';
import '../services/profile_visual_identity_service.dart';
import '../../store/services/store_visual_presentation_service.dart';
import '../../store/widgets/store_visual_expiry_gate.dart';

class ProfileAvatarWithFrame extends StatefulWidget {
  const ProfileAvatarWithFrame({
    super.key,
    required this.diameter,
    required this.userId,
    this.fallbackProfile = const <String, dynamic>{},
    this.fallbackIsVisualSnapshot = false,
    this.snapshotOnly = false,
    this.vipLevel = 0,
    this.vipFrameLevel,
    this.backgroundColor = const Color(0xFF25183F),
    this.placeholderColor = const Color(0xFFFFD54A),
    this.placeholderIcon = Icons.person_rounded,
    this.useVipFallback = false,
    this.frameScale = 1.22,
    this.protectAvatarCenter = false,
    this.verifyStoreFrame = false,
  });

  final double diameter;
  final String userId;
  final Map<String, dynamic> fallbackProfile;
  final bool fallbackIsVisualSnapshot;
  // Existing in-room seat/presence snapshots are already authoritative for
  // rendering. Skip separate profile loads and invalidation subscriptions.
  final bool snapshotOnly;
  final int vipLevel;
  final int? vipFrameLevel;
  final Color backgroundColor;
  final Color placeholderColor;
  final IconData placeholderIcon;
  final bool useVipFallback;
  final double frameScale;
  /// Profile header only. Keep ornate art away from the central face while
  /// preserving its animation and existing visual-identity cache.
  final bool protectAvatarCenter;
  /// Use only on full/quick profile headers to avoid per-avatar network fanout.
  final bool verifyStoreFrame;

  @override
  State<ProfileAvatarWithFrame> createState() => _ProfileAvatarWithFrameState();
}

class _ProfileAvatarWithFrameState extends State<ProfileAvatarWithFrame> {
  Future<ProfileVisualIdentity>? _future;
  Future<StoreVerifiedFrame?>? _storeFrameFuture;
  StreamSubscription<String>? _invalidationSub;

  @override
  void initState() {
    super.initState();
    if (widget.snapshotOnly) return;
    _invalidationSub =
        ProfileVisualIdentityService.instance.invalidations.listen((uid) {
      if (!mounted || uid != widget.userId.trim()) return;
      setState(() => _reload(allowPrime: false));
    });
    _reload();
  }

  @override
  void didUpdateWidget(covariant ProfileAvatarWithFrame oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.snapshotOnly) {
      _invalidationSub?.cancel();
      _invalidationSub = null;
      _future = null;
      return;
    }
    if (oldWidget.snapshotOnly) {
      _invalidationSub = ProfileVisualIdentityService.instance.invalidations
          .listen((uid) {
        if (!mounted || uid != widget.userId.trim()) return;
        setState(() => _reload(allowPrime: false));
      });
      _reload();
      return;
    }
    final snapshotChanged = widget.fallbackIsVisualSnapshot &&
        _snapshotSignature(oldWidget.fallbackProfile) !=
            _snapshotSignature(widget.fallbackProfile);
    if (oldWidget.userId != widget.userId || snapshotChanged ||
        oldWidget.verifyStoreFrame != widget.verifyStoreFrame) {
      _reload();
    }
  }

  @override
  void dispose() {
    _invalidationSub?.cancel();
    super.dispose();
  }

  String _snapshotSignature(Map<String, dynamic> profile) => <Object?>[
        profile['profileImageUrl'],
        profile['profileAvatarAsset'],
        profile['profileAvatarAnimationUrl'],
        profile['activeProfileFrameAssetKey'],
        profile['activeProfileFrameImageUrl'],
        profile['activeProfileFrameExpiresAtMs'],
        profile['activeProfileFramePermanent'],
      ].join('|');

  Future<StoreVerifiedFrame?> _loadStoreFrame(String uid) async {
    final service=StoreVisualPresentationService();
    try { return await service.loadFrame(uid); }
    finally { service.close(); }
  }

  void _reload({bool allowPrime = true}) {
    final uid = widget.userId.trim();
    _storeFrameFuture = widget.verifyStoreFrame && !widget.snapshotOnly &&
        uid.isNotEmpty
      ? _loadStoreFrame(uid)
      : null;
    if (widget.snapshotOnly) {
      _future = null;
      return;
    }
    if (uid.isEmpty) {
      _future = null;
      return;
    }
    final service = ProfileVisualIdentityService.instance;
    if (allowPrime && widget.fallbackIsVisualSnapshot) {
      service.prime(uid, widget.fallbackProfile);
    }
    _future = service.load(uid);
  }

  String _text(Map<String, dynamic> profile, String key) =>
      (profile[key] ?? '').toString().trim();

  bool _frameActive(Map<String, dynamic> profile,
      {bool verifiedStoreFrame = false}) {
    final key = _text(profile, 'activeProfileFrameAssetKey');
    if (key.isEmpty) return false;
    // Directly writable legacy profiles cannot grant a Store visual.
    // Room snapshots come from the server-verified presence admission.
    if (key.startsWith('store.item.') &&
        !verifiedStoreFrame && !widget.snapshotOnly) return false;
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
      // Foreground images cover the fallback icon only after successfully
      // loading. If a network URL/asset breaks, the shared default avatar
      // stays visible; no extra profile read, retry timer or listener.
      foregroundImage: provider,
      onForegroundImageError:
          provider == null ? null : (error, stackTrace) {},
      child: Icon(
        widget.placeholderIcon,
        color: widget.placeholderColor,
        size: widget.diameter * .46,
      ),
    );
  }

  // Center-safe profile artwork: the clipper leaves a circular cutout of
  // 84% of the avatar diameter. Keep the portrait within that cutout even
  // after nudging it down, so it cannot paint over the inner frame rim.
  // Room/seat avatars do not opt in and retain their original geometry.
  Widget _framedAvatar(Map<String, dynamic> profile) {
    if (!widget.protectAvatarCenter) return _baseAvatar(profile);
    return Padding(
      padding: EdgeInsets.all(widget.diameter * 0.11),
      child: Transform.translate(
        offset: Offset(0, widget.diameter * 0.025),
        child: ClipOval(child: _baseAvatar(profile)),
      ),
    );
  }

  Widget _render(Map<String, dynamic> profile,
      {bool verifiedStoreFrame = false}) {
    final avatar = SizedBox.square(
      dimension: widget.diameter,
      child: _framedAvatar(profile),
    );

    if (_frameActive(profile, verifiedStoreFrame: verifiedStoreFrame)) {
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
                child: ClipPath(
                  clipper: widget.protectAvatarCenter
                      ? AvatarFrameClearCenterClipper(
                          avatarDiameter: widget.diameter,
                        )
                      : null,
                  child: AnimatedProfileFrameVisual(
                    assetKey: frameAssetKey,
                    imageUrl: frameImageUrl,
                  ),
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
        protectAvatarCenter: widget.protectAvatarCenter,
        child: _framedAvatar(profile),
      );
    }

    return avatar;
  }

  Widget _renderWithVerifiedStoreFrame(Map<String, dynamic> profile) {
    final future = _storeFrameFuture;
    if (future == null) return _render(profile);
    return FutureBuilder<StoreVerifiedFrame?>(
      future: future,
      builder: (context, snapshot) {
        final frame = snapshot.data;
        if (frame == null || !frame.activeNow) return _render(profile);
        // Only this verified response may override the existing public frame.
        return StoreVisualExpiryGate(
          expiresAtMs: frame.expiresAtMs,
          builder: (context, active) => !active
              ? _render(profile)
              : _render(<String, dynamic>{
                  ...profile,
                  'activeProfileFrameAssetKey': frame.assetKey,
                  'activeProfileFrameImageUrl': frame.imageUrl,
                  'activeProfileFrameExpiresAtMs': frame.expiresAtMs ?? 0,
                  'activeProfileFramePermanent': frame.expiresAtMs == null,
                }, verifiedStoreFrame: true),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final fallback = widget.fallbackProfile;
    if (widget.snapshotOnly) return _render(fallback);
    final future = _future;
    if (future == null) return _renderWithVerifiedStoreFrame(fallback);

    return FutureBuilder<ProfileVisualIdentity>(
      future: future,
      builder: (context, snapshot) {
        final identity = snapshot.data;
        if (identity == null) return _renderWithVerifiedStoreFrame(fallback);

        final loaded = identity.toProfileMap();
        // Quick/public profiles already have a freshly fetched public record.
        // Do not let a cached room snapshot with an empty avatar override it.
        // Room snapshots keep the loaded identity authoritative instead.
        if (!widget.fallbackIsVisualSnapshot) {
          const avatarFields = <String>[
            'profileImageUrl',
            'profileAvatarAsset',
            'profileAvatarAnimationUrl',
            'photoUrl',
            'avatarUrl',
          ];
          final hasFreshAvatar = avatarFields.any(
            (field) => (fallback[field] ?? '').toString().trim().isNotEmpty,
          );
          if (hasFreshAvatar) {
            for (final field in avatarFields) {
              loaded[field] = fallback[field] ?? '';
            }
          }
        }
        return _renderWithVerifiedStoreFrame(
          <String, dynamic>{...fallback, ...loaded});
      },
    );
  }
}
