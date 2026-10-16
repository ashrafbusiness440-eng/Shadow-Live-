import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../services/profile_visit_service.dart';
import '../../room/services/room_realtime_query_service.dart';
import '../../room/services/room_follow_navigation.dart';
import '../../profile/widgets/profile_avatar_with_frame.dart';

class ProfileVisitHistoryScreen extends StatefulWidget {
  const ProfileVisitHistoryScreen({super.key});

  @override
  State<ProfileVisitHistoryScreen> createState() =>
      _ProfileVisitHistoryScreenState();
}

class _ProfileVisitHistoryScreenState extends State<ProfileVisitHistoryScreen>
    with SingleTickerProviderStateMixin {
  final ProfileVisitService _service = ProfileVisitService();
  final RoomRealtimeQueryService _roomFollowQuery = RoomRealtimeQueryService();
  final Map<String, RoomFollowLocation> _followLocations = {};
  final Set<String> _checkedFollowUids = {};
  final Set<bool> _primedTabs = {};
  StreamSubscription<User?>? _authSubscription;
  String? _ownerUid;
  int _followGeneration = 0;
  bool _followLoading = false;
  bool _followFailed = false;
  bool _followNavigationBusy = false;

  bool _currentAccount(String? uid, int generation) =>
      mounted && uid != null && uid == _ownerUid &&
      generation == _followGeneration &&
      FirebaseAuth.instance.currentUser?.uid == uid;

  void _clearFollowState() {
    _followGeneration++;
    _followLocations.clear();
    _checkedFollowUids.clear();
    _primedTabs.clear();
    _followLoading = false;
    _followFailed = false;
  }

  /// One user-triggered batch of 16, via two shared authenticated calls.
  /// Only a real DO-verified and privacy-approved room may show a badge.
  Future<void> _checkRoomFollows(List<ProfileVisitItem> items) async {
    final uid = _ownerUid;
    final generation = _followGeneration;
    if (!_currentAccount(uid, generation) || _followLoading) return;
    final ids = items.map((item) => item.uid)
        .where((id) => id.isNotEmpty &&
            id != uid && !_checkedFollowUids.contains(id))
        .toSet().take(16).toList(growable: false);
    if (ids.isEmpty) return;
    setState(() {
      _followLoading = true;
      _followFailed = false;
    });
    final found = <String, RoomFollowLocation>{};
    try {
      for (var index = 0; index < ids.length; index += 8) {
        final end = index + 8 < ids.length ? index + 8 : ids.length;
        found.addAll(await _roomFollowQuery.resolveRoomFollows(
          ids.sublist(index, end),
        ));
        if (!_currentAccount(uid, generation)) return;
      }
      if (!_currentAccount(uid, generation)) return;
      setState(() {
        _followLocations.addAll(found);
        _checkedFollowUids.addAll(ids);
      });
    } catch (_) {
      if (_currentAccount(uid, generation)) {
        setState(() => _followFailed = true);
      }
    } finally {
      if (_currentAccount(uid, generation)) {
        setState(() => _followLoading = false);
      }
    }
  }

  Future<void> _followVisitor(String targetUid) async {
    final uid = _ownerUid;
    if (_followNavigationBusy || uid == null ||
        !_followLocations.containsKey(targetUid) ||
        FirebaseAuth.instance.currentUser?.uid != uid) return;
    setState(() => _followNavigationBusy = true);
    try {
      final message = await RoomFollowNavigation.open(
        context: context, targetUid: targetUid, query: _roomFollowQuery,
      );
      if (!mounted || FirebaseAuth.instance.currentUser?.uid != uid) return;
      if (message != null) {
        setState(() => _followLocations.remove(targetUid));
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(message)),
        );
      }
    } catch (_) {
      if (mounted && FirebaseAuth.instance.currentUser?.uid == uid) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('تعذر التتبّع إلى الغرفة حالياً.')),
        );
      }
    } finally {
      if (mounted) setState(() => _followNavigationBusy = false);
    }
  }

  late final TabController _tabs;
  late Future<List<ProfileVisitItem>> _visitors;
  late Future<List<ProfileVisitItem>> _visited;

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 2, vsync: this);
    _ownerUid = FirebaseAuth.instance.currentUser?.uid;
    _authSubscription =
        FirebaseAuth.instance.authStateChanges().listen((user) {
      if (!mounted || user?.uid == _ownerUid) return;
      setState(() {
        _ownerUid = user?.uid;
        _clearFollowState();
        _reload();
      });
    });
    _tabs.addListener(() {
      if (mounted && !_tabs.indexIsChanging) setState(() {});
    });
    _reload();
  }

  void _reload() {
    _visitors = _service.history(visited: false);
    _visited = _service.history(visited: true);
  }

  @override
  void dispose() {
    _authSubscription?.cancel();
    _roomFollowQuery.close();
    _service.close();
    _tabs.dispose();
    super.dispose();
  }

  Future<void> _refresh() async {
    setState(() {
      _clearFollowState();
      _reload();
    });
    try {
      await Future.wait([_visitors, _visited]);
    } catch (_) {
      // FutureBuilder displays a retryable error; do not throw into RefreshIndicator.
    }
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: const Color(0xFF050814),
        appBar: AppBar(
          backgroundColor: const Color(0xFF0B1220),
          foregroundColor: Colors.white,
          title: const Text(
            'سجل الزيارات',
            style: TextStyle(fontWeight: FontWeight.w900),
          ),
          bottom: TabBar(
            controller: _tabs,
            labelColor: const Color(0xFFFFD166),
            unselectedLabelColor: Colors.white54,
            indicatorColor: const Color(0xFFFFD166),
            tabs: const [
              Tab(text: 'من زار ملفي'),
              Tab(text: 'الملفات التي زرتها'),
            ],
          ),
        ),
        body: TabBarView(
          controller: _tabs,
          children: [
            _history(_visitors, visited: false),
            _history(_visited, visited: true),
          ],
        ),
      ),
    );
  }

  Widget _history(Future<List<ProfileVisitItem>> future,
      {required bool visited}) {
    return FutureBuilder<List<ProfileVisitItem>>(
      future: future,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return const Center(child: CircularProgressIndicator());
        }
        if (snapshot.hasError) {
          final text = snapshot.error.toString();
          final requiresVip =
              text.contains('profile_visit_history_requires_vip1');
          return RefreshIndicator(
            onRefresh: _refresh,
            child: ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              children: [
                const SizedBox(height: 160),
                Icon(
                  requiresVip
                      ? Icons.workspace_premium_rounded
                      : Icons.error_outline_rounded,
                  color: const Color(0xFFFFD166),
                  size: 44,
                ),
                const SizedBox(height: 12),
                Center(
                  child: Text(
                    requiresVip
                        ? 'سجل الزيارات متاح من VIP1.'
                        : 'تعذر تحميل سجل الزيارات.',
                    style: const TextStyle(color: Colors.white60),
                  ),
                ),
              ],
            ),
          );
        }

        final items = snapshot.data ?? const <ProfileVisitItem>[];
        if (items.isEmpty) {
          return RefreshIndicator(
            onRefresh: _refresh,
            child: ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              children: const [
                SizedBox(height: 170),
                Icon(
                  Icons.visibility_outlined,
                  color: Colors.white38,
                  size: 46,
                ),
                SizedBox(height: 12),
                Center(
                  child: Text(
                    'لا توجد زيارات بعد.',
                    style: TextStyle(color: Colors.white54),
                  ),
                ),
              ],
            ),
          );
        }

        // Load a bounded first batch for the active tab only; remaining
        // visitor rows are queried only when the viewer requests more.
        final active = visited == (_tabs.index == 1);
        if (active && !_primedTabs.contains(visited)) {
          _primedTabs.add(visited);
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (mounted && visited == (_tabs.index == 1)) {
              unawaited(_checkRoomFollows(items));
            }
          });
        }
        final unchecked = items
            .where((item) => !_checkedFollowUids.contains(item.uid))
            .toList(growable: false);
        return RefreshIndicator(
          onRefresh: _refresh,
          child: ListView.separated(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(14, 14, 14, 28),
            itemCount: items.length + (active && unchecked.isNotEmpty ? 1 : 0),
            separatorBuilder: (_, __) =>
                const Divider(height: 1, color: Colors.white10),
            itemBuilder: (context, index) {
              if (index == items.length) {
                return Center(
                  child: TextButton.icon(
                    onPressed: _followLoading
                        ? null : () => _checkRoomFollows(items),
                    icon: _followLoading
                        ? const SizedBox(
                            height: 16, width: 16,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : Icon(_followFailed
                            ? Icons.refresh_rounded : Icons.people_alt_rounded),
                    label: Text(_followLoading
                        ? 'جارٍ التحقق من الغرف...'
                        : _followFailed
                            ? 'تعذر التحقق — إعادة المحاولة'
                            : 'عرض حالة الغرف لباقي الزوار'),
                  ),
                );
              }
              return _tile(items[index]);
            },
          ),
        );
      },
    );
  }

  Widget _tile(ProfileVisitItem item) {
    final date = item.lastVisitedAt?.toLocal();
    final dateText = date == null
        ? ''
        : '${date.year}/${date.month.toString().padLeft(2, '0')}/${date.day.toString().padLeft(2, '0')} '
            '${date.hour.toString().padLeft(2, '0')}:${date.minute.toString().padLeft(2, '0')}';

    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 4, vertical: 7),
      leading: ProfileAvatarWithFrame(
        diameter: 48,
        userId: item.uid,
        backgroundColor: const Color(0xFF25183F),
        placeholderColor: const Color(0xFFFFD166),
        fallbackProfile: <String, dynamic>{
          'profileImageUrl': item.profileImageUrl,
        },
        vipLevel: item.effectiveVipLevel,
        useVipFallback: true,
      ),
      title: Text(
        item.displayName,
        style: const TextStyle(
          color: Colors.white,
          fontWeight: FontWeight.w800,
        ),
      ),
      subtitle: Text(
        [
          if (item.publicId.isNotEmpty) 'ID: ${item.publicId}',
          if (dateText.isNotEmpty) dateText,
        ].join(' • '),
        textDirection: TextDirection.rtl,
        style: const TextStyle(color: Colors.white54, fontSize: 12),
      ),
      trailing: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          if (_followLocations.containsKey(item.uid))
            InkWell(
              key: ValueKey('visit-room-follow-${item.uid}'),
              onTap: _followNavigationBusy
                  ? null : () => _followVisitor(item.uid),
              child: const Padding(
                padding: EdgeInsets.symmetric(vertical: 3),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.graphic_eq_rounded,
                        color: Color(0xFFFFD166), size: 16),
                    SizedBox(width: 4),
                    Text('في غرفة',
                        style: TextStyle(
                            color: Color(0xFFFFD166), fontSize: 11)),
                  ],
                ),
              ),
            ),
          if (item.effectiveVipLevel > 0)
            Text(
              'VIP${item.effectiveVipLevel}',
              textDirection: TextDirection.ltr,
              style: const TextStyle(
                color: Color(0xFFFFD166),
                fontWeight: FontWeight.w900,
                fontSize: 12,
              ),
            ),
        ],
      ),
    );
  }
}
