import 'package:flutter/material.dart';

ImageProvider<Object>? agencyUserAvatarProvider({
  String? imageUrl,
  String? avatarAsset,
}) {
  final networkUrl = imageUrl?.trim() ?? '';
  if (networkUrl.isNotEmpty) {
    return NetworkImage(networkUrl);
  }

  final asset = avatarAsset?.trim() ?? '';
  if (asset.isNotEmpty) {
    return AssetImage(asset);
  }

  return null;
}
