import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../../../services/navigation_service.dart';
import '../../../utils/search_index.dart';
import '../../profile/screens/public_profile_screen.dart';
import '../services/discovery_service.dart';

class DiscoverySearchScreen extends StatefulWidget {
  const DiscoverySearchScreen({super.key});

  @override
  State<DiscoverySearchScreen> createState() => _DiscoverySearchScreenState();
}

class _DiscoverySearchScreenState extends State<DiscoverySearchScreen> {
  final _controller = TextEditingController();
  final _discoveryService = DiscoveryService();

  Timer? _debounce;
  bool _loading = false;
  bool _roomCacheLoading = false;
  String? _error;

  List<Map<String, dynamic>> _people = const [];
  List<Map<String, dynamic>> _rooms = const [];
  List<DiscoveryRoom> _roomCache = const [];
  List<Map<String, dynamic>> _legacyPeopleCache = const [];
  bool _legacyPeopleCacheLoading = false;

  String? get _uid => FirebaseAuth.instance.currentUser?.uid;

  @override
  void initState() {
    super.initState();
    _warmRoomCache();
    _warmLegacyPeopleCache();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _controller.dispose();
    super.dispose();
  }

  void _changed(String value) {
    _debounce?.cancel();
    _debounce = Timer(
      const Duration(milliseconds: 250),
      () => _search(value),
    );
  }

  Future<void> _warmLegacyPeopleCache() async {
    if (_legacyPeopleCacheLoading || _legacyPeopleCache.isNotEmpty) return;
    _legacyPeopleCacheLoading = true;
    try {
      final snapshot = await FirebaseFirestore.instance
          .collection('public_profiles')
          .limit(120)
          .get();
      if (mounted) {
        _legacyPeopleCache = snapshot.docs
            .where((doc) => doc.id != _uid)
            .map((doc) => {...doc.data(), 'uid': doc.id})
            .toList(growable: false);
      }
    } catch (_) {
      // Transitional fallback only. Indexed search remains the primary path.
    } finally {
      _legacyPeopleCacheLoading = false;
    }
  }

  Future<void> _warmRoomCache() async {
    if (_roomCacheLoading || _roomCache.isNotEmpty) return;
    _roomCacheLoading = true;
    try {
      final rooms = await _discoveryService.loadRooms();
      if (mounted) _roomCache = rooms;
    } catch (_) {
      // Search remains usable for people even if rooms are temporarily
      // unavailable while live rules are rolling out.
    } finally {
      _roomCacheLoading = false;
    }
  }

  Future<void> _search(String rawQuery) async {
    final query = normalizeSearchText(rawQuery);

    if (query.isEmpty) {
      if (mounted) {
        setState(() {
          _people = const [];
          _rooms = const [];
          _error = null;
          _loading = false;
        });
      }
      return;
    }

    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final people = await _searchPeople(query, rawQuery.trim());
      final rooms = await _searchRooms(query, rawQuery.trim());

      if (mounted) {
        setState(() {
          _people = people;
          _rooms = rooms;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'تعذر البحث حالياً. حاول مرة أخرى.');
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<List<Map<String, dynamic>>> _searchPeople(
    String query,
    String rawQuery,
  ) async {
    final results = <String, Map<String, dynamic>>{};

    void addProfile(
      QueryDocumentSnapshot<Map<String, dynamic>> document,
    ) {
      if (document.id == _uid) return;
      results[document.id] = {
        ...document.data(),
        'uid': document.id,
      };
    }

    if (RegExp(r'^\d{3,12}$').hasMatch(query)) {
      try {
        final id = await FirebaseFirestore.instance
            .collection('public_ids')
            .doc(query)
            .get();
        final targetUid = id.data()?['uid']?.toString();
        if (targetUid != null && targetUid != _uid) {
          final profile = await FirebaseFirestore.instance
              .collection('public_profiles')
              .doc(targetUid)
              .get();
          if (profile.exists) {
            results[targetUid] = {
              ...?profile.data(),
              'uid': targetUid,
            };
          }
        }
      } catch (_) {}
    }

    try {
      final indexed = await FirebaseFirestore.instance
          .collection('public_profiles')
          .where('searchTokens', arrayContains: query)
          .limit(30)
          .get();
      for (final document in indexed.docs) {
        addProfile(document);
      }
    } catch (_) {
      // Legacy public_profiles may not have searchTokens until their next
      // profile sync. Prefix fallback below keeps them discoverable.
    }

    await _warmLegacyPeopleCache();
    for (final profile in _legacyPeopleCache) {
      final uid = (profile['uid'] ?? '').toString();
      if (uid.isEmpty || uid == _uid) continue;
      if (searchTextMatches(profile['displayName'], query) ||
          searchTextMatches(profile['username'], query) ||
          normalizeSearchText(profile['publicId']) == query) {
        results[uid] = profile;
      }
    }

    if (rawQuery.isNotEmpty && results.length < 20) {
      try {
        final prefix = await FirebaseFirestore.instance
            .collection('public_profiles')
            .orderBy('displayName')
            .startAt([rawQuery])
            .endAt(['$rawQuery\uf8ff'])
            .limit(20)
            .get();
        for (final document in prefix.docs) {
          addProfile(document);
        }
      } catch (_) {}
    }

    final list = results.values.where((profile) {
      final displayName = profile['displayName'];
      final username = profile['username'];
      final publicId = profile['publicId'];
      return searchTextMatches(displayName, query) ||
          searchTextMatches(username, query) ||
          normalizeSearchText(publicId) == query;
    }).toList();

    list.sort((a, b) {
      final rankA = _profileRank(a, query);
      final rankB = _profileRank(b, query);
      final rankCompare = rankA.compareTo(rankB);
      if (rankCompare != 0) return rankCompare;

      final onlineCompare =
          (b['isOnline'] == true ? 1 : 0).compareTo(a['isOnline'] == true ? 1 : 0);
      if (onlineCompare != 0) return onlineCompare;

      final vipA = (a['vipLevel'] as num?)?.toInt() ?? 0;
      final vipB = (b['vipLevel'] as num?)?.toInt() ?? 0;
      final vipCompare = vipB.compareTo(vipA);
      if (vipCompare != 0) return vipCompare;

      final levelA = (a['level'] as num?)?.toInt() ?? 0;
      final levelB = (b['level'] as num?)?.toInt() ?? 0;
      return levelB.compareTo(levelA);
    });

    return list.take(30).toList(growable: false);
  }

  int _profileRank(Map<String, dynamic> profile, String query) {
    final displayRank = searchMatchRank(profile['displayName'], query);
    final usernameRank = searchMatchRank(profile['username'], query);
    final idRank = normalizeSearchText(profile['publicId']) == query ? 0 : 99;
    return [displayRank, usernameRank, idRank].reduce(
      (current, next) => current < next ? current : next,
    );
  }

  Future<List<Map<String, dynamic>>> _searchRooms(
    String query,
    String rawQuery,
  ) async {
    await _warmRoomCache();

    final results = <String, DiscoveryRoom>{};

    for (final room in _roomCache) {
      if (searchTextMatches(room.title, query)) {
        results[room.id] = room;
      }
    }

    if (rawQuery.length >= 4 && !rawQuery.contains('/')) {
      try {
        final exact = await FirebaseFirestore.instance
            .collection('rooms')
            .doc(rawQuery)
            .get();
        if (exact.exists) {
          final room = DiscoveryRoom(id: exact.id, data: exact.data()!);
          if (room.isActive && !room.isHidden) {
            results[room.id] = room;
          }
        }
      } catch (_) {}
    }

    final rooms = results.values.toList()
      ..sort((a, b) {
        final rankCompare =
            searchMatchRank(a.title, query).compareTo(searchMatchRank(b.title, query));
        if (rankCompare != 0) return rankCompare;
        return b.onlineCount.compareTo(a.onlineCount);
      });

    return rooms
        .take(30)
        .map((room) => room.toNavigationArguments())
        .toList(growable: false);
  }

  ImageProvider? _avatar(Map<String, dynamic> person) {
    final url =
        (person['profileImageUrl'] ?? person['avatarUrl'])?.toString().trim();
    if (url != null && url.isNotEmpty) return NetworkImage(url);

    final asset = person['profileAvatarAsset']?.toString().trim();
    return asset != null && asset.isNotEmpty ? AssetImage(asset) : null;
  }

  void _openRoom(Map<String, dynamic> room) {
    NavigationService.navigateTo(
      AppRoutes.voiceChatRoom,
      arguments: room,
    );
  }

  void _openPerson(Map<String, dynamic> person) {
    final targetUid = (person['uid'] ?? '').toString();
    if (targetUid.isEmpty) return;

    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => PublicProfileScreen(userId: targetUid),
      ),
    );
  }

  Widget _personCard(Map<String, dynamic> person) {
    final avatar = _avatar(person);
    final isOnline = person['isOnline'] == true;

    return Card(
      color: const Color(0xFF101827),
      child: ListTile(
        onTap: () => _openPerson(person),
        leading: Stack(
          clipBehavior: Clip.none,
          children: [
            CircleAvatar(
              backgroundImage: avatar,
              child: avatar == null ? const Icon(Icons.person) : null,
            ),
            if (isOnline)
              PositionedDirectional(
                end: -1,
                bottom: -1,
                child: Container(
                  width: 12,
                  height: 12,
                  decoration: BoxDecoration(
                    color: const Color(0xFF42D77D),
                    shape: BoxShape.circle,
                    border: Border.all(
                      color: const Color(0xFF101827),
                      width: 2,
                    ),
                  ),
                ),
              ),
          ],
        ),
        title: Text(
          (person['displayName'] ?? 'مستخدم Shadow Live').toString(),
          style: const TextStyle(
            color: Colors.white,
            fontWeight: FontWeight.bold,
          ),
        ),
        subtitle: Text(
          'ID: ${person['publicId'] ?? '—'}',
          style: const TextStyle(color: Colors.white54),
        ),
        trailing: const Icon(
          Icons.chevron_left_rounded,
          color: Colors.white38,
        ),
      ),
    );
  }

  Widget _roomCard(Map<String, dynamic> room) {
    return Card(
      color: const Color(0xFF101827),
      child: ListTile(
        onTap: () => _openRoom(room),
        leading: const CircleAvatar(
          backgroundColor: Color(0xFF372064),
          child: Icon(Icons.mic, color: Color(0xFFFFD54A)),
        ),
        title: Text(
          (room['name'] ?? room['title'] ?? 'غرفة').toString(),
          style: const TextStyle(
            color: Colors.white,
            fontWeight: FontWeight.bold,
          ),
        ),
        subtitle: Text(
          '${room['onlineCount'] ?? room['memberCount'] ?? room['participantsCount'] ?? 0} متصل',
          style: const TextStyle(color: Colors.white54),
        ),
        trailing: const Icon(
          Icons.login_rounded,
          color: Color(0xFF8A3DFF),
        ),
      ),
    );
  }

  Widget _results() {
    if (_error != null) {
      return Center(
        child: Text(
          _error!,
          style: const TextStyle(color: Colors.white60),
        ),
      );
    }

    if (normalizeSearchText(_controller.text).isEmpty) {
      return const Center(
        child: Text(
          'اكتب حرفاً، جزءاً من الاسم أو إيموجي للبحث',
          style: TextStyle(color: Colors.white38),
        ),
      );
    }

    if (_people.isEmpty && _rooms.isEmpty && !_loading) {
      return const Center(
        child: Text(
          'لا توجد نتائج مطابقة',
          style: TextStyle(color: Colors.white54),
        ),
      );
    }

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
      children: [
        if (_people.isNotEmpty) ...[
          const _Heading('أشخاص'),
          ..._people.map(_personCard),
        ],
        if (_rooms.isNotEmpty) ...[
          const _Heading('غرف'),
          ..._rooms.map(_roomCard),
        ],
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: const Color(0xFF05060D),
        appBar: AppBar(
          backgroundColor: const Color(0xFF0A1020),
          title: const Text('البحث والاستكشاف'),
        ),
        body: Column(
          children: [
            Padding(
              padding: const EdgeInsets.all(16),
              child: TextField(
                controller: _controller,
                onChanged: _changed,
                autofocus: true,
                style: const TextStyle(color: Colors.white),
                decoration: InputDecoration(
                  hintText: 'اسم، جزء من الاسم، إيموجي، ID أو غرفة',
                  hintStyle: const TextStyle(color: Colors.white38),
                  prefixIcon: const Icon(
                    Icons.search,
                    color: Color(0xFF8A3DFF),
                  ),
                  filled: true,
                  fillColor: const Color(0xFF111827),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(18),
                    borderSide: BorderSide.none,
                  ),
                ),
              ),
            ),
            if (_loading)
              const LinearProgressIndicator(
                color: Color(0xFF8A3DFF),
              ),
            Expanded(child: _results()),
          ],
        ),
      ),
    );
  }
}

class _Heading extends StatelessWidget {
  const _Heading(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 18, 4, 8),
      child: Text(
        text,
        style: const TextStyle(
          color: Color(0xFFFFD54A),
          fontSize: 18,
          fontWeight: FontWeight.w900,
        ),
      ),
    );
  }
}
