import 'dart:async';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../../../services/navigation_service.dart';
import '../../../utils/compact_number.dart';
import '../../wallet/screens/recharge_screen.dart';
import '../../profile/screens/public_profile_screen.dart';
import '../../profile/services/follow_service.dart';
import '../../profile/widgets/profile_avatar_with_frame.dart';
import '../../room/services/room_image_source.dart';
import '../../room/services/room_realtime_query_service.dart';
import '../../room/services/room_follow_navigation.dart';
import '../../room/widgets/discovery_room_password_dialog.dart';
import '../services/discovery_service.dart';
import 'discovery_search_screen.dart';
import 'home_more_rooms_screen.dart';
import '../../../shared/widgets/loading_indicator.dart';
import '../../../shared/widgets/country_selector.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({
    super.key,
    this.onOpenGames,
    this.onOpenRooms,
    this.onOpenProfile,
  });

  final VoidCallback? onOpenGames;
  final VoidCallback? onOpenRooms;
  final VoidCallback? onOpenProfile;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final DiscoveryService _discoveryService = DiscoveryService();
  final FollowService _followService = FollowService();
  final RoomRealtimeQueryService _roomFollowQuery = RoomRealtimeQueryService();
  Map<String, RoomFollowLocation> _roomFollowLocations = {};
  int _roomFollowRevision = 0;
  Timer? _roomFollowExpiry;
  final ScrollController _scrollController = ScrollController();
  final GlobalKey _eventsKey = GlobalKey();
  final GlobalKey _rankingKey = GlobalKey();

  HomeDiscoveryData? _data;
  // Null means the server follow state has not been verified. No guessed
  // follow buttons and no individual person listeners on the home feed.
  // Null: unverified. Never render a suggested profile before checking
  // privacy, blocks and outgoing follow state on the existing backend.
  Set<String>? _eligibleSuggestionIds;
  int _suggestionRevision = 0;
  final Set<String> _changingFollows = <String>{};
  StreamSubscription<User?>? _authSub;
  String? _loadedForUid;
  Future<void>? _pendingHomeLoad;
  String? _pendingHomeUid;
  int _homeLoadRevision = 0;
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
      setState(() {
        _data = null;
        _eligibleSuggestionIds = null;
        _roomFollowLocations = {};
        _roomFollowExpiry?.cancel();
        _roomFollowRevision++;
        _suggestionRevision++;
        _changingFollows.clear();
      });
      unawaited(_load());
    });
    _load();
  }

  @override
  void dispose() {
    _authSub?.cancel();
    _discoveryService.close();
    _roomFollowQuery.close();
    _roomFollowExpiry?.cancel();
    _scrollController.dispose();
    super.dispose();
  }

  /// One home read per account at a time. Pull-to-refresh and wallet-return
  /// refresh await the same in-flight future instead of doubling Firestore IO.
  /// A different signed-in account starts a new operation immediately.
  Future<void> _load({bool forceRefresh = false}) {
    final requestUid = FirebaseAuth.instance.currentUser?.uid;
    final pending = _pendingHomeLoad;
    if (pending != null && _pendingHomeUid == requestUid) return pending;

    final revision = ++_homeLoadRevision;
    final operation = _performHomeLoad(
      requestUid,
      revision,
      forceRefresh: forceRefresh,
    );
    _pendingHomeUid = requestUid;
    _pendingHomeLoad = operation;
    unawaited(operation.whenComplete(() {
      if (identical(_pendingHomeLoad, operation)) {
        _pendingHomeLoad = null;
        _pendingHomeUid = null;
      }
    }));
    return operation;
  }

  bool _isCurrentLoad(String? uid, int revision) =>
      mounted &&
      revision == _homeLoadRevision &&
      FirebaseAuth.instance.currentUser?.uid == uid;

  Future<void> _performHomeLoad(
    String? requestUid,
    int revision, {
    required bool forceRefresh,
  }) async {
    if (!mounted) return;
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final data =
          await _discoveryService.loadHome(forceRefresh: forceRefresh);
      if (!_isCurrentLoad(requestUid, revision)) return;
      _loadedForUid = requestUid;
      setState(() {
        _data = data;
        _eligibleSuggestionIds = null;
        _roomFollowLocations = {};
        _roomFollowExpiry?.cancel();
        _roomFollowRevision++;
      });
      unawaited(_refreshSuggestionFollows(
        data.suggestedPeople,
        requestUid,
        revision: revision,
      ));
      unawaited(_refreshRoomFollowLocations(
        data.suggestedPeople.take(10).toList(growable: false),
        requestUid,
        revision: revision,
      ));
    } catch (_) {
      // A failed request for a previous account cannot change the new home.
      if (_isCurrentLoad(requestUid, revision)) {
        setState(() => _error = 'تعذر تحديث الاستكشاف حالياً');
      }
    } finally {
      if (_isCurrentLoad(requestUid, revision)) {
        setState(() => _loading = false);
      }
    }
  }

  /// At most three ten-person server checks for the original 24 Home
  /// candidates. No per-avatar IO; failure leaves the people unlisted.
  Future<void> _refreshSuggestionFollows(
    List<DiscoveryPerson> people,
    String? expectedUid, {
    required int revision,
  }) async {
    final token = ++_suggestionRevision;
    final user = FirebaseAuth.instance.currentUser;
    if (user == null || user.isAnonymous || user.uid != expectedUid) {
      if (_isCurrentLoad(expectedUid, revision)) {
        setState(() => _eligibleSuggestionIds = <String>{});
      }
      return;
    }
    try {
      final eligible = <String>{};
      final candidates = people.take(24).toList(growable: false);
      for (var start = 0; start < candidates.length; start += 10) {
        final end = start + 10 < candidates.length
            ? start + 10 : candidates.length;
        eligible.addAll(await _followService.eligibleDiscoveryPeopleAmong(
          candidates.sublist(start, end).map((p) => p.id),
        ));
        if (!_isCurrentLoad(expectedUid, revision) ||
            token != _suggestionRevision) return;
      }
      if (!_isCurrentLoad(expectedUid, revision) ||
          token != _suggestionRevision) return;
      setState(() => _eligibleSuggestionIds = eligible);
    } catch (_) {
      if (!_isCurrentLoad(expectedUid, revision) ||
          token != _suggestionRevision) return;
      setState(() => _eligibleSuggestionIds = null);
    }
  }

  /// A maximum of two bounded API calls for ten Home circles, never
  /// one live listener or request per avatar. Fail closed on stale data.
  Future<void> _refreshRoomFollowLocations(
    List<DiscoveryPerson> people,
    String? expectedUid, {
    required int revision,
  }) async {
    final generation = ++_roomFollowRevision;
    if (expectedUid == null || expectedUid.isEmpty ||
        FirebaseAuth.instance.currentUser?.isAnonymous == true) return;
    final ids = people.map((p) => p.id).toSet().toList(growable: false);
    final found = <String, RoomFollowLocation>{};
    try {
      for (var offset = 0; offset < ids.length; offset += 8) {
        final end = offset + 8 < ids.length ? offset + 8 : ids.length;
        found.addAll(await _roomFollowQuery.resolveRoomFollows(
          ids.sublist(offset, end),
        ));
        if (!_isCurrentLoad(expectedUid, revision) ||
            generation != _roomFollowRevision) return;
      }
      if (!_isCurrentLoad(expectedUid, revision) ||
          generation != _roomFollowRevision) return;
      _roomFollowExpiry?.cancel();
      setState(() => _roomFollowLocations = found);
      if (found.isNotEmpty) {
        // Local TTL: expire all room badges together without background IO.
        _roomFollowExpiry = Timer(const Duration(seconds: 35), () {
          if (_isCurrentLoad(expectedUid, revision) &&
              generation == _roomFollowRevision) {
            setState(() => _roomFollowLocations = {});
          }
        });
      }
    } catch (_) {
      if (_isCurrentLoad(expectedUid, revision) &&
          generation == _roomFollowRevision) {
        setState(() => _roomFollowLocations = {});
      }
    }
  }

  Future<void> _navigateToSuggestedRoom(String targetUid) async {
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null || !_roomFollowLocations.containsKey(targetUid)) return;
    try {
      final message = await RoomFollowNavigation.open(
        context: context,
        targetUid: targetUid,
        query: _roomFollowQuery,
      );
      if (!mounted || FirebaseAuth.instance.currentUser?.uid != uid) return;
      if (message != null) {
        setState(() => _roomFollowLocations.remove(targetUid));
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(message)),
        );
      }
    } catch (_) {
      if (mounted && FirebaseAuth.instance.currentUser?.uid == uid) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('تعذر التتبّع حالياً. حاول مجدداً.')),
        );
      }
    }
  }

  bool _canFollowSuggestion(DiscoveryPerson person) {
    final user = FirebaseAuth.instance.currentUser;
    return user != null &&
        !user.isAnonymous &&
        user.uid != person.id &&
        _eligibleSuggestionIds?.contains(person.id) == true;
  }

  Future<void> _changeSuggestionFollow(DiscoveryPerson person) async {
    if (!_canFollowSuggestion(person) ||
        !_changingFollows.add(person.id)) return;
    final uid = FirebaseAuth.instance.currentUser?.uid;
    setState(() {});
    try {
      await _followService.setFollowing(person.id, true);
      if (!mounted || FirebaseAuth.instance.currentUser?.uid != uid) return;
      setState(() {
        // Hide immediately, but only after a confirmed successful follow.
        _suggestionRevision++;
        _eligibleSuggestionIds = <String>{...?_eligibleSuggestionIds}
          ..remove(person.id);
      });
    } catch (_) {
      if (mounted && FirebaseAuth.instance.currentUser?.uid == uid) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('تعذر المتابعة. حاول مرة أخرى.')),
        );
      }
    } finally {
      _changingFollows.remove(person.id);
      if (mounted) setState(() {});
    }
  }

  Future<void> _recharge(int tab) async {
    await Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => RechargeScreen(initialTab: tab)),
    );
    if (mounted) await _load();
  }

  Future<void> _showMorePeople() async {
    final uid = FirebaseAuth.instance.currentUser?.uid;
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => HomeMorePeopleScreen(
          initiallyShownIds:
              (_data?.suggestedPeople ?? const <DiscoveryPerson>[])
                  .where((person) =>
                      _eligibleSuggestionIds?.contains(person.id) == true)
                  .take(10)
                  .map((person) => person.id)
                  .toSet(),
        ),
      ),
    );
    if (!mounted || FirebaseAuth.instance.currentUser?.uid != uid) return;
    unawaited(_refreshSuggestionFollows(
      _data?.suggestedPeople ?? const <DiscoveryPerson>[],
      uid,
      revision: _homeLoadRevision,
    ));
  }

  void _moreRooms() {
    Navigator.of(context).push(MaterialPageRoute<void>(
      builder: (_) => HomeMoreRoomsScreen(
        initiallyShown: (_data?.suggested ?? const <DiscoveryRoom>[])
            .take(4).map((room) => room.id).toSet(),
      ),
    ));
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

  Future<void> _openPerson(DiscoveryPerson person) async {
    await Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => PublicProfileScreen(userId: person.id),
      ),
    );
    if (!mounted) return;
    // The profile itself can also change the relation. Refresh once on
    // return instead of leaving stale Home follow controls.
    unawaited(_refreshSuggestionFollows(
      _data?.suggestedPeople ?? const <DiscoveryPerson>[],
      FirebaseAuth.instance.currentUser?.uid,
      revision: _homeLoadRevision,
    ));
  }

  Future<void> _openPersonActions(DiscoveryPerson person) async {
    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: const Color(0xFF111321),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
      ),
      builder: (sheetContext) => Directionality(
        textDirection: TextDirection.rtl,
        child: HomePersonActionsSheet(
          person: person,
          isFollowing: false,
          onOpenProfile: () {
            Navigator.pop(sheetContext);
            unawaited(_openPerson(person));
          },
          onFollow: _canFollowSuggestion(person)
              ? () {
                  Navigator.pop(sheetContext);
                  unawaited(_changeSuggestionFollow(person));
                }
              : null,
          onRoomFollow: _roomFollowLocations.containsKey(person.id)
              ? () {
                  Navigator.pop(sheetContext);
                  unawaited(_navigateToSuggestedRoom(person.id));
                }
              : null,
        ),
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
    final identityLabel = homeIdentityLabel(
      userData ?? const <String, dynamic>{},
      isOwnAccount: true,
    );
    // These are the existing signed-in user's wallet snapshot fields, not
    // guessed balances. The profile screen also accepts the legacy 'balance'.
    final rawCoins = userData?['coins'] ?? userData?['balance'];
    final rawDiamonds = userData?['diamonds'];
    final coins = rawCoins == null ? '—' : formatCompactAmount(rawCoins);
    final diamonds =
        rawDiamonds == null ? '—' : formatCompactAmount(rawDiamonds);
    // Reuse the existing discovery snapshot, without any per-card requests.
    final discovery = _data;
    final suggestedRooms = discovery?.suggested ?? const <DiscoveryRoom>[];
    final activeRooms = discovery?.otherActiveForHome ?? const <DiscoveryRoom>[];
    final suggestedPeople =
        (discovery?.suggestedPeople ?? const <DiscoveryPerson>[])
            .where((person) =>
                _eligibleSuggestionIds?.contains(person.id) == true)
            .take(10)
            .toList(growable: false);
    final events = discovery?.events ?? const <Map<String, dynamic>>[];
    final ranking = discovery?.rankingPreview ?? const <Map<String, dynamic>>[];

    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: Colors.transparent,
        body: Container(
          decoration: const BoxDecoration(
            gradient: RadialGradient(
              center: Alignment(.7, -.9),
              radius: 1.25,
              colors: [Color(0xAA251047), Color(0x4405060D)],
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
                  HomeAccountHeader(
                    name: name,
                    identityLabel: identityLabel,
                    coins: coins,
                    diamonds: diamonds,
                    profile: userData ?? const <String, dynamic>{},
                    userId: _loadedForUid ?? '',
                    onOpenProfile: widget.onOpenProfile ??
                        () => NavigationService.navigateTo(AppRoutes.profile),
                    onOpenCoins: () => _recharge(0),
                    onOpenDiamonds: () => _recharge(1),
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
                    _sectionHeader('غرف مقترحة', 'اختيارات مناسبة الآن', onMore: _moreRooms),
                    const SizedBox(height: 8),
                    _roomRail(suggestedRooms),
                    if (activeRooms.isNotEmpty) ...[
                      const SizedBox(height: 16),
                      _sectionHeader('الأكثر تفاعلاً', 'الغرف الأكثر نشاطاً'),
                      const SizedBox(height: 8),
                      _activityRail(activeRooms),
                    ],
                    if (discovery?.suggestedPeople.isNotEmpty ?? false) ...[
                      const SizedBox(height: 16),
                      _sectionHeader('أشخاص مقترحون', 'اكتشف أعضاء جدد', onMore: _showMorePeople),
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
                        if (widget.onOpenGames != null)
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

    // Only four room images are built in the initial viewport. Use the same
    // already loaded discovery snapshot; no per-tile Firestore/presence reads.
    return GridView.count(
      crossAxisCount: 2,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      mainAxisSpacing: 8,
      crossAxisSpacing: 8,
      childAspectRatio: 1,
      children: rooms.take(4).map((room) {
        return HomeCompactRoomCard(
          room: room,
          onTap: () => _openRoom(room),
        );
      }).toList(growable: false),
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
                onTap: () => _openPersonActions(person),
                isFollowing: false,
                followBusy: _changingFollows.contains(person.id),
                onFollow: _canFollowSuggestion(person)
                    ? () => _changeSuggestionFollow(person)
                    : null,
                onRoomFollow: _roomFollowLocations.containsKey(person.id)
                    ? () => _navigateToSuggestedRoom(person.id)
                    : null,
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
            Expanded(
              child: Text(
                'ابحث عن غرف، أصدقاء أو ID...',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(color: Colors.white54, fontSize: 13),
              ),
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
                        height: 44,
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

  Widget _sectionHeader(String title, String subtitle, {VoidCallback? onMore}) {
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
        if (onMore != null)
          TextButton(
            onPressed: onMore,
            style: TextButton.styleFrom(
              foregroundColor: _gold,
              minimumSize: const Size(68, 44),
            ),
            child: const Text('عرض المزيد',
                style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800)),
          ),
      ],
    );
  }
}

/// Additional public profiles. Fixed-size Firestore cursors and the existing
/// HomeCompactPersonCard/FollowService are reused; no per-person listeners.
class HomeMorePeopleScreen extends StatefulWidget {
  const HomeMorePeopleScreen({
    super.key,
    required this.initiallyShownIds,
  });

  final Set<String> initiallyShownIds;

  @override
  State<HomeMorePeopleScreen> createState() => _HomeMorePeopleScreenState();
}

class _HomeMorePeopleScreenState extends State<HomeMorePeopleScreen> {
  final DiscoveryService _discovery = DiscoveryService();
  final FollowService _follow = FollowService();
  final ScrollController _scroll = ScrollController();
  final List<DiscoveryPerson> _people = [];
  final Set<String> _seen = {};
  final Set<String> _successfullyFollowed = {};
  final Set<String> _busyFollow = {};
  final Map<String, bool> _followState = {};
  DocumentSnapshot<Map<String, dynamic>>? _cursor;
  StreamSubscription<User?>? _authSub;
  String? _uid;
  int _generation = 0;
  bool _loading = false;
  bool _hasMore = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _uid = FirebaseAuth.instance.currentUser?.uid;
    _scroll.addListener(_onScroll);
    _authSub = FirebaseAuth.instance.userChanges().listen((user) {
      if (user?.uid == _uid || !mounted) return;
      setState(() {
        _generation++;
        _uid = user?.uid;
        _people.clear();
        _seen.clear();
        _successfullyFollowed.clear();
        _followState.clear();
        _busyFollow.clear();
        _cursor = null;
        _hasMore = true;
        _loading = false;
        _error = null;
      });
      unawaited(_loadMore());
    });
    unawaited(_loadMore());
  }

  void _onScroll() {
    if (_scroll.hasClients && _scroll.position.extentAfter < 380) {
      unawaited(_loadMore());
    }
  }

  Future<void> _loadMore() async {
    if (_loading || !_hasMore) return;
    final generation = _generation;
    final requestUid = _uid;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final page = await _discovery.loadPeoplePage(after: _cursor);
      if (!mounted || generation != _generation || requestUid != _uid) return;
      final next = page.people.where((person) =>
          !widget.initiallyShownIds.contains(person.id) &&
          !_successfullyFollowed.contains(person.id) &&
          !_seen.contains(person.id)).toList(growable: false);

      // A single server batch checks both block directions, privacy,
      // and outgoing follow status. Unknown state is never displayed.
      final eligible = await _follow.eligibleDiscoveryPeopleAmong(
        next.map((person) => person.id),
      );
      if (!mounted || generation != _generation || requestUid != _uid) return;
      setState(() {
        _cursor = page.nextCursor;
        _hasMore = page.hasMore;
        for (final person in next) {
          if (eligible.contains(person.id) &&
              !_successfullyFollowed.contains(person.id) &&
              _seen.add(person.id)) {
            _people.add(person);
            _followState[person.id] = false;
          }
        }
      });
    } catch (_) {
      if (mounted && generation == _generation && requestUid == _uid) {
        setState(() => _error = 'تعذر تحميل الأشخاص. حاول مرة أخرى.');
      }
    } finally {
      if (mounted && generation == _generation && requestUid == _uid) {
        setState(() => _loading = false);
      }
    }
  }

  bool _canFollow(DiscoveryPerson person) {
    final user = FirebaseAuth.instance.currentUser;
    return user != null &&
        !user.isAnonymous &&
        user.uid == _uid &&
        user.uid != person.id &&
        _followState.containsKey(person.id);
  }

  Future<void> _changeFollow(DiscoveryPerson person) async {
    if (!_canFollow(person) || !_busyFollow.add(person.id)) return;
    final generation = _generation;
    final requestUid = _uid;
    setState(() {});
    try {
      await _follow.setFollowing(person.id, true);
      if (mounted && generation == _generation && requestUid == _uid) {
        setState(() {
          _successfullyFollowed.add(person.id);
          _people.removeWhere((candidate) => candidate.id == person.id);
          _followState.remove(person.id);
        });
      }
    } catch (_) {
      if (mounted && generation == _generation && requestUid == _uid) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('تعذر تحديث المتابعة. حاول مرة أخرى.')),
        );
      }
    } finally {
      if (generation == _generation) {
        _busyFollow.remove(person.id);
        if (mounted) setState(() {});
      }
    }
  }

  Future<void> _openPerson(DiscoveryPerson person) async {
    final generation = _generation;
    final uid = _uid;
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => PublicProfileScreen(userId: person.id),
      ),
    );
    if (!mounted || generation != _generation || uid != _uid) return;
    try {
      final stillEligible =
          await _follow.eligibleDiscoveryPeopleAmong([person.id]);
      if (!mounted || generation != _generation || uid != _uid) return;
      if (!stillEligible.contains(person.id)) {
        setState(() {
          _successfullyFollowed.add(person.id);
          _people.removeWhere((candidate) => candidate.id == person.id);
          _followState.remove(person.id);
        });
      }
    } catch (_) {
      if (mounted && generation == _generation && uid == _uid) {
        setState(() {
          _people.removeWhere((candidate) => candidate.id == person.id);
          _followState.remove(person.id);
        });
      }
    }
  }

  Future<void> _openActions(DiscoveryPerson person) async {
    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: const Color(0xFF111321),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(22)),
      ),
      builder: (sheetContext) => Directionality(
        textDirection: TextDirection.rtl,
        child: HomePersonActionsSheet(
          person: person,
          isFollowing: false,
          onOpenProfile: () {
            Navigator.pop(sheetContext);
            unawaited(_openPerson(person));
          },
          onFollow: _canFollow(person) ? () {
            Navigator.pop(sheetContext);
            unawaited(_changeFollow(person));
          } : null,
        ),
      ),
    );
  }

  Widget _footer() {
    if (_loading) {
      return const Padding(
        padding: EdgeInsets.all(20),
        child: Center(child: CircularProgressIndicator(
          color: Color(0xFF8A3DFF),
        )),
      );
    }
    if (_error != null) {
      return Column(children: [
        Text(_error!, style: const TextStyle(color: Colors.white70)),
        TextButton(onPressed: _loadMore, child: const Text('إعادة المحاولة')),
      ]);
    }
    if (_hasMore) {
      // Manual continuation for a page containing only excluded/hidden users.
      return TextButton(onPressed: _loadMore, child: const Text('تحميل المزيد'));
    }
    return const Padding(
      padding: EdgeInsets.all(20),
      child: Center(child: Text('وصلت إلى نهاية الأشخاص',
          style: TextStyle(color: Colors.white54))),
    );
  }

  @override
  void dispose() {
    _authSub?.cancel();
    _scroll.removeListener(_onScroll);
    _scroll.dispose();
    _discovery.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final width = MediaQuery.sizeOf(context).width;
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: const Color(0xFF05060D),
        appBar: AppBar(
          title: const Text('أشخاص مقترحون'),
          foregroundColor: const Color(0xFFFFD54A),
          backgroundColor: const Color(0xFF111321),
        ),
        body: CustomScrollView(
          controller: _scroll,
          slivers: [
            if (_people.isNotEmpty)
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(12, 16, 12, 0),
                sliver: SliverGrid(
                  delegate: SliverChildBuilderDelegate(
                    (context, index) {
                      final person = _people[index];
                      return Center(
                        child: HomeCompactPersonCard(
                          key: ValueKey(person.id),
                          person: person,
                          onTap: () => _openActions(person),
                          isFollowing: false,
                          followBusy: _busyFollow.contains(person.id),
                          onFollow: _canFollow(person)
                              ? () => _changeFollow(person)
                              : null,
                        ),
                      );
                    },
                    childCount: _people.length,
                  ),
                  gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                    crossAxisCount: width < 360 ? 2 : 3,
                    mainAxisExtent: 126,
                    mainAxisSpacing: 8,
                    crossAxisSpacing: 4,
                  ),
                ),
              ),
            SliverToBoxAdapter(child: _footer()),
          ],
        ),
      ),
    );
  }
}

/// Account and both wallet shortcuts share one already loaded user snapshot.
/// On narrow devices the identity and balances have separate rows, so long
/// names never squeeze the finance buttons or the reserved tasks control.
class HomeAccountHeader extends StatelessWidget {
  const HomeAccountHeader({
    super.key,
    required this.name,
    this.identityLabel,
    required this.coins,
    required this.diamonds,
    required this.profile,
    required this.userId,
    required this.onOpenProfile,
    required this.onOpenCoins,
    required this.onOpenDiamonds,
  });

  final String name;
  final String? identityLabel;
  final String coins;
  final String diamonds;
  final Map<String, dynamic> profile;
  final String userId;
  final VoidCallback onOpenProfile;
  final VoidCallback onOpenCoins;
  final VoidCallback onOpenDiamonds;

  static const _gold = Color(0xFFFFD54A);
  static const _cyan = Color(0xFF64D8FF);

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: Semantics(
                button: true,
                label: 'فتح ملفي الشخصي',
                child: InkWell(
                  key: const Key('home-account-profile'),
                  onTap: onOpenProfile,
                  borderRadius: BorderRadius.circular(16),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 3),
                    child: Row(
                      children: [
                        ProfileAvatarWithFrame(
                          diameter: 44,
                          userId: userId,
                          fallbackProfile: profile,
                          snapshotOnly: true,
                          backgroundColor: const Color(0xFF171D31),
                          placeholderColor: Colors.white,
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                name,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontSize: 16,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                              if (identityLabel != null) ...[
                                const SizedBox(height: 3),
                                Text(
                                  identityLabel!,
                                  style: const TextStyle(
                                    color: _gold,
                                    fontSize: 11,
                                    fontWeight: FontWeight.w800,
                                  ),
                                ),
                              ],
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
            const SizedBox(width: 8),
            // The task system is not ready: never navigate to a fake page.
            const IconButton(
              onPressed: null,
              tooltip: 'المهام اليومية والأسبوعية غير متاحة حالياً',
              icon: Icon(Icons.task_alt_rounded, color: Colors.white38),
            ),
          ],
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(
              child: HomeBalanceShortcut(
                label: 'كوينز',
                value: coins,
                icon: Icons.monetization_on_rounded,
                color: _gold,
                onTap: onOpenCoins,
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: HomeBalanceShortcut(
                label: 'ألماس',
                value: diamonds,
                icon: Icons.diamond_rounded,
                color: _cyan,
                onTap: onOpenDiamonds,
              ),
            ),
          ],
        ),
      ],
    );
  }
}

/// Keep the existing recharge/wallet navigation for each currency; this
/// component renders the supplied snapshot and never loads funds itself.
class HomeBalanceShortcut extends StatelessWidget {
  const HomeBalanceShortcut({
    super.key,
    required this.label,
    required this.value,
    required this.icon,
    required this.color,
    required this.onTap,
  });

  final String label;
  final String value;
  final IconData icon;
  final Color color;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: 'فتح محفظة $label',
      child: InkWell(
        key: Key('home-balance-$label'),
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: Container(
          height: 44,
          padding: const EdgeInsets.symmetric(horizontal: 10),
          decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: .06),
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: Colors.white12),
          ),
          child: Row(
            children: [
              Icon(icon, size: 19, color: color),
              const SizedBox(width: 7),
              Expanded(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Colors.white60,
                        fontSize: 10,
                      ),
                    ),
                    Text(
                      value,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 13,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 4),
              const Icon(
                Icons.add_circle_rounded,
                color: Color(0xFF9A5CFF),
                size: 16,
              ),
            ],
          ),
        ),
      ),
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

/// The default square Home room preview. Cosmetic room-card frames are a
/// separate feature; this widget only uses the existing room surface image and
/// room metadata from the single bounded discovery snapshot.
class HomeCompactRoomCard extends StatelessWidget {
  const HomeCompactRoomCard({
    super.key,
    required this.room,
    required this.onTap,
  });

  final DiscoveryRoom room;
  final VoidCallback onTap;

  ShadowCountryOption? get _country {
    final raw = (room.data['country'] ??
            room.data['countryName'] ??
            room.data['countryCode'] ??
            '')
        .toString()
        .trim();
    if (raw.isEmpty) return null;
    final named = shadowCountryByName(raw);
    if (named != null && named.isoCode.isNotEmpty) return named;
    final iso = raw.toUpperCase();
    for (final option in shadowCountries) {
      if (option.isoCode == iso && iso.isNotEmpty) return option;
    }
    return null;
  }

  String get _category {
    final type = (room.data['roomType'] ?? room.data['type'] ?? '')
        .toString()
        .trim();
    if (type == 'agency') return 'وكالة';
    if (isOfficialRoomForDiscovery(room)) return 'رسمية';
    final name = (room.data['category'] ?? '').toString().trim();
    return name.isEmpty ? 'دردشة' : name;
  }

  @override
  Widget build(BuildContext context) {
    final country = _country;
    final imageUrl = roomSurfaceImageUrl(room.data);
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(18),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(18),
        child: Stack(
          fit: StackFit.expand,
          children: [
            const ColoredBox(color: Color(0xFF251A42)),
            if (imageUrl.isNotEmpty)
              CachedNetworkImage(
                imageUrl: imageUrl,
                fit: BoxFit.cover,
                errorWidget: (_, __, ___) => const Center(
                  child: Icon(Icons.mic_rounded,
                      color: Color(0xFFFFD54A), size: 36),
                ),
                placeholder: (_, __) => const Center(
                  child: Icon(Icons.mic_rounded,
                      color: Color(0xFFFFD54A), size: 36),
                ),
              )
            else
              const Center(
                child: Icon(Icons.mic_rounded,
                    color: Color(0xFFFFD54A), size: 36),
              ),
            const DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    Color(0xB3090718),
                    Color(0x00090718),
                    Color(0xED090718),
                  ],
                  stops: [0, .45, 1],
                ),
              ),
            ),
            PositionedDirectional(
              top: 9,
              start: 9,
              end: 56,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '${country == null ? '' : '${country.flag} '}$_category',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 11,
                      color: Colors.white,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  if (country != null)
                    Text(
                      country.nameAr,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 10,
                        color: Colors.white70,
                      ),
                    ),
                ],
              ),
            ),
            PositionedDirectional(
              top: 8,
              end: 8,
              child: DecoratedBox(
                decoration: BoxDecoration(
                  color: const Color(0xC0090718),
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 4),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.people_alt_rounded,
                          color: Color(0xFFFFD54A), size: 12),
                      const SizedBox(width: 3),
                      Text(
                        room.hasAvailablePresence
                            ? '${room.onlineCount}'
                            : '—',
                        semanticsLabel: room.hasAvailablePresence
                            ? '${room.onlineCount} متصل'
                            : 'الحضور غير متاح',
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 11,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
            PositionedDirectional(
              start: 10,
              end: 10,
              bottom: 10,
              child: Text(
                room.title,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w900,
                  fontSize: 13,
                ),
              ),
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

/// A lightweight circular suggestion with an independently tappable follow
/// control at the avatar's upper corner. Uses only the existing profile
/// snapshot and bounded follow batch from the parent home page.
class HomeCompactPersonCard extends StatelessWidget {
  const HomeCompactPersonCard({
    super.key,
    required this.person,
    required this.onTap,
    this.isFollowing,
    this.followBusy = false,
    this.onFollow,
    this.onRoomFollow,
  });

  final DiscoveryPerson person;
  final VoidCallback onTap;
  final bool? isFollowing;
  final bool followBusy;
  final VoidCallback? onFollow;
  final VoidCallback? onRoomFollow;

  @override
  Widget build(BuildContext context) {
    final identityLabel = person.identityLabel;
    return SizedBox(
      width: 104,
      child: Padding(
        padding: const EdgeInsetsDirectional.only(end: 8),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(48),
          child: Column(
            children: [
              SizedBox(
                height: 73,
                width: 90,
                child: Stack(
                  alignment: Alignment.center,
                  clipBehavior: Clip.none,
                  children: [
                    ProfileAvatarWithFrame(
                      diameter: 64,
                      frameScale: 1.08,
                      userId: person.id,
                      fallbackProfile: person.data,
                      snapshotOnly: true,
                      backgroundColor: const Color(0xFF281847),
                      placeholderColor: Colors.white54,
                    ),
                    if (onFollow != null)
                      PositionedDirectional(
                        top: 0,
                        end: 0,
                        child: SizedBox(
                          width: 44,
                          height: 44,
                          child: IconButton(
                            key: Key('home-follow-${person.id}'),
                            tooltip: isFollowing == true
                                ? 'إلغاء المتابعة'
                                : 'متابعة',
                            onPressed: followBusy ? null : onFollow,
                            padding: EdgeInsets.zero,
                            constraints: const BoxConstraints.tightFor(
                              width: 44,
                              height: 44,
                            ),
                            icon: Container(
                              width: 26,
                              height: 26,
                              decoration: BoxDecoration(
                                color: const Color(0xFF1C1730),
                                shape: BoxShape.circle,
                                border: Border.all(
                                  color: const Color(0xFFFFD54A),
                                ),
                              ),
                              child: Icon(
                                isFollowing == true
                                    ? Icons.person_remove_alt_1_rounded
                                    : Icons.person_add_alt_1_rounded,
                                color: const Color(0xFFFFD54A),
                                size: 16,
                              ),
                            ),
                          ),
                        ),
                      ),
                    if (onRoomFollow != null)
                      PositionedDirectional(
                        bottom: 0,
                        start: 0,
                        child: SizedBox(
                          width: 38,
                          height: 38,
                          child: IconButton(
                            key: Key('home-room-follow-${person.id}'),
                            tooltip: 'في غرفة — تتبّع',
                            onPressed: onRoomFollow,
                            padding: EdgeInsets.zero,
                            icon: Container(
                              width: 27,
                              height: 27,
                              decoration: BoxDecoration(
                                color: const Color(0xFF20152D),
                                shape: BoxShape.circle,
                                border: Border.all(
                                  color: const Color(0xFFFFD54A),
                                ),
                              ),
                              child: const Icon(
                                Icons.graphic_eq_rounded,
                                size: 16,
                                color: Color(0xFFFFD54A),
                              ),
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
              const SizedBox(height: 3),
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
              if (identityLabel != null) ...[
                const SizedBox(height: 2),
                Text(
                  identityLabel,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: person.vipLevel > 0
                        ? const Color(0xFFFFD54A)
                        : Colors.white70,
                    fontSize: 9,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// Room choice must be absent until a verified server-side user-to-room
/// presence proof and visitor access check exists. Do not infer it from
/// room owner ids, cached public_profiles.isOnline, or room headcounts.
class HomePersonActionsSheet extends StatelessWidget {
  const HomePersonActionsSheet({
    super.key,
    required this.person,
    required this.onOpenProfile,
    this.isFollowing,
    this.onFollow,
    this.onRoomFollow,
  });

  final DiscoveryPerson person;
  final VoidCallback onOpenProfile;
  final bool? isFollowing;
  final VoidCallback? onFollow;
  final VoidCallback? onRoomFollow;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 18),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              person.displayName,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 17,
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 8),
            ListTile(
              key: const Key('home-person-view-profile'),
              leading: const Icon(
                Icons.account_circle_outlined,
                color: Color(0xFFB692FF),
              ),
              title: const Text(
                'عرض الملف الشخصي',
                style: TextStyle(color: Colors.white),
              ),
              onTap: onOpenProfile,
            ),
            if (onRoomFollow != null)
              ListTile(
                key: const Key('home-person-room-follow'),
                leading: const Icon(
                  Icons.graphic_eq_rounded,
                  color: Color(0xFFFFD54A),
                ),
                title: const Text(
                  'التتبّع إلى الغرفة',
                  style: TextStyle(color: Colors.white),
                ),
                onTap: onRoomFollow,
              ),
            if (onFollow != null)
              ListTile(
                key: const Key('home-person-follow'),
                leading: Icon(
                  isFollowing == true
                      ? Icons.person_remove_alt_1_rounded
                      : Icons.person_add_alt_1_rounded,
                  color: const Color(0xFFFFD54A),
                ),
                title: Text(
                  isFollowing == true ? 'إلغاء المتابعة' : 'متابعة',
                  style: const TextStyle(color: Colors.white),
                ),
                onTap: onFollow,
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
