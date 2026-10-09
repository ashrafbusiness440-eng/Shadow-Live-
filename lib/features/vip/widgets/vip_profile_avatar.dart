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

  final photo = (data['profileImageUrl'] ?? '').toString().trim();
  if (photo.isNotEmpty) return NetworkImage(photo);

  final asset = (data['profileAvatarAsset'] ?? '').toString().trim();
  if (asset.isNotEmpty) return AssetImage(asset);

  // Older profiles may store their photo under a legacy key. Empty values
  // must not block an available legacy image, or hide a selected asset.
  for (final field in const <String>['photoUrl', 'avatarUrl']) {
    final legacyPhoto = (data[field] ?? '').toString().trim();
    if (legacyPhoto.isNotEmpty) return NetworkImage(legacyPhoto);
  }
  return null;
}
