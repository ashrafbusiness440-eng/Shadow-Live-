import 'package:flutter/material.dart';

import '../game_asset_paths.dart';
import '../services/game_room_launcher.dart';
import '../widgets/games_wallet_panel.dart';

class GamesHubScreen extends StatelessWidget {
  const GamesHubScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final games = <_GameEntry>[
      _GameEntry(
        title: 'القط الجشع',
        subtitle: 'اختار حظك ونافس على جوائز الجولة',
        icon: Icons.pets_rounded,
        coverAsset: GameAssetPaths.greedyCover,
        accent: const Color(0xFFFFC84A),
        secondary: const Color(0xFFFF7A3D),
        onOpen: () => GameRoomLauncher.open(
          context,
          gameKey: 'greedy_cat',
        ),
      ),
      _GameEntry(
        title: 'الساحرة',
        subtitle: 'جرّب حظك بين الوضع العادي والمتقدم',
        icon: Icons.auto_awesome_rounded,
        coverAsset: GameAssetPaths.witchCover,
        accent: const Color(0xFFB96CFF),
        secondary: const Color(0xFF5D21C7),
        onOpen: () => GameRoomLauncher.open(
          context,
          gameKey: 'witch',
        ),
      ),
      _GameEntry(
        title: 'Shadow Slot',
        subtitle: 'لفّ البكرات واكتشف نتيجتك',
        icon: Icons.casino_rounded,
        coverAsset: GameAssetPaths.slotCover,
        accent: const Color(0xFF49D7FF),
        secondary: const Color(0xFF7B2DFF),
        onOpen: () => GameRoomLauncher.open(
          context,
          gameKey: 'slot',
        ),
      ),
    ];

    return Scaffold(
      backgroundColor: Colors.transparent,
      body: SafeArea(
        child: CustomScrollView(
          slivers: [
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(16, 14, 16, 22),
              sliver: SliverList(
                delegate: SliverChildListDelegate([
                  const _GamesHeader(),
                  const SizedBox(height: 10),
                  const GamesWalletPanel(),
                  const SizedBox(height: 14),
                  Row(
                    children: [
                      const Expanded(
                        child: Text(
                          'اختار لعبتك',
                          style: TextStyle(
                            color: Colors.white,
                            fontSize: 20,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ),
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 10,
                          vertical: 6,
                        ),
                        decoration: BoxDecoration(
                          color: const Color(0xFF7B2DFF)
                              .withValues(alpha: .14),
                          borderRadius: BorderRadius.circular(999),
                          border: Border.all(
                            color: const Color(0xFF7B2DFF)
                                .withValues(alpha: .35),
                          ),
                        ),
                        child: const Text(
                          '3 ألعاب',
                          style: TextStyle(
                            color: Color(0xFFD9C2FF),
                            fontSize: 11,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  ...games.map(
                    (game) => Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: _GameCard(game: game),
                    ),
                  ),
                ]),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _GamesHeader extends StatelessWidget {
  const _GamesHeader();

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Container(
          width: 44,
          height: 44,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            gradient: const LinearGradient(
              colors: [Color(0xFFFFC84A), Color(0xFF8A3DFF)],
            ),
            boxShadow: [
              BoxShadow(
                color: const Color(0xFF8A3DFF).withValues(alpha: .32),
                blurRadius: 18,
              ),
            ],
          ),
          child: const Icon(
            Icons.sports_esports_rounded,
            color: Colors.white,
          ),
        ),
        const SizedBox(width: 12),
        const Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'الألعاب',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 22,
                  fontWeight: FontWeight.w900,
                ),
              ),
              SizedBox(height: 2),
              Text(
                'ثلاث ألعاب، اختر لعبتك وابدأ الجولة',
                style: TextStyle(
                  color: Colors.white60,
                  fontSize: 12,
                ),
              ),
            ],
          ),
        ),

      ],
    );
  }
}

class _GameCard extends StatelessWidget {
  const _GameCard({required this.game});

  final _GameEntry game;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: game.onOpen,
      borderRadius: BorderRadius.circular(22),
      child: Ink(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(22),
          gradient: LinearGradient(
            begin: Alignment.topRight,
            end: Alignment.bottomLeft,
            colors: [
              game.accent.withValues(alpha: .16),
              const Color(0xFF0C0E18),
            ],
          ),
          border: Border.all(
            color: game.accent.withValues(alpha: .32),
          ),
        ),
        child: Row(
          children: [
            Container(
              width: 86,
              height: 86,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(18),
                gradient: LinearGradient(
                  colors: [game.accent, game.secondary],
                ),
                boxShadow: [
                  BoxShadow(
                    color: game.accent.withValues(alpha: .26),
                    blurRadius: 16,
                  ),
                ],
              ),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(18),
                child: Image.asset(
                  game.coverAsset,
                  fit: BoxFit.cover,
                  filterQuality: FilterQuality.medium,
                  errorBuilder: (_, __, ___) =>
                      Icon(game.icon, color: Colors.white, size: 32),
                ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          game.title,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 16,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ),

                    ],
                  ),
                  const SizedBox(height: 5),
                  Text(
                    game.subtitle,
                    style: const TextStyle(
                      color: Colors.white60,
                      fontSize: 11,
                      height: 1.35,
                    ),
                  ),
                  const SizedBox(height: 10),
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        Icons.play_circle_fill_rounded,
                        size: 18,
                        color: game.accent,
                      ),
                      const SizedBox(width: 6),
                      const Text(
                        'العب الآن',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 12,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _GameEntry {
  const _GameEntry({
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.coverAsset,
    required this.accent,
    required this.secondary,
    required this.onOpen,
  });

  final String title;
  final String subtitle;
  final IconData icon;
  final String coverAsset;
  final Color accent;
  final Color secondary;
  final VoidCallback onOpen;
}
