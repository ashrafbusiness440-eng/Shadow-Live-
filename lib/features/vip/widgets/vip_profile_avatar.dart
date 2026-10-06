import 'package:flutter/widgets.dart';

import '../utils/vip_public_state.dart';

ImageProvider? effectiveProfileAvatarProvider(
  Map<String, dynamic> data, {
  int? effectiveVipLevel,
}) {
  final vip = effectiveVipLevel ?? effectivePublicVipLevel(data);
  final animated =
      (data['profileAvatarAnimationUrl'] ?? '').toString().trim();
  if (vip >= 4 && animated.isNotEmpty) {
    return NetworkImage(animated);
  }

  final photo =
      (data['profileImageUrl'] ?? data['avatarUrl'] ?? '').toString().trim();
  if (photo.isNotEmpty) return NetworkImage(photo);

  final asset = (data['profileAvatarAsset'] ?? '').toString().trim();
  if (asset.isNotEmpty) return AssetImage(asset);
  return null;
}
