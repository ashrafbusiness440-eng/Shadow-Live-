import 'package:flutter/material.dart';

/// A small, reusable profile action surface. It never fetches data or creates
/// listeners: the parent supplies existing, permission-filtered destinations.
/// Keep two columns on phones and expand only when more width is available.
class ProfileActionGrid extends StatelessWidget {
  const ProfileActionGrid({
    super.key,
    required this.actions,
  });

  final List<Widget> actions;

  @override
  Widget build(BuildContext context) {
    if (actions.isEmpty) return const SizedBox.shrink();

    return LayoutBuilder(
      builder: (context, constraints) {
        final width = constraints.maxWidth;
        final columns = width >= 760
            ? 4
            : width >= 500
                ? 3
                : 2;
        const spacing = 10.0;
        final tileWidth = (width - spacing * (columns - 1)) / columns;

        return Wrap(
          alignment: WrapAlignment.start,
          spacing: spacing,
          runSpacing: spacing,
          children: [
            for (final action in actions)
              SizedBox(
                width: tileWidth,
                height: 78,
                child: action,
              ),
          ],
        );
      },
    );
  }
}
