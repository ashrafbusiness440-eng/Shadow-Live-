import 'package:flutter/material.dart';

/// Shared, low-noise profile navigation. Keep each screen's existing
/// destinations; this widget only owns the visual treatment.
class ProfileSectionTabs extends StatelessWidget implements PreferredSizeWidget {
  const ProfileSectionTabs({
    super.key,
    required this.controller,
    required this.labels,
  });

  final TabController controller;
  final List<String> labels;

  @override
  Size get preferredSize => const Size.fromHeight(56);

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: const Color(0xFF0B1020),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: const Color(0xFF171526),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: const Color(0xFF56416D), width: .8),
          ),
          child: TabBar(
            controller: controller,
            isScrollable: false,
            tabAlignment: TabAlignment.fill,
            dividerHeight: 0,
            indicatorSize: TabBarIndicatorSize.tab,
            indicatorPadding: const EdgeInsets.all(3),
            indicator: BoxDecoration(
              gradient: const LinearGradient(
                colors: <Color>[Color(0xFF453078), Color(0xFF2D2149)],
              ),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: const Color(0xFFAE8B61), width: .8),
            ),
            labelColor: const Color(0xFFFFE1B1),
            unselectedLabelColor: const Color(0xFFB5ACC7),
            labelStyle: const TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w800,
            ),
            unselectedLabelStyle: const TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w600,
            ),
            labelPadding: EdgeInsets.zero,
            tabs: <Widget>[
              for (final label in labels) Tab(text: label, height: 40),
            ],
          ),
        ),
      ),
    );
  }
}
