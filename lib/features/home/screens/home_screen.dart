import 'dart:async';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../../../services/navigation_service.dart';
import '../../../utils/compact_number.dart';
import '../../wallet/screens/recharge_screen.dart';
import '../../profile/screens/public_profile_screen.dart';
import '../../profile/widgets/profile_avatar_with_frame.dart';
import '../../room/services/room_image_source.dart';
import '../../room/widgets/discovery_room_password_dialog.dart';
import '../services/discovery_service.dart';
import 'discovery_search_screen.dart';
import '../../../shared/widgets/loading_indicator.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({
    super.key,
    this.onOpenGames,
    this.onOpenRooms,
  });

  final VoidCallback? onOpenGames;
  final VoidCallback? onOpenRooms;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final DiscoveryService _discoveryService = DiscoveryService();
  final ScrollController _scrollController = ScrollController();
  final GlobalKey _eventsKey = GlobalKey();
  final GlobalKey _rankingKey = GlobalKey();

  HomeDiscoveryData? _data;
  StreamSubscription<User?>? _authSub;
  String? _loadedForUid;
  bool _loading = true;
  String? _error;

  static const _bg = Color(0xFF05060D);
  static const _card = Color(0xFF111321);
  static const _gold = Color(0xFFFFD54A);
  static const _purple = Color(0xFF8A3DFF);

  @override
  void initState() {
    super.initState();
    _loadedForUid = FirebaseAuth.instance.currentUser?.uid;
    _authSub = FirebaseAuth.instance.userChanges().listen((user) {
      final nextUid = user?.uid;
      if (nextUid == _loadedForUid) return;
      _loadedForUid = nextUid;
      if (!mounted) return;
      setState(() => _data = null);
      unawaited(_load());
    });
    _load();
  }

  @override
  void dispose() {
    _authSub?.cancel();
    _discoveryService.close();
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _load({bool forceRefresh = false}) async {
    final requestUid = FirebaseAuth.instance.currentUser?.uid;
    if (mounted) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }

    try {
      final data =
          await _discoveryService.loadHome(forceRefresh: forceRefresh);
      if (!mounted) return;
      if (FirebaseAuth.instance.currentUser?.uid != requestUid) return;
      _loadedForUid = requestUid;
      setState(() => _data = data);
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'تعذر تحديث الاستكشاف حالياً');
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
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

  Future<void> _openRoom(DiscoveryRoom room) async {
    final args = room.toNavigationArguments();
    final ownerUid =
        (room.data['ownerUid'] ?? room.data['ownerId'] ?? room.data['hostId'] ?? '')
            .toString();
    final currentUid = FirebaseAuth.instance.currentUser?.uid;
    final isOwner = currentUid != null && ownerUid == currentUid;

    if (room.isPasswordProtected && !isOwner) {
      final password =
          await showDiscoveryRoomPasswordPrompt(context, room.title);
      if (!mounted || password == null) return;
      args['roomPassword'] = password;
    }

    NavigationService.navigateTo(
      AppRoutes.voiceChatRoom,
      arguments: args,
    );
  }

  void _openPerson(DiscoveryPerson person) {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => PublicProfileScreen(userId: person.id),
      ),
    );
  }

  Future<void> _scrollTo(GlobalKey key) async {
    final targetContext = key.currentContext;
    if (targetContext == null) return;
    await Scrollable.ensureVisible(
      targetContext,
      duration: const Duration(milliseconds: 420),
      curve: Curves.easeOutCubic,
      alignment: .08,
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
    // Reuse the existing discovery snapshot, without any per-card requests.
    final discovery = _data;
    final suggestedRooms = discovery?.suggested ?? const <DiscoveryRoom>[];
    final activeRooms = discovery?.mostActive ?? const <DiscoveryRoom>[];
    final suggestedPeople =
        discovery?.suggestedPeople ?? const <DiscoveryPerson>[];
    final events = discovery?.events ?? const <Map<String, dynamic>>[];
    final ranking = discovery?.rankingPreview ?? const <Map<String, dynamic>>[];

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
              onRefresh: () => _load(forceRefresh: true),
              child: ListView(
                controller: _scrollController,
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 28),
                children: [
                  _header(
                    name,
                    level,
                    coins,
                    diamonds,
                    userData ?? const <String, dynamic>{},
                  ),
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
                      child: ShadowReadState(
                        icon: Icons.wifi_off_rounded,
                        message: _data == null
                            ? 'تعذر تحميل الاستكشاف. تحقق من اتصال الإنترنت.'
                            : 'تعذر تحديث الاستكشاف. يمكنك متابعة عرض البيانات السابقة.',
                        onRetry: _loading
                            ? null
                            : () => _load(forceRefresh: true),
                      ),
                    ),
                  const SizedBox(height: 18),
                  _searchBox(),
                  const SizedBox(height: 12),
                  _hero(),
                  if (discovery != null || _error == null) ...[
                    const SizedBox(height: 16),
                    _sectionHeader('غرف مقترحة', 'اختيارات مناسبة الآن'),
                    const SizedBox(height: 8),
                    _roomRail(suggestedRooms),
                    if (activeRooms.isNotEmpty) ...[
                      const SizedBox(height: 16),
                      _sectionHeader('الأكثر تفاعلاً', 'الغرف الأكثر نشاطاً'),
                      const SizedBox(height: 8),
                      _activityRail(activeRooms),
                    ],
                    if (suggestedPeople.isNotEmpty) ...[
                      const SizedBox(height: 16),
                      _sectionHeader('أشخاص مقترحون', 'اكتشف أعضاء جدد'),
                      const SizedBox(height: 8),
                      _peopleRail(suggestedPeople),
                    ],
                    if (events.isNotEmpty) ...[
                      const SizedBox(height: 16),
                      KeyedSubtree(
                        key: _eventsKey,
                        child: _sectionHeader('الفعاليات', 'أبرز ما يحدث في Shadow Live'),
                      ),
                      const SizedBox(height: 8),
                      _eventRail(events),
                    ],
                    if (ranking.isNotEmpty) ...[
                      const SizedBox(height: 16),
                      KeyedSubtree(
                        key: _rankingKey,
                        child: _sectionHeader('الترتيب', 'نجوم المجتمع'),
                      ),
                      const SizedBox(height: 8),
                      _rankingPreview(ranking),
                    ],
                    const SizedBox(height: 16),
                    _sectionHeader('استكشف Shadow Live', 'كل شيء من مكان واحد'),
                    const SizedBox(height: 8),
                    GridView.count(
                      crossAxisCount: 2,
                      shrinkWrap: true,
                      physics: const NeverScrollableScrollPhysics(),
                      mainAxisSpacing: 8,
                      crossAxisSpacing: 8,
                      childAspectRatio: 2.1,
                      children: [
                        _Feature('الأصدقاء', 'ابحث بالاسم أو ID',
                            Icons.people_alt_rounded, _search),
                        _Feature('الألعاب', 'العب واربح',
                            Icons.sports_esports_rounded, widget.onOpenGames),
                        if (events.isNotEmpty)
                          _Feature('الفعاليات', 'لا تفوّت الجديد',
                              Icons.celebration_rounded,
                              () => _scrollTo(_eventsKey)),
                        if (ranking.isNotEmpty)
                          _Feature('الترتيب', 'نجوم المجتمع',
                              Icons.emoji_events_rounded,
                              () => _scrollTo(_rankingKey)),
                      ],
                    ),
                  ],
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
        height: 126,
        child: Center(child: CircularProgressIndicator(color: _purple)),
      );
    }
    if (rooms.isEmpty) return _emptyRooms('لا توجد غرف مقترحة حالياً');

    return SizedBox(
      height: 126,
      child: ListView(
        scrollDirection: Axis.horizontal,
        children: rooms
            .take(8)
            .map(
              (room) => HomeCompactRoomCard(
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
      height: 78,
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

  Widget _peopleRail(List<DiscoveryPerson> people) {
    if (people.isEmpty) {
      return Container(
        height: 86,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        decoration: BoxDecoration(
          color: _card,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: Colors.white10),
        ),
        child: const Row(
          children: [
            Icon(Icons.people_outline_rounded, color: Colors.white30),
            SizedBox(width: 10),
            Expanded(
              child: Text(
                'ستظهر اقتراحات المجتمع هنا عند توفر ملفات عامة',
                style: TextStyle(color: Colors.white54, fontSize: 12),
              ),
            ),
          ],
        ),
      );
    }

    return SizedBox(
      height: 110,
      child: ListView(
        scrollDirection: Axis.horizontal,
        children: people
            .take(10)
            .map(
              (person) => HomeCompactPersonCard(
                person: person,
                onTap: () => _openPerson(person),
              ),
            )
            .toList(),
      ),
    );
  }

  Widget _eventRail(List<Map<String, dynamic>> events) {
    if (events.isEmpty) {
      return _remoteEmpty(
        icon: Icons.celebration_outlined,
        text: 'لا توجد فعاليات منشورة حالياً',
      );
    }

    return SizedBox(
      height: 108,
      child: ListView(
        scrollDirection: Axis.horizontal,
        children: events.take(8).map((event) {
          final title = (event['title'] ?? 'فعالية Shadow Live').toString();
          final subtitle = (event['subtitle'] ?? event['description'] ?? '')
              .toString()
              .trim();
          final imageUrl = (event['imageUrl'] ?? '').toString().trim();
          final badge = (event['badge'] ?? '').toString().trim();
          return Container(
            width: 250,
            margin: const EdgeInsetsDirectional.only(end: 10),
            clipBehavior: Clip.antiAlias,
            decoration: BoxDecoration(
              color: _card,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: Colors.white10),
            ),
            child: Stack(
              fit: StackFit.expand,
              children: [
                if (imageUrl.isNotEmpty)
                  CachedNetworkImage(
                    imageUrl: imageUrl,
                    fit: BoxFit.cover,
                    errorWidget: (_, __, ___) => const SizedBox.shrink(),
                  ),
                DecoratedBox(
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.centerLeft,
                      end: Alignment.centerRight,
                      colors: [
                        const Color(0xEE111321),
                        imageUrl.isNotEmpty
                            ? const Color(0x55111321)
                            : const Color(0xFF281847),
                      ],
                    ),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.all(14),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisAlignment: MainAxisAlignment.end,
                    children: [
                      if (badge.isNotEmpty)
                        Container(
                          margin: const EdgeInsets.only(bottom: 6),
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 4,
                          ),
                          decoration: BoxDecoration(
                            color: _purple.withValues(alpha: .25),
                            borderRadius: BorderRadius.circular(999),
                          ),
                          child: Text(
                            badge,
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 9,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                      Text(
                        title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 14,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      if (subtitle.isNotEmpty) ...[
                        const SizedBox(height: 3),
                        Text(
                          subtitle,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: Colors.white60,
                            fontSize: 10,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            ),
          );
        }).toList(),
      ),
    );
  }

  Widget _rankingPreview(List<Map<String, dynamic>> entries) {
    if (entries.isEmpty) {
      return _remoteEmpty(
        icon: Icons.emoji_events_outlined,
        text: 'سيظهر ترتيب المجتمع عند نشره من لوحة الإدارة',
      );
    }

    return Column(
      children: entries.take(3).toList().asMap().entries.map((item) {
        final index = item.key;
        final entry = item.value;
        final name = (entry['displayName'] ?? entry['name'] ?? 'مستخدم')
            .toString();
        final value = (entry['value'] ?? entry['score'] ?? '—').toString();
        final label = (entry['label'] ?? '').toString();
        // The ranking payload is already present in HomeDiscoveryData. Keep
        // rendering snapshot-only: no profile read or listener per ranking item.
        final avatarData = <String, dynamic>{
          ...entry,
          // Legacy ranking entries may use imageUrl. Preserve explicit
          // profile/asset choices instead of replacing them with a legacy URL.
          if ((entry['profileImageUrl'] ?? '').toString().trim().isEmpty &&
              (entry['profileAvatarAsset'] ?? '').toString().trim().isEmpty &&
              (entry['avatarUrl'] ?? '').toString().trim().isEmpty)
            'avatarUrl': (entry['imageUrl'] ?? '').toString(),
        };
        final rankingUserId =
            (entry['uid'] ?? entry['userId'] ?? '').toString();

        return Container(
          margin: EdgeInsets.only(bottom: index == 2 ? 0 : 8),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          decoration: BoxDecoration(
            color: _card,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: Colors.white10),
          ),
          child: Row(
            children: [
              SizedBox(
                width: 26,
                child: Text(
                  '#${index + 1}',
                  style: const TextStyle(
                    color: _gold,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              ProfileAvatarWithFrame(
                diameter: 40,
                userId: rankingUserId,
                fallbackProfile: avatarData,
                snapshotOnly: true,
                frameScale: 1,
                backgroundColor: const Color(0xFF281847),
                placeholderColor: Colors.white54,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    value,
                    style: const TextStyle(
                      color: _gold,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  if (label.isNotEmpty)
                    Text(
                      label,
                      style: const TextStyle(
                        color: Colors.white38,
                        fontSize: 9,
                      ),
                    ),
                ],
              ),
            ],
          ),
        );
      }).toList(),
    );
  }

  Widget _remoteEmpty({
    required IconData icon,
    required String text,
  }) {
    return Container(
      height: 68,
      padding: const EdgeInsets.symmetric(horizontal: 16),
      decoration: BoxDecoration(
        color: _card,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: Colors.white10),
      ),
      child: Row(
        children: [
          Icon(icon, color: Colors.white30),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              text,
              style: const TextStyle(
                color: Colors.white54,
                fontSize: 12,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _emptyRooms(String message) {
    return Container(
      height: 80,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: _card,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: Colors.white10),
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.mic_none_rounded, color: Colors.white38, size: 20),
          const SizedBox(height: 4),
          Text(
            message,
            style: const TextStyle(
              color: Colors.white70,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 2),
          const Text(
            'ستظهر الغرف النشطة هنا تلقائياً',
            style: TextStyle(color: Colors.white38, fontSize: 11),
          ),
        ],
      ),
    );
  }

  Widget _header(
    String name,
    String level,
    String coins,
    String diamonds,
    Map<String, dynamic> profile,
  ) {
    return Row(
      children: [
        ProfileAvatarWithFrame(
          diameter: 50,
          userId: _loadedForUid ?? '',
          fallbackProfile: profile,
          backgroundColor: const Color(0xFF171D31),
          placeholderColor: Colors.white,
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
        // Tasks are not implemented yet. Keep the reserved header slot
        // visibly disabled rather than linking to a fake task page.
        const IconButton(
          onPressed: null,
          tooltip: 'المهام اليومية والأسبوعية غير متاحة حالياً',
          icon: Icon(Icons.task_alt_rounded, color: Colors.white38),
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
      height: 145,
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
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
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
                          fontSize: 21,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        subtitle,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: Colors.white70,
                          height: 1.2,
                          fontSize: 11,
                        ),
                      ),
                      const SizedBox(height: 8),
                      SizedBox(
                        height: 36,
                        child: OutlinedButton.icon(
                          onPressed: widget.onOpenRooms,
                          icon: const Icon(Icons.meeting_room_rounded, size: 16),
                          label: const Text('استكشف الغرف'),
                          style: OutlinedButton.styleFrom(
                            foregroundColor: Colors.white,
                            side: const BorderSide(color: _gold),
                            visualDensity: VisualDensity.compact,
                            padding: const EdgeInsets.symmetric(horizontal: 10),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                if (imageUrl.isEmpty)
                  const Icon(Icons.mic_rounded, color: _gold, size: 48),
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
            fontSize: 16,
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

/// Both Home room rails use the existing room-surface image source.
/// No new reads or profile/avatar fallback paths are introduced.
class _RoomPreviewAvatar extends StatelessWidget {
  const _RoomPreviewAvatar({
    required this.room,
    required this.radius,
    required this.fallbackIcon,
  });

  final DiscoveryRoom room;
  final double radius;
  final IconData fallbackIcon;

  @override
  Widget build(BuildContext context) {
    final imageUrl = roomSurfaceImageUrl(room.data);
    final fallback = Icon(
      fallbackIcon,
      color: const Color(0xFFFFD54A),
      size: radius,
    );
    return ClipOval(
      child: SizedBox(
        width: radius * 2,
        height: radius * 2,
        child: ColoredBox(
          color: const Color(0xFF372064),
          child: imageUrl.isEmpty
              ? fallback
              : CachedNetworkImage(
                  imageUrl: imageUrl,
                  fit: BoxFit.cover,
                  placeholder: (_, __) => fallback,
                  errorWidget: (_, __, ___) => fallback,
                ),
        ),
      ),
    );
  }
}

class HomeCompactRoomCard extends StatelessWidget {
  const HomeCompactRoomCard({
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
        width: 124,
        margin: const EdgeInsetsDirectional.only(end: 8),
        padding: const EdgeInsets.all(10),
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
                _RoomPreviewAvatar(
                  room: room,
                  radius: 23,
                  fallbackIcon: Icons.mic_rounded,
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
              room.hasAvailablePresence
                  ? '${room.onlineCount} متصل'
                  : 'الحضور غير متاح',
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
        width: 192,
        margin: const EdgeInsetsDirectional.only(end: 8),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        decoration: BoxDecoration(
          color: const Color(0xFF111321),
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: Colors.white10),
        ),
        child: Row(
          children: [
            _RoomPreviewAvatar(
              room: room,
              radius: 21,
              fallbackIcon: Icons.graphic_eq_rounded,
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
                    room.hasAvailablePresence
                        ? '${room.onlineCount} متصل الآن'
                        : 'الحضور غير متاح',
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

class HomeCompactPersonCard extends StatelessWidget {
  const HomeCompactPersonCard({
    required this.person,
    required this.onTap,
  });

  final DiscoveryPerson person;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(18),
      child: Container(
        width: 100,
        margin: const EdgeInsetsDirectional.only(end: 8),
        padding: const EdgeInsets.all(8),
        decoration: BoxDecoration(
          color: const Color(0xFF111321),
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: Colors.white10),
        ),
        child: Column(
          children: [
            Stack(
              clipBehavior: Clip.none,
              children: [
                ProfileAvatarWithFrame(
                  diameter: 44,
                  userId: person.id,
                  fallbackProfile: person.data,
                  snapshotOnly: true,
                  backgroundColor: const Color(0xFF281847),
                  placeholderColor: Colors.white54,
                ),

              ],
            ),
            const SizedBox(height: 5),
            Text(
              person.displayName,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 11,
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              person.vipLevel > 0
                  ? 'VIP ${person.vipLevel} • LV.${person.level}'
                  : 'LV.${person.level}',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: person.vipLevel > 0
                    ? const Color(0xFFFFD54A)
                    : Colors.white38,
                fontSize: 9,
                fontWeight: FontWeight.w700,
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
  final VoidCallback? onTap;

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
