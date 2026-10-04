import 'package:flutter/material.dart';

import '../../../core/assets/shadow_asset_registry.dart';
import '../services/user_level_service.dart';
import 'level_asset_image.dart';

class UserLevelBadges extends StatelessWidget {
  const UserLevelBadges({
    super.key,
    required this.summary,
    required this.onTap,
    this.compact = false,
    this.micro = false,
  })  : wealthLevel = null,
        attractionLevel = null,
        gameLevel = null;

  const UserLevelBadges.fromLevels({
    super.key,
    required int wealthLevel,
    required int attractionLevel,
    required int gameLevel,
    required this.onTap,
    this.compact = false,
    this.micro = false,
  })  : summary = null,
        wealthLevel = wealthLevel,
        attractionLevel = attractionLevel,
        gameLevel = gameLevel;

  final UserLevelSummary? summary;
  final int? wealthLevel;
  final int? attractionLevel;
  final int? gameLevel;
  final ValueChanged<int> onTap;
  final bool compact;
  final bool micro;

  @override
  Widget build(BuildContext context) {
    final items = <({int tab, String metric, String label, int level, IconData icon})>[
      (
        tab: 0,
        metric: 'wealth',
        label: 'الثروة',
        level: wealthLevel ?? summary?.wealth.level ?? 0,
        icon: Icons.monetization_on_rounded,
      ),
      (
        tab: 1,
        metric: 'attraction',
        label: 'الجاذبية',
        level: attractionLevel ?? summary?.attraction.level ?? 0,
        icon: Icons.auto_awesome_rounded,
      ),
      (
        tab: 2,
        metric: 'game',
        label: 'الألعاب',
        level: gameLevel ?? summary?.games.level ?? 0,
        icon: Icons.sports_esports_rounded,
      ),
    ].where((item) => item.level > 0).toList(growable: false);

    if (items.isEmpty) return const SizedBox.shrink();

    return Wrap(
      alignment: WrapAlignment.center,
      spacing: micro ? 4 : (compact ? 6 : 8),
      runSpacing: micro ? 4 : (compact ? 6 : 8),
      children: items.map((item) {
        return Material(
          color: const Color(0xFF151925),
          borderRadius: BorderRadius.circular(16),
          child: InkWell(
            key: Key('level-badge-${item.tab}'),
            onTap: () => onTap(item.tab),
            borderRadius: BorderRadius.circular(16),
            child: Container(
              padding: EdgeInsets.symmetric(
                horizontal: micro ? 6 : (compact ? 8 : 10),
                vertical: micro ? 3 : (compact ? 5 : 7),
              ),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: Colors.white12),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  LevelAssetImage(
                    assetKey: ShadowAssetKeys.levelMiniBadge(
                      item.metric,
                      item.level,
                    ),
                    width: micro ? 18 : (compact ? 22 : 26),
                    height: micro ? 14 : (compact ? 18 : 20),
                    fallback: Icon(
                      item.icon,
                      size: micro ? 13 : (compact ? 16 : 18),
                      color: const Color(0xFFFFD54A),
                    ),
                  ),
                  const SizedBox(width: 5),
                  Text(
                    micro ? 'LV${item.level}' : '${item.label} LV${item.level}',
                    textDirection: TextDirection.rtl,
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: micro ? 9 : (compact ? 10.5 : 12),
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
      }).toList(growable: false),
    );
  }
}
