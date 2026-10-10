import 'package:cached_network_image/cached_network_image.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../../features/home/screens/discovery_search_screen.dart';
import '../../features/home/services/discovery_service.dart';
import '../../features/room/services/room_action_service.dart';
import '../../features/room/services/room_image_source.dart';
import '../../features/room/widgets/discovery_room_password_dialog.dart';
import '../../services/navigation_service.dart';

/// Compatibility wrappers: the shared discovery service owns the rules.
bool isOfficialDiscoveryRoom(DiscoveryRoom room) =>
    isOfficialRoomForDiscovery(room);

bool isPinnedOfficialDiscoveryRoom(DiscoveryRoom room) =>
    isPinnedOfficialRoomForDiscovery(room);

int comparePublicDiscoveryRooms(DiscoveryRoom a, DiscoveryRoom b) =>
    compareRoomsByDiscoveryPriority(a, b);

/// Reuse already verified public discovery counts for saved library entries.
/// Server-saved favorite/history metadata is not a live presence reading.
/// No extra query is issued, and hidden rooms remain unverified.
List<DiscoveryRoom> roomLibraryWithVerifiedPresence(
  Iterable<DiscoveryRoom> savedRooms,
  Iterable<DiscoveryRoom> publicRooms,
) {
  final liveCounts = <String, int>{
    for (final room in publicRooms)
      if (room.data['presenceState'] == 'live') room.id: room.onlineCount,
  };
  return [
    for (final room in savedRooms)
      roomWithVerifiedPresence(room, liveCounts[room.id]),
  ];
}

class RoomListScreen extends StatefulWidget {
  const RoomListScreen({super.key});

  @override
  State<RoomListScreen> createState() => _RoomListScreenState();
}

class _RoomListScreenState extends State<RoomListScreen> {
  final DiscoveryService _service = DiscoveryService();
  final RoomActionService _roomActions = RoomActionService();

  List<DiscoveryRoom> _rooms = const [];
  bool _loading = true;
  bool _openingPersonalRoom = false;
  String? _error;
  String _category = 'الكل';
  String _viewMode = 'all';
  bool _libraryLoading = false;
  bool _libraryError = false;
  bool _libraryLoaded = false;
  String? _libraryUid;
  final Set<String> _savingFavoriteIds = <String>{};
  List<DiscoveryRoom> _favoriteRooms = const [];
  List<DiscoveryRoom> _historyRooms = const [];

  static const _bg = Color(0xFF05060D);
  static const _card = Color(0xFF111321);
  static const _purple = Color(0xFF8A3DFF);
  static const _gold = Color(0xFFFFD54A);

  @override
  void initState() {
    super.initState();
    _load();
    // One bounded library read per signed-in screen, reused by both tabs
    // and the favorite action. No per-card reads or realtime listeners.
    final user = FirebaseAuth.instance.currentUser;
    if (user != null && !user.isAnonymous) _loadRoomLibrary();
  }

  Future<void> _load({bool forceRefresh = false}) async {
    if (mounted) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }

    try {
      final rooms = [
        ...await _service.loadRooms(forceRefresh: forceRefresh),
      ]..sort(comparePublicDiscoveryRooms);
      if (mounted) {
        setState(() {
          _rooms = rooms;
          if (_viewMode == 'all') _resetUnavailableCustomFilter(rooms);
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _error = 'تعذر تحميل الغرف حالياً';
          // A failed refresh invalidates previously verified live counts.
          _rooms = [
            for (final room in _rooms) roomWithVerifiedPresence(room, null),
          ];
        });
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _roomCategory(DiscoveryRoom room) {
    if (_isAgencyRoom(room)) return 'وكالة';
    final value = room.data['category'] ?? room.data['type'] ?? '';
    final category = value.toString().trim();
    return category.isEmpty ? 'أخرى' : category;
  }

  String _roomType(DiscoveryRoom room) =>
      (room.data['roomType'] ?? room.data['type'] ?? 'personal')
          .toString()
          .trim();

  bool _isAgencyRoom(DiscoveryRoom room) => _roomType(room) == 'agency';

  bool _isOfficialRoom(DiscoveryRoom room) => isOfficialDiscoveryRoom(room);

  bool _matchesRoomFilter(DiscoveryRoom room, String filter) {
    switch (filter) {
      case 'الكل':
        return true;
      case 'وكالات':
        return _isAgencyRoom(room);
      case 'رسمية':
        return _isOfficialRoom(room);
      case 'دردشة':
        return !_isAgencyRoom(room) &&
            !_isOfficialRoom(room) &&
            _roomCategory(room) == 'دردشة';
      default:
        return !_isAgencyRoom(room) &&
            !_isOfficialRoom(room) &&
            _roomCategory(room) == filter;
    }
  }

  static const _fixedCategories = ['الكل', 'دردشة', 'رسمية', 'وكالات'];

  void _resetUnavailableCustomFilter(Iterable<DiscoveryRoom> rooms) {
    // Keep named tabs selectable when empty, but don't strand users on a
    // custom category that disappeared after an actual data refresh.
    if (_fixedCategories.contains(_category)) return;
    if (!rooms.any((room) => _matchesRoomFilter(room, _category))) {
      _category = 'الكل';
    }
  }

  List<String> get _categories {
    final values = <String>{};
    for (final room in _sourceRooms) {
      if (_isAgencyRoom(room) || _isOfficialRoom(room)) continue;
      final category = _roomCategory(room);
      if (!_fixedCategories.contains(category)) values.add(category);
    }
    final result = values.toList()..sort();
    return [..._fixedCategories, ...result];
  }

  List<DiscoveryRoom> get _sourceRooms {
    final uid = FirebaseAuth.instance.currentUser?.uid;
    // Never show one account's private library under another account.
    if (_viewMode != 'all' && (!_libraryLoaded || _libraryUid != uid)) {
      return const [];
    }
    // Do not reuse previous live counts while a refresh is pending/failed.
    final publicRooms =
        _loading || _error != null ? const <DiscoveryRoom>[] : _rooms;
    switch (_viewMode) {
      case 'favorites':
        return roomLibraryWithVerifiedPresence(_favoriteRooms, publicRooms);
      case 'history':
        return roomLibraryWithVerifiedPresence(_historyRooms, publicRooms);
      default:
        return _rooms;
    }
  }

  List<DiscoveryRoom> get _visibleRooms {
    final source = _sourceRooms;
    return source
        .where((room) => _matchesRoomFilter(room, _category))
        .toList(growable: false);
  }

  Future<void> _loadRoomLibrary({bool forceRefresh = false}) async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null || user.isAnonymous || _libraryLoading) return;
    if (!forceRefresh && _libraryLoaded && _libraryUid == user.uid) return;
    setState(() {
      _libraryLoading = true;
      _libraryError = false;
    });
    try {
      final library = await _roomActions.loadRoomLibrary();

      DiscoveryRoom parse(Map<String, dynamic> room) {
        final id = (room['roomId'] ?? '').toString();
        return DiscoveryRoom(id: id, data: room);
      }

      if (mounted && FirebaseAuth.instance.currentUser?.uid == user.uid) {
        setState(() {
          _libraryUid = user.uid;
          _libraryLoaded = true;
          _favoriteRooms = library.favorites
              .where((room) => (room['roomId'] ?? '').toString().isNotEmpty)
              .map(parse)
              .toList(growable: false);
          _historyRooms = library.history
              .where((room) => (room['roomId'] ?? '').toString().isNotEmpty)
              .map(parse)
              .toList(growable: false);
          if (_viewMode == 'favorites') {
            _resetUnavailableCustomFilter(_favoriteRooms);
          } else if (_viewMode == 'history') {
            _resetUnavailableCustomFilter(_historyRooms);
          }
        });
      }
    } catch (_) {
      if (mounted && FirebaseAuth.instance.currentUser?.uid == user.uid) {
        setState(() => _libraryError = true);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('تعذر تحميل المفضلة أو السجل. يمكنك إعادة المحاولة.'),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _libraryLoading = false);
    }
  }

  Future<void> _toggleRoomFavorite(DiscoveryRoom room) async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null || user.isAnonymous) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('إضافة غرفة للمفضلة تحتاج تسجيل الدخول.')),
      );
      return;
    }
    if (_libraryLoading || _savingFavoriteIds.contains(room.id)) return;
    if (!_libraryLoaded || _libraryUid != user.uid || _libraryError) {
      await _loadRoomLibrary(forceRefresh: true);
      if (!mounted || !_libraryLoaded || _libraryUid != user.uid ||
          _libraryError) return;
    }

    final wasFavorite = _favoriteRooms.any((entry) => entry.id == room.id);
    setState(() => _savingFavoriteIds.add(room.id));
    try {
      final favorite = await _roomActions.setRoomFavorite(
        roomId: room.id,
        favorite: !wasFavorite,
      );
      if (!mounted || FirebaseAuth.instance.currentUser?.uid != user.uid) {
        return;
      }
      setState(() {
        _favoriteRooms = [
          if (favorite) room,
          ..._favoriteRooms.where((entry) => entry.id != room.id),
        ];
      });
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('تعذر تعديل المفضلة. تحقق من اتصال الإنترنت ثم جرّب مرة ثانية.'),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _savingFavoriteIds.remove(room.id));
    }
  }

  Future<void> _selectViewMode(String mode) async {
    if (_viewMode == mode) return;
    setState(() {
      _viewMode = mode;
      _category = 'الكل';
    });
    if (mode != 'all') await _loadRoomLibrary();
  }

  Future<void> _openRoom(DiscoveryRoom room) async {
    final args = room.toNavigationArguments();
    final ownerUid =
        (room.data['ownerUid'] ?? room.data['ownerId'] ?? room.data['hostId'])
            .toString();
    final isOwner = ownerUid == FirebaseAuth.instance.currentUser?.uid;

    if (room.isPasswordProtected && !isOwner) {
      final password = await showDiscoveryRoomPasswordPrompt(context, room.title);
      if (!mounted || password == null) return;
      args['roomPassword'] = password;
    }

    NavigationService.navigateTo(
      AppRoutes.voiceChatRoom,
      arguments: args,
    );
  }

  void _search() {
    Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => const DiscoverySearchScreen()),
    );
  }

  Future<void> _openPersonalRoom() async {
    if (_openingPersonalRoom) return;
    final user = FirebaseAuth.instance.currentUser;
    if (user == null || user.isAnonymous) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('إنشاء غرفة خاصة يحتاج حساباً مسجلاً.')),
      );
      return;
    }

    setState(() => _openingPersonalRoom = true);
    try {
      final room = await _roomActions.openPersonalRoom();
      if (!mounted) return;
      NavigationService.navigateTo(
        AppRoutes.voiceChatRoom,
        arguments: room.toNavigationArguments(),
      );
    } on StateError catch (error) {
      if (!mounted) return;
      final message = error.message == 'account_required'
          ? 'إنشاء غرفة خاصة يحتاج حساباً مسجلاً.'
          : 'تعذر فتح غرفتك حالياً.';
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(message)),
      );
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تعذر فتح غرفتك حالياً.')),
      );
    } finally {
      if (mounted) setState(() => _openingPersonalRoom = false);
    }
  }

  @override
  void dispose() {
    _service.close();
    _roomActions.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final visibleRooms = _visibleRooms;
    final currentUid = FirebaseAuth.instance.currentUser?.uid;
    final savedFavoriteIds = _libraryLoaded && _libraryUid == currentUid
        ? _favoriteRooms.map((room) => room.id).toSet()
        : <String>{};

    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: _bg,
        body: SafeArea(
          bottom: false,
          child: RefreshIndicator(
            onRefresh: () async {
              await _load(forceRefresh: true);
              if (_viewMode != 'all') {
                await _loadRoomLibrary(forceRefresh: true);
              }
            },
            child: CustomScrollView(
              physics: const AlwaysScrollableScrollPhysics(),
              slivers: [
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                  sliver: SliverToBoxAdapter(
                    child: Row(
                      children: [
                        const Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'الغرف',
                                style: TextStyle(
                                  color: Colors.white,
                                  fontSize: 26,
                                  fontWeight: FontWeight.w900,
                                ),
                              ),
                              SizedBox(height: 3),
                              Text(
                                'اكتشف الغرف النشطة وانضم للمجتمع',
                                style: TextStyle(
                                  color: Colors.white54,
                                  fontSize: 12,
                                ),
                              ),
                            ],
                          ),
                        ),
                        IconButton(
                          onPressed:
                              _openingPersonalRoom ? null : _openPersonalRoom,
                          style: IconButton.styleFrom(
                            backgroundColor:
                                const Color(0xFF8A3DFF).withValues(alpha: .18),
                          ),
                          icon: _openingPersonalRoom
                              ? const SizedBox(
                                  width: 20,
                                  height: 20,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                    color: Color(0xFFFFD54A),
                                  ),
                                )
                              : const Icon(
                                  Icons.meeting_room_rounded,
                                  color: Color(0xFFFFD54A),
                                ),
                          tooltip: 'غرفتي',
                        ),
                        const SizedBox(width: 6),
                        IconButton(
                          onPressed: _search,
                          style: IconButton.styleFrom(
                            backgroundColor: Colors.white.withValues(alpha: .06),
                          ),
                          icon: const Icon(
                            Icons.search_rounded,
                            color: Colors.white,
                          ),
                          tooltip: 'بحث',
                        ),
                      ],
                    ),
                  ),
                ),
                if (_loading)
                  const SliverPadding(
                    padding: EdgeInsets.only(top: 12),
                    sliver: SliverToBoxAdapter(
                      child: LinearProgressIndicator(
                        minHeight: 2,
                        color: _purple,
                        backgroundColor: Colors.transparent,
                      ),
                    ),
                  ),
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(16, 10, 16, 0),
                  sliver: SliverToBoxAdapter(
                    child: Row(
                      children: [
                        _RoomViewChip(
                          label: 'الكل',
                          icon: Icons.grid_view_rounded,
                          selected: _viewMode == 'all',
                          onTap: () => _selectViewMode('all'),
                        ),
                        const SizedBox(width: 8),
                        _RoomViewChip(
                          label: 'المفضلة',
                          icon: Icons.star_rounded,
                          selected: _viewMode == 'favorites',
                          onTap: () => _selectViewMode('favorites'),
                        ),
                        const SizedBox(width: 8),
                        _RoomViewChip(
                          label: 'السجل',
                          icon: Icons.history_rounded,
                          selected: _viewMode == 'history',
                          onTap: () => _selectViewMode('history'),
                        ),
                        if (_libraryLoading) ...[
                          const SizedBox(width: 10),
                          const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: _gold,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
                if (_error != null)
                  SliverPadding(
                    padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                    sliver: SliverToBoxAdapter(
                      child: Row(
                        children: [
                          Expanded(child: Text(
                            _error!,
                            style: const TextStyle(color: Colors.orangeAccent, fontSize: 12),
                          )),
                          TextButton(
                            onPressed: _loading ? null : () => _load(forceRefresh: true),
                            child: const Text('إعادة المحاولة'),
                          ),
                        ],
                      ),
                    ),
                  ),
                if (_libraryError)
                  SliverPadding(
                    padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                    sliver: SliverToBoxAdapter(
                      child: Row(
                        children: [
                          const Expanded(
                            child: Text(
                              'تعذر تحميل المفضلة والسجل. تحقق من اتصال الإنترنت.',
                              style: TextStyle(color: Colors.orangeAccent, fontSize: 12),
                            ),
                          ),
                          TextButton(
                            onPressed: _libraryLoading
                                ? null
                                : () => _loadRoomLibrary(forceRefresh: true),
                            child: const Text('إعادة المحاولة'),
                          ),
                        ],
                      ),
                    ),
                  ),
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
                  sliver: SliverToBoxAdapter(
                    child: SizedBox(
                      height: 44,
                      child: ListView.separated(
                        scrollDirection: Axis.horizontal,
                        itemCount: _categories.length,
                        separatorBuilder: (_, __) => const SizedBox(width: 6),
                        itemBuilder: (context, index) {
                          final category = _categories[index];
                          return RoomCategoryFilterChip(
                            label: category,
                            selected: category == _category,
                            onTap: () => setState(() => _category = category),
                          );
                        },
                      ),
                    ),
                  ),
                ),
                const SliverToBoxAdapter(child: SizedBox(height: 6)),
                if (!_loading &&
                    !(_viewMode != 'all' && _libraryLoading) &&
                    visibleRooms.isEmpty)
                  SliverFillRemaining(
                    hasScrollBody: false,
                    child: Center(
                      child: Padding(
                        padding: const EdgeInsets.all(24),
                        child: Container(
                          padding: const EdgeInsets.all(22),
                          decoration: BoxDecoration(
                            color: _card,
                            borderRadius: BorderRadius.circular(22),
                            border: Border.all(color: Colors.white10),
                          ),
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(
                                Icons.mic_none_rounded,
                                color: Colors.white38,
                                size: 38,
                              ),
                              SizedBox(height: 10),
                              Text(
                                _error != null || (_libraryError && _viewMode != 'all')
                                    ? 'تعذر تحميل الغرف. اضغط إعادة المحاولة أعلاه.'
                                    : 'لا توجد غرف متاحة حالياً',
                                style: TextStyle(
                                  color: Colors.white70,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                              SizedBox(height: 4),
                              Text(
                                _error != null || (_libraryError && _viewMode != 'all')
                                    ? 'يمكنك إعادة تحميل البيانات يدويًا.'
                                    : 'اسحب للأسفل للتحديث',
                                style: TextStyle(
                                  color: Colors.white38,
                                  fontSize: 11,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  )
                else
                  SliverPadding(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
                    sliver: SliverList.separated(
                      itemCount: visibleRooms.length,
                      separatorBuilder: (_, __) => const SizedBox(height: 8),
                      itemBuilder: (context, index) => RoomListTile(
                        room: visibleRooms[index],
                        category: _roomCategory(visibleRooms[index]),
                        showFavoriteAction: true,
                        isFavorite: savedFavoriteIds.contains(visibleRooms[index].id),
                        favoriteBusy: _savingFavoriteIds.contains(visibleRooms[index].id),
                        onFavoriteTap: _libraryLoading
                            ? null
                            : () => _toggleRoomFavorite(visibleRooms[index]),
                        onTap: () => _openRoom(visibleRooms[index]),
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class RoomListTile extends StatelessWidget {
  const RoomListTile({
    required this.room,
    required this.category,
    required this.onTap,
    this.showFavoriteAction = false,
    this.isFavorite = false,
    this.favoriteBusy = false,
    this.onFavoriteTap,
  });

  final DiscoveryRoom room;
  final String category;
  final VoidCallback onTap;
  final bool showFavoriteAction;
  final bool isFavorite;
  final bool favoriteBusy;
  final VoidCallback? onFavoriteTap;

  @override
  Widget build(BuildContext context) {
    final roomImageUrl = roomSurfaceImageUrl(room.data);
    final description = (room.data['description'] ?? '').toString().trim();

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(18),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: const Color(0xFF111321),
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: Colors.white10),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Container(
              width: 60,
              height: 60,
              clipBehavior: Clip.antiAlias,
              decoration: BoxDecoration(
                color: const Color(0xFF2B1950),
                borderRadius: BorderRadius.circular(14),
              ),
              child: roomImageUrl.isNotEmpty
                  ? CachedNetworkImage(
                      imageUrl: roomImageUrl,
                      fit: BoxFit.cover,
                      errorWidget: (_, __, ___) => const Icon(
                        Icons.mic_rounded,
                        color: Color(0xFFFFD54A),
                        size: 34,
                      ),
                    )
                  : const Icon(
                      Icons.mic_rounded,
                      color: Color(0xFFFFD54A),
                      size: 34,
                    ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          room.title,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 14,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ),
                      if (room.isFeatured)
                        const Padding(
                          padding: EdgeInsetsDirectional.only(start: 6),
                          child: Icon(
                            Icons.star_rounded,
                            color: Color(0xFFFFD54A),
                            size: 17,
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(height: 3),
                  if (description.isNotEmpty)
                    Text(
                      description,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Colors.white54,
                        fontSize: 11,
                      ),
                    ),
                  const SizedBox(height: 5),
                  Wrap(
                    spacing: 5,
                    runSpacing: 4,
                    children: [
                      _MetaPill(
                        icon: Icons.graphic_eq_rounded,
                        text: room.hasAvailablePresence
                            ? '${room.onlineCount} متصل'
                            : 'الحضور غير متاح',
                      ),
                      _MetaPill(
                        icon: Icons.tag_rounded,
                        text: category,
                      ),
                      if (room.isPasswordProtected) ...[
                        const _MetaPill(
                          icon: Icons.lock_rounded,
                          text: 'بكلمة مرور',
                        ),
                      ],
                    ],
                  ),
                ],
              ),
            ),
            if (showFavoriteAction)
              SizedBox(
                width: 44,
                height: 48,
                child: GestureDetector(
                  // A disabled/loading favorite still owns its hit area, so
                  // it never bubbles into the parent room-entry InkWell.
                  behavior: HitTestBehavior.opaque,
                  onTap: () {},
                  child: IconButton(
                    tooltip: isFavorite ? 'إزالة من المفضلة' : 'أضف إلى المفضلة',
                    onPressed: favoriteBusy ? null : onFavoriteTap,
                    icon: favoriteBusy
                        ? const SizedBox(
                            width: 19,
                            height: 19,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : Icon(
                            isFavorite
                                ? Icons.favorite_rounded
                                : Icons.favorite_border_rounded,
                            color: isFavorite
                                ? const Color(0xFFFFD54A)
                                : Colors.white60,
                          ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _MetaPill extends StatelessWidget {
  const _MetaPill({
    required this.icon,
    required this.text,
  });

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: .05),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, color: const Color(0xFF8A3DFF), size: 13),
          const SizedBox(width: 4),
          Text(
            text,
            style: const TextStyle(
              color: Colors.white60,
              fontSize: 10,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}


/// Compact visual pill with a full-height 44px touch target.
class RoomCategoryFilterChip extends StatelessWidget {
  const RoomCategoryFilterChip({
    super.key,
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      selected: selected,
      label: label,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(999),
        child: SizedBox(
          height: 44,
          child: Center(
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              decoration: BoxDecoration(
                color: selected
                    ? const Color(0xFF8A3DFF)
                    : const Color(0xFF111321),
                borderRadius: BorderRadius.circular(999),
                border: Border.all(
                  color: selected
                      ? const Color(0xFF8A3DFF)
                      : Colors.white10,
                ),
              ),
              child: Text(
                label,
                maxLines: 1,
                style: TextStyle(
                  color: selected ? Colors.white : Colors.white60,
                  fontWeight: selected ? FontWeight.w800 : FontWeight.w600,
                  fontSize: 11,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _RoomViewChip extends StatelessWidget {
  const _RoomViewChip({
    required this.label,
    required this.icon,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final IconData icon;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(999),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: selected
              ? const Color(0xFF8A3DFF)
              : Colors.white.withValues(alpha: .05),
          borderRadius: BorderRadius.circular(999),
          border: Border.all(
            color: selected
                ? const Color(0xFF8A3DFF)
                : Colors.white10,
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              icon,
              size: 15,
              color: selected
                  ? Colors.white
                  : const Color(0xFFFFD54A),
            ),
            const SizedBox(width: 5),
            Text(
              label,
              style: TextStyle(
                color: selected ? Colors.white : Colors.white60,
                fontSize: 11,
                fontWeight: FontWeight.w800,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
