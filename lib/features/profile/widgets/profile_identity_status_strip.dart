import 'package:flutter/material.dart';

import '../../../core/assets/shadow_asset_registry.dart';
import '../../../shared/widgets/country_selector.dart';
import 'registry_badge.dart';
import 'user_level_badges.dart';

/// Approved physical order, LEFT -> RIGHT:
/// membership days, wealth, attraction, VIP, public age/gender, country flag.
/// Keeps a single row on narrow phones by allowing horizontal scrolling.
class ProfileIdentityStatusStrip extends StatelessWidget {
  const ProfileIdentityStatusStrip({
    super.key,
    required this.membershipDays,
    required this.wealthLevel,
    required this.attractionLevel,
    required this.vipLevel,
    required this.location,
    required this.onLevelTap,
    this.age,
    this.gender = '',
    this.onVipTap,
  });

  final int? membershipDays;
  final int wealthLevel;
  final int attractionLevel;
  final int vipLevel;
  final Object? age;
  final String gender;
  final String location;
  final ValueChanged<int> onLevelTap;
  final VoidCallback? onVipTap;

  @override
  Widget build(BuildContext context) {
    final ageValue = age is num ? (age as num).toInt() : int.tryParse('$age');
    final safeAge = ageValue != null && ageValue > 0 && ageValue < 120
        ? ageValue
        : null;
    final genderValue = gender.trim();
    final publicGender = genderValue == 'ذكر' || genderValue == 'أنثى'
        ? genderValue
        : '';
    final demographic = [
      if (safeAge != null) '$safeAge',
      if (publicGender.isNotEmpty) publicGender == 'ذكر' ? '♂' : '♀',
    ].join(' ');

    return SizedBox(
      width: double.infinity,
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Directionality(
          textDirection: TextDirection.ltr,
          child: Row(
            key: const Key('profile-identity-status-row'),
            mainAxisSize: MainAxisSize.min,
            children: [
              if (membershipDays != null)
                Padding(
                  padding: const EdgeInsetsDirectional.only(end: 6),
                  child: Text(
                    '$membershipDays يوم',
                    key: const Key('profile-membership-days'),
                    textDirection: TextDirection.rtl,
                    style: const TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w800,
                      color: Colors.white70,
                    ),
                  ),
                ),
              UserLevelBadges.fromLevels(
                wealthLevel: wealthLevel,
                attractionLevel: attractionLevel,
                gameLevel: 0,
                iconOnly: true,
                onTap: onLevelTap,
              ),
              if (vipLevel > 0)
                Padding(
                  padding: const EdgeInsetsDirectional.only(start: 4),
                  child: InkWell(
                    onTap: onVipTap,
                    borderRadius: BorderRadius.circular(8),
                    child: RegistryBadge(
                      assetKey: ShadowAssetKeys.vipLevelBadge(vipLevel),
                      label: 'VIP $vipLevel',
                    ),
                  ),
                ),
              if (demographic.isNotEmpty)
                Padding(
                  padding: const EdgeInsetsDirectional.only(start: 6),
                  child: Text(
                    demographic,
                    style: const TextStyle(color: Colors.white70, fontSize: 12),
                  ),
                ),
              ShadowProfileCountryFlag(
                location: location,
                fontSize: 19,
                padding: const EdgeInsetsDirectional.only(start: 6),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
