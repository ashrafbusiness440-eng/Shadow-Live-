import 'package:flutter/material.dart';

/// A geometry-based identity header. The ID and badge hit targets remain 44px
/// tall, but their visual baselines are packed closer than a Column of 44px
/// rows. Applied only to own and full public profile headers.
class ProfileCompactHeaderIdentity extends StatelessWidget {
  const ProfileCompactHeaderIdentity({
    super.key,
    required this.portraitHeight,
    required this.portrait,
    required this.name,
    required this.identityId,
    required this.identityStatus,
  });

  final double portraitHeight;
  final Widget portrait;
  final Widget name;
  final Widget identityId;
  final Widget identityStatus;

  @override
  Widget build(BuildContext context) {
    // Reserve extra breathing room for accessibility text scaling. At default
    // scale each visual baseline is ~30px apart, not 44px apart.
    final scale =
        (MediaQuery.textScalerOf(context).scale(16) / 16).clamp(1.0, 1.6).toDouble();
    final nameTop = portraitHeight + 9 * scale;
    final idTop = portraitHeight + 34 * scale;
    final statusTop = portraitHeight + 63 * scale;
    final totalHeight = portraitHeight + 107 * scale;
    return SizedBox(
      key: const Key('profile-compact-header-identity'),
      height: totalHeight,
      width: double.infinity,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          Positioned(
            left: 0,
            right: 0,
            top: 0,
            height: portraitHeight,
            child: Center(
              child: Transform.translate(
                // Moves the entire portrait/frame lower towards the name.
                // The photo itself is inset and lowered inside the frame in
                // ProfileAvatarWithFrame, remaining under the frame artwork.
                offset: const Offset(0, 6),
                child: KeyedSubtree(
                  key: const Key('profile-header-portrait'),
                  child: portrait,
                ),
              ),
            ),
          ),
          Positioned(
            left: 0,
            right: 0,
            top: nameTop,
            child: Center(
              child: KeyedSubtree(
                key: const Key('profile-header-name'),
                child: name,
              ),
            ),
          ),
          Positioned(
            left: 0,
            right: 0,
            top: idTop,
            child: KeyedSubtree(
              key: const Key('profile-header-id'),
              child: identityId,
            ),
          ),
          Positioned(
            left: 0,
            right: 0,
            top: statusTop,
            child: KeyedSubtree(
              key: const Key('profile-header-status'),
              child: identityStatus,
            ),
          ),
        ],
      ),
    );
  }
}
