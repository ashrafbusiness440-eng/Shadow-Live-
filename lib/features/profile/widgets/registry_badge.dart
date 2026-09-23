import 'package:flutter/material.dart';
import '../../../core/assets/shadow_asset_registry.dart';

class RegistryBadge extends StatelessWidget {
  const RegistryBadge({
    super.key,
    required this.assetKey,
    required this.label,
    this.fallbackIcon = Icons.workspace_premium_rounded,
  });

  final String assetKey;
  final String label;
  final IconData fallbackIcon;

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<Uri?>(
      future: ShadowAssetRegistry.remoteUrl(assetKey),
      builder: (context, snapshot) {
        final uri = snapshot.data;
        return Container(
          padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
          decoration: BoxDecoration(
            color: const Color(0xFF151925),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: Colors.white12),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              SizedBox(
                width: 19,
                height: 19,
                child: uri == null
                    ? Icon(fallbackIcon, size: 18, color: const Color(0xFFFFD54A))
                    : Image.network(
                        uri.toString(),
                        fit: BoxFit.contain,
                        errorBuilder: (_, __, ___) => Icon(
                          fallbackIcon,
                          size: 18,
                          color: const Color(0xFFFFD54A),
                        ),
                      ),
              ),
              const SizedBox(width: 5),
              Text(label, style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w800)),
            ],
          ),
        );
      },
    );
  }
}

String publicBadgeLabel(String key) => switch (key) {
      'badge.verified' || 'verified' => 'موثّق',
      'badge.official' || 'official' => 'رسمي',
      'badge.support_team' || 'support_team' => 'فريق الدعم',
      'role.owner' || 'owner' => 'OWNER',
      'role.admin' || 'admin' => 'ADMIN',
      'role.moderator' || 'moderator' => 'MOD',
      _ => key.replaceAll('_', ' '),
    };

String normalizePublicBadgeKey(String key) {
  if (key.contains('.')) return key;
  return switch (key) {
    'verified' => ShadowAssetKeys.verifiedBadge,
    'official' => ShadowAssetKeys.officialBadge,
    'support_team' => ShadowAssetKeys.supportTeamBadge,
    'owner' => ShadowAssetKeys.ownerBadge,
    'admin' => ShadowAssetKeys.adminBadge,
    'moderator' => ShadowAssetKeys.moderatorBadge,
    _ => 'badge.$key',
  };
}
