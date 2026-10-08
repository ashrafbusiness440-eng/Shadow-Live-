import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import '../../../core/assets/shadow_asset_registry.dart';

class MysteriousIdentityAction {
  const MysteriousIdentityAction({
    required this.icon,
    required this.label,
    required this.onTap,
    this.color = Colors.white,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final Color color;
}

class _MysteriousAssetVisual extends StatelessWidget {
  const _MysteriousAssetVisual({
    required this.assetKey,
    required this.fallback,
    this.fit = BoxFit.contain,
  });

  final String assetKey;
  final Widget fallback;
  final BoxFit fit;

  @override
  Widget build(BuildContext context) => FutureBuilder<Uri?>(
        future: ShadowAssetRegistry.remoteUrl(assetKey),
        builder: (context, snapshot) {
          final uri = snapshot.data;
          if (uri == null) return fallback;
          return CachedNetworkImage(
            imageUrl: uri.toString(),
            fit: fit,
            fadeInDuration: Duration.zero,
            fadeOutDuration: Duration.zero,
            placeholder: (_, __) => fallback,
            errorWidget: (_, __, ___) => fallback,
          );
        },
      );
}

class MysteriousIdentityAvatar extends StatelessWidget {
  const MysteriousIdentityAvatar({
    super.key,
    required this.diameter,
  });

  final double diameter;

  @override
  Widget build(BuildContext context) {
    final fallback = Container(
      width: diameter,
      height: diameter,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: const LinearGradient(
          begin: Alignment.topRight,
          end: Alignment.bottomLeft,
          colors: [
            Color(0xFF3B1764),
            Color(0xFF111827),
            Color(0xFF050814),
          ],
        ),
        border: Border.all(
          color: const Color(0xFF8B5CF6),
          width: diameter >= 36 ? 2 : 1.4,
        ),
      ),
      alignment: Alignment.center,
      child: Icon(
        Icons.theater_comedy_rounded,
        color: const Color(0xFFFFD166),
        size: diameter * .56,
      ),
    );
    return ClipOval(
      child: SizedBox.square(
        dimension: diameter,
        child: _MysteriousAssetVisual(
          assetKey: ShadowAssetKeys.mysteriousRoomIdentity,
          fit: BoxFit.cover,
          fallback: fallback,
        ),
      ),
    );
  }
}

Future<void> showMysteriousIdentitySheet(
  BuildContext context, {
  required String mysteriousId,
  int? rank,
  num? support,
  List<MysteriousIdentityAction> actions = const [],
}) {
  final id = mysteriousId.trim();
  return showModalBottomSheet<void>(
    context: context,
    backgroundColor: const Color(0xFF0C101A),
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
    ),
    builder: (sheetContext) => Directionality(
      textDirection: TextDirection.rtl,
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 20, 20, 26),
          child: Stack(
            children: [
              Positioned.fill(
                child: IgnorePointer(
                  child: Opacity(
                    opacity: .34,
                    child: _MysteriousAssetVisual(
                      assetKey: ShadowAssetKeys.mysteriousIdentityCard,
                      fit: BoxFit.cover,
                      fallback: const SizedBox.shrink(),
                    ),
                  ),
                ),
              ),
              Column(
                mainAxisSize: MainAxisSize.min,
                children: [
              const MysteriousIdentityAvatar(diameter: 74),
              const SizedBox(height: 12),
              const Text(
                'الشخص الغامض',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 20,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 8),
              Stack(
                alignment: Alignment.center,
                children: [
                  SizedBox(
                    height: 34,
                    width: 170,
                    child: _MysteriousAssetVisual(
                      assetKey: ShadowAssetKeys.mysteriousIdPlate,
                      fit: BoxFit.fill,
                      fallback: const SizedBox.shrink(),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 7,
                    ),
                    child: Text(
                      id.isEmpty ? 'ID غامض' : 'ID: $id',
                      textDirection: TextDirection.ltr,
                      style: const TextStyle(
                        color: Color(0xFFFFD166),
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                ],
              ),
              if (rank != null || support != null) ...[
                const SizedBox(height: 12),
                Wrap(
                  spacing: 10,
                  runSpacing: 8,
                  alignment: WrapAlignment.center,
                  children: [
                    if (rank != null)
                      _InfoChip(label: 'المركز $rank'),
                    if (support != null)
                      _InfoChip(label: 'الدعم $support'),
                  ],
                ),
              ],
              if (actions.isNotEmpty) ...[
                const SizedBox(height: 16),
                ...actions.map(
                  (action) => ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: Icon(action.icon, color: action.color),
                    title: Text(
                      action.label,
                      style: TextStyle(
                        color: action.color,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    onTap: () {
                      Navigator.pop(sheetContext);
                      action.onTap();
                    },
                  ),
                ),
              ],
              const SizedBox(height: 16),
              const Text(
                'هذا المستخدم فعّل وضع الشخص الغامض. هويته الحقيقية مخفية في هذا المكان.',
                textAlign: TextAlign.center,
                style: TextStyle(color: Colors.white60, height: 1.5),
              ),
                ],
              ),
            ],
          ),
        ),
      ),
    ),
  );
}

class _InfoChip extends StatelessWidget {
  const _InfoChip({required this.label});
  final String label;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 7),
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: .06),
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: Colors.white12),
        ),
        child: Text(
          label,
          style: const TextStyle(
            color: Colors.white70,
            fontWeight: FontWeight.w700,
            fontSize: 12,
          ),
        ),
      );
}
