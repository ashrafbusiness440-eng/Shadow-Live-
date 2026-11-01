import 'dart:ui' show FontFeature;

import 'package:flutter/material.dart';

import '../../../utils/compact_number.dart';

/// Read-only owner cover balances. Values come from the existing user profile
/// snapshot; absence is not presented as zero and no wallet write occurs here.
class ProfileWalletOverlay extends StatelessWidget {
  const ProfileWalletOverlay({
    super.key,
    required this.coins,
    required this.diamonds,
    required this.onCoinsTap,
    required this.onDiamondsTap,
    this.width = 104,
  });

  final int? coins;
  final int? diamonds;
  final VoidCallback onCoinsTap;
  final VoidCallback onDiamondsTap;
  final double width;

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const Key('profile-cover-wallet'),
      width: width,
      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 4),
      decoration: BoxDecoration(
        color: const Color(0xBB101327),
        borderRadius: BorderRadius.circular(13),
        border: Border.all(color: Colors.white24, width: .7),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          _entry(
            key: const Key('profile-cover-coins'),
            icon: Icons.monetization_on_rounded,
            color: const Color(0xFFFFD54A),
            label: 'الكوينز',
            value: coins,
            onTap: onCoinsTap,
          ),
          Container(height: 1, color: Colors.white12),
          _entry(
            key: const Key('profile-cover-diamonds'),
            icon: Icons.diamond_rounded,
            color: const Color(0xFF66E1FF),
            label: 'الألماس',
            value: diamonds,
            onTap: onDiamondsTap,
          ),
        ],
      ),
    );
  }

  Widget _entry({
    required Key key,
    required IconData icon,
    required Color color,
    required String label,
    required int? value,
    required VoidCallback onTap,
  }) {
    return Semantics(
      label: '$label: ${value == null ? 'غير متاح' : value}',
      button: true,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          key: key,
          onTap: onTap,
          borderRadius: BorderRadius.circular(7),
          child: SizedBox(
            height: 44,
            child: Row(
              textDirection: TextDirection.ltr,
              children: [
                Icon(icon, color: color, size: 15),
                const SizedBox(width: 4),
                Expanded(
                  child: Text(
                    value == null ? '—' : formatCompactAmount(value),
                    key: Key(label == 'الكوينز'
                        ? 'profile-coins-value'
                        : 'profile-diamonds-value'),
                    textDirection: TextDirection.ltr,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 11,
                      fontWeight: FontWeight.w800,
                      fontFeatures: [FontFeature.tabularFigures()],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
