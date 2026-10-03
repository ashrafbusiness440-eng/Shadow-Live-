import 'package:flutter/material.dart';

import '../services/user_level_service.dart';

class UserLevelBadges extends StatelessWidget {
  const UserLevelBadges({
    super.key,
    required this.summary,
    required this.onTap,
    this.compact = false,
  });

  final UserLevelSummary summary;
  final ValueChanged<int> onTap;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final items = <({int tab, String label, int level, IconData icon})>[
      (
        tab: 0,
        label: 'الثروة',
        level: summary.wealth.level,
        icon: Icons.monetization_on_rounded,
      ),
      (
        tab: 1,
        label: 'الجاذبية',
        level: summary.attraction.level,
        icon: Icons.auto_awesome_rounded,
      ),
      (
        tab: 2,
        label: 'الألعاب',
        level: summary.games.level,
        icon: Icons.sports_esports_rounded,
      ),
    ].where((item) => item.level > 0).toList(growable: false);

    if (items.isEmpty) return const SizedBox.shrink();

    return Wrap(
      alignment: WrapAlignment.center,
      spacing: compact ? 6 : 8,
      runSpacing: compact ? 6 : 8,
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
                horizontal: compact ? 8 : 10,
                vertical: compact ? 5 : 7,
              ),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: Colors.white12),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    item.icon,
                    size: compact ? 16 : 18,
                    color: const Color(0xFFFFD54A),
                  ),
                  const SizedBox(width: 5),
                  Text(
                    '${item.label} LV${item.level}',
                    textDirection: TextDirection.rtl,
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: compact ? 10.5 : 12,
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
