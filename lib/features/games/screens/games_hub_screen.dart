import 'package:flutter/material.dart';

import '../services/game_room_launcher.dart';

class GamesHubScreen extends StatelessWidget {
  const GamesHubScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final games = <_GameEntry>[
      _GameEntry(
        title: 'القط الجشع',
        subtitle: 'جولة جماعية • 8 اختيارات • نتائج واضحة',
        icon: Icons.pets_rounded,
        accent: const Color(0xFFFFC84A),
        secondary: const Color(0xFFFF7A3D),
        bets: '200 • 2K • 20K • 200K',
        onOpen: () => GameRoomLauncher.open(
          context,
          gameKey: 'greedy_cat',
        ),
      ),
      _GameEntry(
        title: 'الساحرة',
        subtitle: 'عادي ومتقدم • معاملات مستقلة لكل وضع',
        icon: Icons.auto_awesome_rounded,
        accent: const Color(0xFFB96CFF),
        secondary: const Color(0xFF5D21C7),
        bets: '100–100K / 200–200K',
        onOpen: () => GameRoomLauncher.open(
          context,
          gameKey: 'witch',
        ),
      ),
      _GameEntry(
        title: 'Shadow Slot',
        subtitle: 'Spin • Auto Play • هوية أصلية لشادو لايف',
        icon: Icons.casino_rounded,
        accent: const Color(0xFF49D7FF),
        secondary: const Color(0xFF7B2DFF),
        bets: '200 → 200K',
        onOpen: () => GameRoomLauncher.open(
          context,
          gameKey: 'slot',
        ),
      ),
    ];

    return Scaffold(
      backgroundColor: const Color(0xFF05060D),
      body: SafeArea(
        child: CustomScrollView(
          slivers: [
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(16, 14, 16, 22),
              sliver: SliverList(
                delegate: SliverChildListDelegate([
                  const _GamesHeader(),
                  const SizedBox(height: 16),
                  const _GamesHero(),
                  const SizedBox(height: 22),
                  Row(
                    children: [
                      const Expanded(
                        child: Text(
                          'الألعاب المعتمدة',
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
                  const SizedBox(height: 8),
                  const _SafetyCard(),
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
                'ألعاب Shadow Live',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 22,
                  fontWeight: FontWeight.w900,
                ),
              ),
              SizedBox(height: 2),
              Text(
                'العب، نافس، وشوف نتائج كل جولة بوضوح',
                style: TextStyle(
                  color: Colors.white60,
                  fontSize: 12,
                ),
              ),
            ],
          ),
        ),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
          decoration: BoxDecoration(
            color: const Color(0xFFFFC84A).withValues(alpha: .10),
            borderRadius: BorderRadius.circular(14),
            border: Border.all(
              color: const Color(0xFFFFC84A).withValues(alpha: .28),
            ),
          ),
          child: const Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.toll_rounded,
                color: Color(0xFFFFD54A),
                size: 16,
              ),
              SizedBox(width: 5),
              Text(
                'Coins',
                style: TextStyle(
                  color: Color(0xFFFFE082),
                  fontWeight: FontWeight.w800,
                  fontSize: 11,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _GamesHero extends StatelessWidget {
  const _GamesHero();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(26),
        gradient: const LinearGradient(
          begin: Alignment.topRight,
          end: Alignment.bottomLeft,
          colors: [
            Color(0xFF1B1036),
            Color(0xFF0D1535),
            Color(0xFF090A13),
          ],
        ),
        border: Border.all(
          color: const Color(0xFF9A55FF).withValues(alpha: .38),
        ),
        boxShadow: [
          BoxShadow(
            color: const Color(0xFF7B2DFF).withValues(alpha: .18),
            blurRadius: 28,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 9,
                    vertical: 5,
                  ),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFFC84A)
                        .withValues(alpha: .13),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: const Text(
                    'PHASE 8 • GAMES',
                    style: TextStyle(
                      color: Color(0xFFFFD86B),
                      fontWeight: FontWeight.w900,
                      fontSize: 10,
                      letterSpacing: .6,
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                const Text(
                  'ثلاث ألعاب فقط في الإطلاق الأول',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 19,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 7),
                const Text(
                  'واجهة واحدة واضحة، رهانات محددة، وسجل نتائج قابل للتدقيق.',
                  style: TextStyle(
                    color: Colors.white70,
                    height: 1.5,
                    fontSize: 12,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 10),
          Container(
            width: 84,
            height: 84,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              gradient: const LinearGradient(
                colors: [Color(0xFF8A3DFF), Color(0xFFFFC84A)],
              ),
              boxShadow: [
                BoxShadow(
                  color: const Color(0xFF8A3DFF)
                      .withValues(alpha: .35),
                  blurRadius: 24,
                ),
              ],
            ),
            child: const Icon(
              Icons.stadium_rounded,
              size: 42,
              color: Colors.white,
            ),
          ),
        ],
      ),
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
              width: 62,
              height: 62,
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
              child: Icon(game.icon, color: Colors.white, size: 32),
            ),
            const SizedBox(width: 13),
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
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 4,
                        ),
                        decoration: BoxDecoration(
                          color: const Color(0xFF28D17C)
                              .withValues(alpha: .12),
                          borderRadius: BorderRadius.circular(999),
                        ),
                        child: const Text(
                          'متاحة',
                          style: TextStyle(
                            color: Color(0xFF65E9A4),
                            fontSize: 10,
                            fontWeight: FontWeight.w800,
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
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      Icon(
                        Icons.toll_rounded,
                        color: game.accent,
                        size: 14,
                      ),
                      const SizedBox(width: 5),
                      Expanded(
                        child: Text(
                          game.bets,
                          style: const TextStyle(
                            color: Colors.white70,
                            fontSize: 10.5,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                      const Icon(
                        Icons.arrow_back_ios_new_rounded,
                        color: Colors.white38,
                        size: 13,
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

class _SafetyCard extends StatelessWidget {
  const _SafetyCard();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(20),
        color: Colors.white.withValues(alpha: .035),
        border: Border.all(color: Colors.white.withValues(alpha: .08)),
      ),
      child: const Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            Icons.verified_user_rounded,
            color: Color(0xFF70C7FF),
            size: 22,
          ),
          SizedBox(width: 10),
          Expanded(
            child: Text(
              'النتائج المالية النهائية ستكون Server-side فقط: كل جولة لها ID، الخصم مرة واحدة، والتسوية محفوظة حتى لو انقطع الاتصال.',
              style: TextStyle(
                color: Colors.white60,
                fontSize: 11.5,
                height: 1.5,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _GameEntry {
  const _GameEntry({
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.accent,
    required this.secondary,
    required this.bets,
    required this.onOpen,
  });

  final String title;
  final String subtitle;
  final IconData icon;
  final Color accent;
  final Color secondary;
  final String bets;
  final VoidCallback onOpen;
}
