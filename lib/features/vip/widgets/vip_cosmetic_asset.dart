import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import '../../../core/assets/shadow_asset_registry.dart';

class VipCosmeticAssetLayer extends StatelessWidget {
  const VipCosmeticAssetLayer({
    super.key,
    required this.assetKey,
    this.fit = BoxFit.cover,
    this.opacity = 1,
    this.alignment = Alignment.center,
  });

  final String assetKey;
  final BoxFit fit;
  final double opacity;
  final Alignment alignment;

  @override
  Widget build(BuildContext context) {
    final key = assetKey.trim();
    if (key.isEmpty) return const SizedBox.shrink();
    return FutureBuilder<Uri?>(
      future: ShadowAssetRegistry.remoteUrl(key),
      builder: (context, snapshot) {
        final uri = snapshot.data;
        if (uri == null) return const SizedBox.shrink();
        return IgnorePointer(
          child: Opacity(
            opacity: opacity.clamp(0, 1),
            child: CachedNetworkImage(
              imageUrl: uri.toString(),
              fit: fit,
              alignment: alignment,
              fadeInDuration: Duration.zero,
              fadeOutDuration: Duration.zero,
              placeholder: (_, __) => const SizedBox.shrink(),
              errorWidget: (_, __, ___) => const SizedBox.shrink(),
            ),
          ),
        );
      },
    );
  }
}

class VipCosmeticSurface extends StatelessWidget {
  const VipCosmeticSurface({
    super.key,
    required this.assetKey,
    required this.child,
    required this.fallbackDecoration,
    this.borderRadius = const BorderRadius.all(Radius.circular(18)),
    this.assetOpacity = .38,
  });

  final String assetKey;
  final Widget child;
  final Decoration fallbackDecoration;
  final BorderRadius borderRadius;
  final double assetOpacity;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: borderRadius,
      child: Stack(
        children: [
          Positioned.fill(
            child: DecoratedBox(decoration: fallbackDecoration),
          ),
          if (assetKey.trim().isNotEmpty)
            Positioned.fill(
              child: VipCosmeticAssetLayer(
                assetKey: assetKey,
                opacity: assetOpacity,
              ),
            ),
          child,
        ],
      ),
    );
  }
}
