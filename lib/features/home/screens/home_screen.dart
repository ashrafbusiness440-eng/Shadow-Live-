import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  Map<String, dynamic>? _userData;

  static const _bg = Color(0xFF05060D);
  static const _card = Color(0xFF111321);
  static const _gold = Color(0xFFFFD54A);
  static const _purple = Color(0xFF8A3DFF);

  @override
  void initState() {
    super.initState();
    _loadUser();
  }

  Future<void> _loadUser() async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) return;
    try {
      final snapshot = await FirebaseFirestore.instance
          .collection('users')
          .doc(user.uid)
          .get();
      if (mounted) setState(() => _userData = snapshot.data());
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    final name =
        (_userData?['displayName'] ?? _userData?['username'] ?? 'صديقنا')
            .toString();
    final level = (_userData?['level'] ?? 1).toString();
    final coins = (_userData?['coins'] ?? 0).toString();
    final diamonds = (_userData?['diamonds'] ?? 0).toString();

    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: _bg,
        body: Container(
          decoration: const BoxDecoration(
            gradient: RadialGradient(
              center: Alignment(0.7, -0.9),
              radius: 1.25,
              colors: [Color(0xFF251047), _bg],
            ),
          ),
          child: SafeArea(
            bottom: false,
            child: RefreshIndicator(
              onRefresh: _loadUser,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 28),
                children: [
                  _header(name, level, coins, diamonds),
                  const SizedBox(height: 18),
                  _searchBar(),
                  const SizedBox(height: 18),
                  _heroBanner(),
                  const SizedBox(height: 24),
                  _sectionTitle('غرف مقترحة', 'عرض الكل'),
                  const SizedBox(height: 12),
                  SizedBox(
                    height: 170,
                    child: ListView(
                      scrollDirection: Axis.horizontal,
                      children: const [
                        _RoomCard(
                            title: 'سوالف المساء',
                            people: '128',
                            icon: Icons.nightlife),
                        _RoomCard(
                            title: 'أصدقاء جدد',
                            people: '94',
                            icon: Icons.groups_rounded),
                        _RoomCard(
                            title: 'موسيقى ووناسة',
                            people: '76',
                            icon: Icons.music_note_rounded),
                      ],
                    ),
                  ),
                  const SizedBox(height: 24),
                  _sectionTitle('الأكثر تفاعلاً', 'عرض الكل'),
                  const SizedBox(height: 12),
                  _interactionCard(),
                  const SizedBox(height: 24),
                  _sectionTitle('استكشف Shadow Live', ''),
                  const SizedBox(height: 12),
                  GridView.count(
                    crossAxisCount: 2,
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    mainAxisSpacing: 12,
                    crossAxisSpacing: 12,
                    childAspectRatio: 1.65,
                    children: const [
                      _FeatureTile(
                          title: 'الأصدقاء',
                          subtitle: 'اكتشف أشخاصاً جدد',
                          icon: Icons.people_alt_rounded,
                          accent: Color(0xFF7C4DFF)),
                      _FeatureTile(
                          title: 'الألعاب',
                          subtitle: 'العب واربح',
                          icon: Icons.sports_esports_rounded,
                          accent: Color(0xFFFF4FCB)),
                      _FeatureTile(
                          title: 'الفعاليات',
                          subtitle: 'لا تفوّت الجديد',
                          icon: Icons.celebration_rounded,
                          accent: Color(0xFFFFB52E)),
                      _FeatureTile(
                          title: 'الترتيب',
                          subtitle: 'نجوم المجتمع',
                          icon: Icons.emoji_events_rounded,
                          accent: Color(0xFF38CFFF)),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _header(String name, String level, String coins, String diamonds) {
    return Row(
      children: [
        Container(
          width: 48,
          height: 48,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            gradient: const LinearGradient(colors: [_gold, _purple]),
            border: Border.all(color: Colors.white24),
          ),
          child:
              const Icon(Icons.person_rounded, color: Colors.white, size: 28),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('أهلاً، $name',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                      color: Colors.white,
                      fontSize: 18,
                      fontWeight: FontWeight.w800)),
              const SizedBox(height: 4),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                    color: _gold.withValues(alpha: .12),
                    borderRadius: BorderRadius.circular(20)),
                child: Text('LV.$level',
                    style: const TextStyle(
                        color: _gold,
                        fontSize: 11,
                        fontWeight: FontWeight.w800)),
              ),
            ],
          ),
        ),
        _walletChip(Icons.monetization_on_rounded, coins, _gold),
        const SizedBox(width: 6),
        _walletChip(Icons.diamond_rounded, diamonds, const Color(0xFF64D8FF)),
        const SizedBox(width: 6),
        _roundButton(Icons.notifications_none_rounded),
      ],
    );
  }

  Widget _walletChip(IconData icon, String value, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 7),
      decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: .06),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: Colors.white10)),
      child: Row(children: [
        Icon(icon, color: color, size: 15),
        const SizedBox(width: 3),
        Text(value,
            style: const TextStyle(
                color: Colors.white, fontSize: 11, fontWeight: FontWeight.w700))
      ]),
    );
  }

  Widget _roundButton(IconData icon) => Container(
        width: 38,
        height: 38,
        decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: .06),
            shape: BoxShape.circle,
            border: Border.all(color: Colors.white10)),
        child: Icon(icon, color: Colors.white, size: 21),
      );

  Widget _searchBar() {
    return Container(
      height: 48,
      padding: const EdgeInsets.symmetric(horizontal: 14),
      decoration: BoxDecoration(
          color: _card.withValues(alpha: .9),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: Colors.white10)),
      child: const Row(children: [
        Icon(Icons.search_rounded, color: Colors.white54),
        SizedBox(width: 10),
        Text('ابحث عن غرف، أصدقاء، ألعاب...',
            style: TextStyle(color: Colors.white54, fontSize: 13))
      ]),
    );
  }

  Widget _heroBanner() {
    return Container(
      height: 175,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(24),
        gradient: const LinearGradient(
            begin: Alignment.topRight,
            end: Alignment.bottomLeft,
            colors: [Color(0xFF5A19B8), Color(0xFF17103B), Color(0xFF08101E)]),
        border: Border.all(color: _purple.withValues(alpha: .45)),
        boxShadow: [
          BoxShadow(color: _purple.withValues(alpha: .18), blurRadius: 24)
        ],
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Text('صوتك يجمعنا',
                    style: TextStyle(
                        color: _gold,
                        fontSize: 25,
                        fontWeight: FontWeight.w900)),
                const SizedBox(height: 8),
                const Text(
                    'ادخل الغرف، تعرّف على أصدقاء\nوعِش اللحظة مع مجتمعك',
                    style: TextStyle(
                        color: Colors.white70, height: 1.5, fontSize: 13)),
                const SizedBox(height: 14),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                  decoration: BoxDecoration(
                      gradient: const LinearGradient(
                          colors: [_purple, Color(0xFFFF42C8)]),
                      borderRadius: BorderRadius.circular(12)),
                  child: const Text('استكشف الآن',
                      style: TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.w800,
                          fontSize: 12)),
                ),
              ],
            ),
          ),
          Container(
            width: 96,
            height: 96,
            decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: _purple.withValues(alpha: .18),
                boxShadow: [
                  BoxShadow(
                      color: _purple.withValues(alpha: .35), blurRadius: 30)
                ]),
            child: const Icon(Icons.mic_rounded, color: _gold, size: 58),
          ),
        ],
      ),
    );
  }

  Widget _sectionTitle(String title, String action) {
    return Row(
      children: [
        Expanded(
            child: Text(title,
                style: const TextStyle(
                    color: Colors.white,
                    fontSize: 18,
                    fontWeight: FontWeight.w900))),
        if (action.isNotEmpty)
          Text(action,
              style: const TextStyle(
                  color: _gold, fontSize: 12, fontWeight: FontWeight.w700)),
      ],
    );
  }

  Widget _interactionCard() {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
          color: _card,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: Colors.white10)),
      child: const Row(
        children: [
          CircleAvatar(
              radius: 27,
              backgroundColor: Color(0xFF2C1851),
              child: Icon(Icons.local_fire_department_rounded,
                  color: Color(0xFFFFB52E), size: 30)),
          SizedBox(width: 12),
          Expanded(
              child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                Text('لمة الأصدقاء 🔥',
                    style: TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.w800,
                        fontSize: 15)),
                SizedBox(height: 5),
                Text('دردشة • موسيقى • تحديات',
                    style: TextStyle(color: Colors.white54, fontSize: 12))
              ])),
          Icon(Icons.graphic_eq_rounded, color: _gold),
          SizedBox(width: 5),
          Text('342',
              style: TextStyle(
                  color: Colors.white70, fontWeight: FontWeight.w700)),
        ],
      ),
    );
  }
}

class _RoomCard extends StatelessWidget {
  final String title;
  final String people;
  final IconData icon;

  const _RoomCard(
      {required this.title, required this.people, required this.icon});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 145,
      margin: const EdgeInsetsDirectional.only(end: 10),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(20),
        gradient: const LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [Color(0xFF251A42), Color(0xFF10121D)]),
        border: Border.all(color: Colors.white10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
              width: 54,
              height: 54,
              decoration: const BoxDecoration(
                  shape: BoxShape.circle, color: Color(0xFF372064)),
              child: Icon(icon, color: const Color(0xFFFFD54A), size: 28)),
          const Spacer(),
          Text(title,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w800,
                  fontSize: 14)),
          const SizedBox(height: 6),
          Row(children: [
            const Icon(Icons.headset_mic_rounded,
                color: Colors.white38, size: 14),
            const SizedBox(width: 4),
            Text('$people متصل',
                style: const TextStyle(color: Colors.white54, fontSize: 11))
          ]),
        ],
      ),
    );
  }
}

class _FeatureTile extends StatelessWidget {
  final String title;
  final String subtitle;
  final IconData icon;
  final Color accent;

  const _FeatureTile(
      {required this.title,
      required this.subtitle,
      required this.icon,
      required this.accent});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
          color: const Color(0xFF111321),
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: Colors.white10)),
      child: Row(
        children: [
          Container(
              width: 42,
              height: 42,
              decoration: BoxDecoration(
                  color: accent.withValues(alpha: .14),
                  borderRadius: BorderRadius.circular(13)),
              child: Icon(icon, color: accent, size: 23)),
          const SizedBox(width: 10),
          Expanded(
              child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                Text(title,
                    style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.w800,
                        fontSize: 13)),
                const SizedBox(height: 3),
                Text(subtitle,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(color: Colors.white38, fontSize: 10))
              ])),
        ],
      ),
    );
  }
}
