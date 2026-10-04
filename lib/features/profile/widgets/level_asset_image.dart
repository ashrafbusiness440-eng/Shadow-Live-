import 'package:flutter/material.dart';

import '../../../core/assets/shadow_asset_registry.dart';

typedef LevelAssetUriResolver = Future<Uri?> Function(String assetKey);

class LevelAssetImage extends StatelessWidget {
  const LevelAssetImage({
    super.key,
    required this.assetKey,
    required this.fallback,
    this.width,
    this.height,
    this.fit = BoxFit.contain,
    this.resolveUri,
  });

  final String? assetKey;
  final Widget fallback;
  final double? width;
  final double? height;
  final BoxFit fit;
  final LevelAssetUriResolver? resolveUri;

  @override
  Widget build(BuildContext context) {
    final key = assetKey?.trim() ?? '';
    if (key.isEmpty) return fallback;

    final future = (resolveUri ?? ShadowAssetRegistry.remoteUrl)(key);
    return FutureBuilder<Uri?>(
      future: future,
      builder: (context, snapshot) {
        final uri = snapshot.data;
        if (uri == null) return fallback;
        return Image.network(
          uri.toString(),
          key: ValueKey<String>('level-asset:$key'),
          width: width,
          height: height,
          fit: fit,
          filterQuality: FilterQuality.medium,
          errorBuilder: (_, __, ___) => fallback,
        );
      },
    );
  }
}
