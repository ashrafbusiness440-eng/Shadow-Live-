import 'package:flutter/material.dart';

import '../../../core/assets/shadow_asset_registry.dart';

class AnimatedEmojiItem {
  const AnimatedEmojiItem({
    required this.id,
    required this.labelAr,
    required this.assetKey,
    required this.minVipLevel,
    required this.fallbackGlyph,
  });

  final String id;
  final String labelAr;
  final String assetKey;
  final int minVipLevel;
  final String fallbackGlyph;
}

abstract final class AnimatedEmojiCatalog {
  static const List<AnimatedEmojiItem> items = <AnimatedEmojiItem>[
    AnimatedEmojiItem(
      id: 'vip_star',
      labelAr: 'نجمة',
      assetKey: 'emoji.vip_star.animation',
      minVipLevel: 4,
      fallbackGlyph: '🌟',
    ),
    AnimatedEmojiItem(
      id: 'vip_crown',
      labelAr: 'تاج',
      assetKey: 'emoji.vip_crown.animation',
      minVipLevel: 4,
      fallbackGlyph: '👑',
    ),
    AnimatedEmojiItem(
      id: 'vip_diamond',
      labelAr: 'ألماسة',
      assetKey: 'emoji.vip_diamond.animation',
      minVipLevel: 4,
      fallbackGlyph: '💎',
    ),
    AnimatedEmojiItem(
      id: 'vip_shadow',
      labelAr: 'شادو',
      assetKey: 'emoji.vip_shadow.animation',
      minVipLevel: 4,
      fallbackGlyph: '✨',
    ),
  ];

  static AnimatedEmojiItem? byId(String value) {
    final id = value.trim();
    for (final item in items) {
      if (item.id == id) return item;
    }
    return null;
  }

  static List<AnimatedEmojiItem> availableForVip(int vipLevel) =>
      items
          .where((item) => vipLevel >= item.minVipLevel)
          .toList(growable: false);
}

class AnimatedEmojiVisual extends StatelessWidget {
  const AnimatedEmojiVisual({
    super.key,
    required this.emojiId,
    this.assetKey = '',
    this.size = 64,
  });

  final String emojiId;
  final String assetKey;
  final double size;

  @override
  Widget build(BuildContext context) {
    final item = AnimatedEmojiCatalog.byId(emojiId);
    final key = assetKey.trim().isNotEmpty
        ? assetKey.trim()
        : (item?.assetKey ?? '');
    final fallback = Center(
      child: Text(
        item?.fallbackGlyph ?? '✨',
        style: TextStyle(fontSize: size * .52),
      ),
    );
    if (key.isEmpty) {
      return SizedBox(width: size, height: size, child: fallback);
    }
    return SizedBox(
      width: size,
      height: size,
      child: FutureBuilder<Uri?>(
        future: ShadowAssetRegistry.remoteUrl(key),
        builder: (_, snapshot) {
          final uri = snapshot.data;
          if (uri == null) return fallback;
          return Image.network(
            uri.toString(),
            fit: BoxFit.contain,
            gaplessPlayback: true,
            errorBuilder: (_, __, ___) => fallback,
          );
        },
      ),
    );
  }
}

Future<AnimatedEmojiItem?> showAnimatedEmojiPicker(
  BuildContext context, {
  required int vipLevel,
}) {
  final items = AnimatedEmojiCatalog.availableForVip(vipLevel);
  return showModalBottomSheet<AnimatedEmojiItem>(
    context: context,
    backgroundColor: const Color(0xFF0D111B),
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
    ),
    builder: (sheetContext) => Directionality(
      textDirection: TextDirection.rtl,
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 18),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                'الإيموجيات المتحركة',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 18,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 12),
              if (items.isEmpty)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 18),
                  child: Text(
                    'لا توجد إيموجيات متاحة لمستواك حالياً.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: Colors.white60),
                  ),
                )
              else
                Wrap(
                  spacing: 10,
                  runSpacing: 10,
                  children: items
                      .map(
                        (item) => InkWell(
                          borderRadius: BorderRadius.circular(16),
                          onTap: () => Navigator.pop(sheetContext, item),
                          child: Container(
                            width: 76,
                            padding: const EdgeInsets.all(7),
                            decoration: BoxDecoration(
                              color: const Color(0xFF1A1326),
                              borderRadius: BorderRadius.circular(16),
                              border: Border.all(
                                color: const Color(0x66FFD54A),
                              ),
                            ),
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                AnimatedEmojiVisual(
                                  emojiId: item.id,
                                  assetKey: item.assetKey,
                                  size: 52,
                                ),
                                const SizedBox(height: 3),
                                Text(
                                  item.labelAr,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    color: Colors.white70,
                                    fontSize: 10,
                                    fontWeight: FontWeight.w800,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      )
                      .toList(growable: false),
                ),
            ],
          ),
        ),
      ),
    ),
  );
}
