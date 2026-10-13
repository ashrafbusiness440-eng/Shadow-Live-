import 'package:flutter/material.dart';

import '../../../shared/widgets/country_selector.dart';

/// Shared lightweight header metadata: ID + copy, flag and optional gender.
/// No new profile reads, image sources or background decoration.
class ProfileIdentityInfoLine extends StatelessWidget {
  const ProfileIdentityInfoLine({
    super.key,
    required this.id,
    required this.location,
    required this.onCopy,
    this.gender,
    this.copyKey,
  });

  final String id;
  final String location;
  final String? gender;
  final VoidCallback onCopy;
  final Key? copyKey;

  @override
  Widget build(BuildContext context) {
    final genderLabel = (gender ?? '').trim();
    return Wrap(
      key: const Key('profile-identity-info-line'),
      alignment: WrapAlignment.center,
      crossAxisAlignment: WrapCrossAlignment.center,
      spacing: 6,
      runSpacing: 0,
      children: [
        Tooltip(
          message: 'نسخ ID',
          child: TextButton(
            key: copyKey,
            onPressed: onCopy,
            style: TextButton.styleFrom(
              foregroundColor: const Color(0xFFFFD54A),
              minimumSize: const Size(44, 44),
              padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
              visualDensity: VisualDensity.standard,
              tapTargetSize: MaterialTapTargetSize.padded,
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 180),
                  child: Text(
                    'ID: ${id.trim().isEmpty ? '—' : id}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    textDirection: TextDirection.ltr,
                    style: const TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
                const SizedBox(width: 6),
                const Icon(Icons.copy_rounded, size: 16),
              ],
            ),
          ),
        ),
        ShadowProfileCountryFlag(
          location: location,
          fontSize: 19,
        ),
        if (genderLabel == 'ذكر' || genderLabel == 'أنثى')
          Semantics(
            label: genderLabel == 'ذكر' ? 'ذكر' : 'أنثى',
            child: Text(
              genderLabel == 'ذكر' ? '♂' : '♀',
              style: TextStyle(
                fontSize: 19,
                fontWeight: FontWeight.w800,
                color: genderLabel == 'ذكر'
                    ? const Color(0xFF42A5F5)
                    : const Color(0xFFFF69B4),
              ),
            ),
          ),
      ],
    );
  }
}
