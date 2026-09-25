import 'package:cached_network_image/cached_network_image.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../../features/home/screens/discovery_search_screen.dart';
import '../../features/home/services/discovery_service.dart';
import '../../features/room/services/room_action_service.dart';
import '../../services/navigation_service.dart';

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
  }

  Future<void> _load({bool forceRefresh = false}) async {
    if (mounted) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }

    try {
      final rooms = await _service.loadRooms(forceRefresh: forceRefresh);
      rooms.sort((a, b) => b.onlineCount.compareTo(a.onlineCount));
      if (mounted) setState(() => _rooms = rooms);
    } catch (_) {
      if (mounted) setState(() => _error = 'تعذر تحميل الغرف حالياً');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _roomCategory(DiscoveryRoom room) {
    final value = room.data['category'] ?? room.data['type'] ?? '';
    final category = value.toString().trim();
    return category.isEmpty ? 'أخرى' : category;
  }

  List<String> get _categories {
    final values = <String>{};
    for (final room in _sourceRooms) {
      values.add(_roomCategory(room));
    }
    final result = values.toList()..sort();
    return ['الكل', ...result];
  }

  List<DiscoveryRoom> get _sourceRooms {
    switch (_viewMode) {
      case 'favorites':
        return _favoriteRooms;
      case 'history':
        return _historyRooms;
      default:
        return _rooms;
    }
  }

  List<DiscoveryRoom> get _visibleRooms {
    final source = _sourceRooms;
    if (_category == 'الكل') return source;
    return source.where((room) => _roomCategory(room) == _category).toList();
  }

  Future<void> _loadRoomLibrary() async {
    if (_libraryLoading) return;
    setState(() => _libraryLoading = true);
    try {
      final library = await _roomActions.loadRoomLibrary();

      DiscoveryRoom parse(Map<String, dynamic> room) {
        final id = (room['roomId'] ?? '').toString();
        return DiscoveryRoom(id: id, data: room);
      }

      if (mounted) {
        setState(() {
          _favoriteRooms = library.favorites
              .where((room) => (room['roomId'] ?? '').toString().isNotEmpty)
              .map(parse)
              .toList(growable: false);
          _historyRooms = library.history
              .where((room) => (room['roomId'] ?? '').toString().isNotEmpty)
              .map(parse)
              .toList(growable: false);
        });
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('تعذر تحميل مفضلة وسجل الغرف حالياً.'),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _libraryLoading = false);
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

  Future<String?> _askRoomPassword(String roomName) async {
    final controller = TextEditingController();
    final value = await showDialog<String>(
      context: context,
      builder: (dialogContext) => Directionality(
        textDirection: TextDirection.rtl,
        child: AlertDialog(
          backgroundColor: const Color(0xFF111321),
          title: Text(
            roomName,
            style: const TextStyle(color: Colors.white),
          ),
          content: TextField(
            controller: controller,
            autofocus: true,
            obscureText: true,
            textInputAction: TextInputAction.done,
            style: const TextStyle(color: Colors.white),
            decoration: const InputDecoration(
              labelText: 'كلمة مرور الغرفة',
              labelStyle: TextStyle(color: Colors.white60),
              prefixIcon: Icon(
                Icons.lock_rounded,
                color: Color(0xFFFFD54A),
              ),
            ),
            onSubmitted: (value) {
              if (value.trim().isNotEmpty) Navigator.pop(dialogContext, value);
            },
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text('إلغاء'),
            ),
            FilledButton(
              onPressed: () {
                final password = controller.text;
                if (password.trim().isEmpty) return;
                Navigator.pop(dialogContext, password);
              },
              child: const Text('دخول'),
            ),
          ],
        ),
      ),
    );
    controller.dispose();
    return value;
  }

  Future<void> _openRoom(DiscoveryRoom room) async {
    final args = room.toNavigationArguments();
    final ownerUid =
        (room.data['ownerUid'] ?? room.data['ownerId'] ?? room.data['hostId'])
            .toString();
    final isOwner = ownerUid == FirebaseAuth.instance.currentUser?.uid;

    if (room.isPasswordProtected && !isOwner) {
      final password = await _askRoomPassword(room.title);
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

    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: _bg,
        body: SafeArea(
          bottom: false,
          child: RefreshIndicator(
            onRefresh: () => _load(forceRefresh: true),
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
                  padding: const EdgeInsets.fromLTRB(16, 14, 16, 0),
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
                      child: Text(
                        _error!,
                        style: const TextStyle(
                          color: Colors.orangeAccent,
                          fontSize: 12,
                        ),
                      ),
                    ),
                  ),
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(16, 18, 16, 0),
                  sliver: SliverToBoxAdapter(
                    child: SizedBox(
                      height: 38,
                      child: ListView.separated(
                        scrollDirection: Axis.horizontal,
                        itemCount: _categories.length,
                        separatorBuilder: (_, __) => const SizedBox(width: 8),
                        itemBuilder: (context, index) {
                          final category = _categories[index];
                          final selected = category == _category;
                          return ChoiceChip(
                            label: Text(category),
                            selected: selected,
                            onSelected: (_) {
                              setState(() => _category = category);
                            },
                            backgroundColor: _card,
                            selectedColor: _purple,
                            side: BorderSide(
                              color: selected ? _purple : Colors.white10,
                            ),
                            labelStyle: TextStyle(
                              color: selected ? Colors.white : Colors.white60,
                              fontWeight:
                                  selected ? FontWeight.w800 : FontWeight.w600,
                              fontSize: 11,
                            ),
                            showCheckmark: false,
                          );
                        },
                      ),
                    ),
                  ),
                ),
                const SliverToBoxAdapter(child: SizedBox(height: 14)),
                if (!_loading && visibleRooms.isEmpty)
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
                          child: const Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(
                                Icons.mic_none_rounded,
                                color: Colors.white38,
                                size: 38,
                              ),
                              SizedBox(height: 10),
                              Text(
                                'لا توجد غرف متاحة حالياً',
                                style: TextStyle(
                                  color: Colors.white70,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                              SizedBox(height: 4),
                              Text(
                                'اسحب للأسفل للتحديث',
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
                      separatorBuilder: (_, __) => const SizedBox(height: 12),
                      itemBuilder: (context, index) => _RoomTile(
                        room: visibleRooms[index],
                        category: _roomCategory(visibleRooms[index]),
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

class _RoomTile extends StatelessWidget {
  const _RoomTile({
    required this.room,
    required this.category,
    required this.onTap,
  });

  final DiscoveryRoom room;
  final String category;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final coverUrl = (room.data['coverImageUrl'] ??
            room.data['imageUrl'] ??
            room.data['photoUrl'] ??
            '')
        .toString()
        .trim();
    final description = (room.data['description'] ?? '').toString().trim();

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(22),
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: const Color(0xFF111321),
          borderRadius: BorderRadius.circular(22),
          border: Border.all(color: Colors.white10),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Container(
              width: 76,
              height: 76,
              clipBehavior: Clip.antiAlias,
              decoration: BoxDecoration(
                color: const Color(0xFF2B1950),
                borderRadius: BorderRadius.circular(18),
              ),
              child: coverUrl.isNotEmpty
                  ? CachedNetworkImage(
                      imageUrl: coverUrl,
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
            const SizedBox(width: 12),
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
                            fontSize: 15,
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
                  const SizedBox(height: 5),
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
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      _MetaPill(
                        icon: Icons.graphic_eq_rounded,
                        text: '${room.onlineCount} متصل',
                      ),
                      const SizedBox(width: 6),
                      _MetaPill(
                        icon: Icons.tag_rounded,
                        text: category,
                      ),
                      if (room.isPasswordProtected) ...[
                        const SizedBox(width: 6),
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
            const SizedBox(width: 8),
            const Icon(
              Icons.chevron_left_rounded,
              color: Colors.white38,
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
