import 'package:cached_network_image/cached_network_image.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../../../services/navigation_service.dart';
import '../../../utils/compact_number.dart';
import '../../wallet/screens/recharge_screen.dart';
import '../services/discovery_service.dart';
import 'discovery_search_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final DiscoveryService _discoveryService = DiscoveryService();

  HomeDiscoveryData? _data;
  bool _loading = true;
  String? _error;

  static const _bg = Color(0xFF05060D);
  static const _card = Color(0xFF111321);
  static const _gold = Color(0xFFFFD54A);
  static const _purple = Color(0xFF8A3DFF);

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (mounted) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }

    try {
      final data = await _discoveryService.loadHome();
      if (mounted) setState(() => _data = data);
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'تعذر تحديث الاستكشاف حالياً');
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  ImageProvider? _profileImage() {
    final userData = _data?.userData;
    final url =
        (userData?['profileImageUrl'] ?? userData?['avatarUrl'])?.toString();
    if (url != null && url.trim().isNotEmpty) return NetworkImage(url);

    final asset = userData?['profileAvatarAsset']?.toString();
    if (asset != null && asset.trim().isNotEmpty) return AssetImage(asset);

    final authUrl = FirebaseAuth.instance.currentUser?.photoURL;
    if (authUrl != null && authUrl.trim().isNotEmpty) {
      return NetworkImage(authUrl);
    }
    return null;
  }

  Future<void> _recharge(int tab) async {
    await Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => RechargeScreen(initialTab: tab)),
    );
    if (mounted) await _load();
  }

  void _search() {
    Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => const DiscoverySearchScreen()),
    );
  }

  void _openRoom(DiscoveryRoom room) {
    NavigationService.navigateTo(
      AppRoutes.voiceChatRoom,
      arguments: room.toNavigationArguments(),
    );
  }

  void _soon(String title) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('$title سيتم تفعيله في مرحلته القادمة')),
    );
  }

  @override
  Widget build(BuildContext context) {
    final userData = _data?.userData;
    final authUser = FirebaseAuth.instance.currentUser;
    final name = authUser?.isAnonymous == true
        ? 'ضيف Shadow'
        : (userData?['displayName'] ?? userData?['username'] ?? 'صديقنا')
            .toString();
    final level = (userData?['level'] ?? 1).toString();
    final coins = formatCompactAmount(userData?['coins']);
    final diamonds = formatCompactAmount(userData?['diamonds']);

    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: _bg,
        body: Container(
          decoration: const BoxDecoration(
            gradient: RadialGradient(
              center: Alignment(.7, -.9),
              radius: 1.25,
              colors: [Color(0xFF251047), _bg],
            ),
          ),
          child: SafeArea(
            bottom: false,
            child: RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 28),
                children: [
                  _header(name, level, coins, diamonds),
                  if (_loading) ...[
                    const SizedBox(height: 10),
                    const LinearProgressIndicator(
                      minHeight: 2,
                      color: _purple,
                      backgroundColor: Colors.transparent,
                    ),
                  ],
                  if (_error != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 10),
                      child: Text(
                        _error!,
                        style: const TextStyle(
                          color: Colors.orangeAccent,
                          fontSize: 12,
                        ),
                      ),
                    ),
                  const SizedBox(height: 18),
                  _searchBox(),
                  const SizedBox(height: 18),
                  _hero(),
                  const SizedBox(height: 24),
                  _sectionHeader('غرف مقترحة', 'اختيارات مناسبة الآن'),
                  const SizedBox(height: 12),
                  _roomRail(_data?.suggested ?? const []),
                  const SizedBox(height: 24),
                  _sectionHeader('الأكثر تفاعلاً', 'الغرف الأكثر نشاطاً'),
                  const SizedBox(height: 12),
                  _activityRail(_data?.mostActive ?? const []),
                  const SizedBox(height: 24),
                  _sectionHeader('استكشف Shadow Live', 'كل شيء من مكان واحد'),
                  const SizedBox(height: 12),
                  GridView.count(
                    crossAxisCount: 2,
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    mainAxisSpacing: 12,
                    crossAxisSpacing: 12,
                    childAspectRatio: 1.65,
                    children: [
                      _Feature(
                        'الأصدقاء',
                        'ابحث بالاسم أو ID',
                        Icons.people_alt_rounded,
                        _search,
                      ),
                      _Feature(
                        'الألعاب',
                        'العب واربح',
                        Icons.sports_esports_rounded,
                        () => _soon('الألعاب'),
                      ),
                      _Feature(
                        'الفعاليات',
                        'لا تفوّت الجديد',
                        Icons.celebration_rounded,
                        () => _soon('الفعاليات'),
                      ),
                      _Feature(
                        'الترتيب',
                        'نجوم المجتمع',
                        Icons.emoji_events_rounded,
                        () => _soon('الترتيب'),
                      ),
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

  Widget _roomRail(List<DiscoveryRoom> rooms) {
    if (_loading && rooms.isEmpty) {
      return const SizedBox(
        height: 166,
        child: Center(child: CircularProgressIndicator(color: _purple)),
      );
    }
    if (rooms.isEmpty) return _emptyRooms('لا توجد غرف مقترحة حالياً');

    return SizedBox(
      height: 170,
      child: ListView(
        scrollDirection: Axis.horizontal,
        children: rooms
            .take(8)
            .map(
              (room) => _RoomCard(
                room: room,
                onTap: () => _openRoom(room),
              ),
            )
            .toList(),
      ),
    );
  }

  Widget _activityRail(List<DiscoveryRoom> rooms) {
    if (rooms.isEmpty) {
      return Container(
        height: 82,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        decoration: BoxDecoration(
          color: _card,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: Colors.white10),
        ),
        child: const Row(
          children: [
            Icon(Icons.bolt_rounded, color: Colors.white30),
            SizedBox(width: 10),
            Expanded(
              child: Text(
                'ستظهر الغرف النشطة هنا حسب عدد المتصلين',
                style: TextStyle(color: Colors.white54, fontSize: 12),
              ),
            ),
          ],
        ),
      );
    }

    return SizedBox(
      height: 92,
      child: ListView(
        scrollDirection: Axis.horizontal,
        children: rooms
            .take(10)
            .map(
              (room) => _ActiveRoomChip(
                room: room,
                onTap: () => _openRoom(room),
              ),
            )
            .toList(),
      ),
    );
  }

  Widget _emptyRooms(String message) {
    return Container(
      height: 120,
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: _card,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: Colors.white10),
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.mic_none_rounded, color: Colors.white38, size: 32),
          const SizedBox(height: 8),
          Text(
            message,
            style: const TextStyle(
              color: Colors.white70,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 4),
          const Text(
            'ستظهر الغرف النشطة هنا تلقائياً',
            style: TextStyle(color: Colors.white38, fontSize: 11),
          ),
        ],
      ),
    );
  }

  Widget _header(String name, String level, String coins, String diamonds) {
    final image = _profileImage();
    return Row(
      children: [
        Container(
          width: 50,
          height: 50,
          padding: const EdgeInsets.all(2),
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            gradient: const LinearGradient(colors: [_gold, _purple]),
            border: Border.all(color: Colors.white24),
          ),
          child: CircleAvatar(
            backgroundColor: const Color(0xFF171D31),
            backgroundImage: image,
            child: image == null
                ? const Icon(Icons.person_rounded, color: Colors.white, size: 28)
                : null,
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'أهلاً، $name',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 18,
                  fontWeight: FontWeight.w800,
                ),
              ),
              Text(
                'LV.$level',
                style: const TextStyle(
                  color: _gold,
                  fontSize: 11,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ],
          ),
        ),
        _wallet(Icons.monetization_on_rounded, coins, _gold, 0),
        const SizedBox(width: 6),
        _wallet(Icons.diamond_rounded, diamonds, const Color(0xFF64D8FF), 1),
        const SizedBox(width: 6),
        IconButton(
          onPressed: () => _soon('الإشعارات'),
          icon: const Icon(Icons.notifications_none_rounded, color: Colors.white),
          tooltip: 'الإشعارات',
        ),
      ],
    );
  }

  Widget _wallet(
    IconData icon,
    String value,
    Color color,
    int tab,
  ) {
    return InkWell(
      onTap: () => _recharge(tab),
      borderRadius: BorderRadius.circular(14),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 7),
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: .06),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: Colors.white10),
        ),
        child: Row(
          children: [
            Icon(icon, color: color, size: 15),
            const SizedBox(width: 3),
            Text(
              value,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 11,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(width: 3),
            const Icon(
              Icons.add_circle_rounded,
              color: Color(0xFF9A5CFF),
              size: 15,
            ),
          ],
        ),
      ),
    );
  }

  Widget _searchBox() {
    return InkWell(
      onTap: _search,
      borderRadius: BorderRadius.circular(16),
      child: Container(
        height: 48,
        padding: const EdgeInsets.symmetric(horizontal: 14),
        decoration: BoxDecoration(
          color: _card,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: Colors.white10),
        ),
        child: const Row(
          children: [
            Icon(Icons.search_rounded, color: Colors.white54),
            SizedBox(width: 10),
            Text(
              'ابحث عن غرف، أصدقاء أو ID...',
              style: TextStyle(color: Colors.white54, fontSize: 13),
            ),
          ],
        ),
      ),
    );
  }

  Widget _hero() {
    final config = _data?.config ?? const <String, dynamic>{};
    final title = (config['heroTitle'] ?? 'صوتك يجمعنا').toString();
    final subtitle = (config['heroSubtitle'] ??
            'اكتشف الغرف والأصدقاء\nوعِش اللحظة مع مجتمعك')
        .toString();
    final imageUrl = config['heroImageUrl']?.toString().trim() ?? '';

    return Container(
      height: 175,
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(24),
        gradient: const LinearGradient(
          colors: [Color(0xFF5A19B8), Color(0xFF17103B), Color(0xFF08101E)],
        ),
        border: Border.all(color: _purple),
      ),
      child: Stack(
        fit: StackFit.expand,
        children: [
          if (imageUrl.isNotEmpty)
            CachedNetworkImage(
              imageUrl: imageUrl,
              fit: BoxFit.cover,
              fadeInDuration: const Duration(milliseconds: 180),
              errorWidget: (_, __, ___) => const SizedBox.shrink(),
            ),
          if (imageUrl.isNotEmpty)
            const DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.centerLeft,
                  end: Alignment.centerRight,
                  colors: [Color(0x33000000), Color(0xD911082A)],
                ),
              ),
            ),
          Padding(
            padding: const EdgeInsets.all(20),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(
                        title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: _gold,
                          fontSize: 25,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        subtitle,
                        maxLines: 3,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: Colors.white70,
                          height: 1.5,
                          fontSize: 13,
                        ),
                      ),
                    ],
                  ),
                ),
                if (imageUrl.isEmpty)
                  const Icon(Icons.mic_rounded, color: _gold, size: 70),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _sectionHeader(String title, String subtitle) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        Text(
          title,
          style: const TextStyle(
            color: Colors.white,
            fontSize: 18,
            fontWeight: FontWeight.w900,
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            subtitle,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(color: Colors.white38, fontSize: 10),
          ),
        ),
      ],
    );
  }
}

class _RoomCard extends StatelessWidget {
  const _RoomCard({
    required this.room,
    required this.onTap,
  });

  final DiscoveryRoom room;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(20),
      child: Container(
        width: 145,
        margin: const EdgeInsetsDirectional.only(end: 10),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(20),
          gradient: const LinearGradient(
            colors: [Color(0xFF251A42), Color(0xFF10121D)],
          ),
          border: Border.all(color: Colors.white10),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const CircleAvatar(
                  radius: 27,
                  backgroundColor: Color(0xFF372064),
                  child: Icon(Icons.mic_rounded, color: Color(0xFFFFD54A)),
                ),
                const Spacer(),
                if (room.isFeatured)
                  const Icon(
                    Icons.star_rounded,
                    color: Color(0xFFFFD54A),
                    size: 17,
                  ),
              ],
            ),
            const Spacer(),
            Text(
              room.title,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w800,
              ),
            ),
            Text(
              '${room.onlineCount} متصل',
              style: const TextStyle(color: Colors.white54, fontSize: 11),
            ),
          ],
        ),
      ),
    );
  }
}

class _ActiveRoomChip extends StatelessWidget {
  const _ActiveRoomChip({
    required this.room,
    required this.onTap,
  });

  final DiscoveryRoom room;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(18),
      child: Container(
        width: 210,
        margin: const EdgeInsetsDirectional.only(end: 10),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(
          color: const Color(0xFF111321),
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: Colors.white10),
        ),
        child: Row(
          children: [
            const CircleAvatar(
              radius: 23,
              backgroundColor: Color(0xFF2E1A50),
              child: Icon(Icons.graphic_eq_rounded, color: Color(0xFF8A3DFF)),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    room.title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  Text(
                    '${room.onlineCount} متصل الآن',
                    style: const TextStyle(color: Colors.white54, fontSize: 11),
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

class _Feature extends StatelessWidget {
  const _Feature(this.title, this.subtitle, this.icon, this.onTap);

  final String title;
  final String subtitle;
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(18),
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: const Color(0xFF111321),
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: Colors.white10),
        ),
        child: Row(
          children: [
            Icon(icon, color: const Color(0xFF8A3DFF), size: 28),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  Text(
                    subtitle,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(color: Colors.white38, fontSize: 10),
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
