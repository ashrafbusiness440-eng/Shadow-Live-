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

    if (results.length < 5) {
      await _warmLegacyPeopleCache();
    }
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

    if (RegExp(r'^\d{3,12}$').hasMatch(query)) {
      try {
        final id = await FirebaseFirestore.instance
            .collection('room_ids')
            .doc(query)
            .get();
        final targetRoomId = id.data()?['roomId']?.toString();
        if (targetRoomId != null && targetRoomId.isNotEmpty) {
          final roomDoc = await FirebaseFirestore.instance
              .collection('rooms')
              .doc(targetRoomId)
              .get();
          if (roomDoc.exists) {
            final room = DiscoveryRoom(
              id: roomDoc.id,
              data: roomDoc.data()!,
            );
            if (room.isActive && !room.isHidden) {
              results[room.id] = room;
            }
          }
        }
      } catch (_) {}
    }

    try {
      final indexed = await FirebaseFirestore.instance
          .collection('rooms')
          .where('searchTokens', arrayContains: query)
          .limit(30)
          .get();
      for (final document in indexed.docs) {
        final room = DiscoveryRoom(
          id: document.id,
          data: document.data(),
        );
        if (room.isActive && !room.isHidden) {
          results[room.id] = room;
        }
      }
    } catch (_) {
      // Phase 6 room documents carry searchTokens. Legacy/current rooms
      // continue through the local cache fallback below.
    }

    for (final room in _roomCache) {
      final ownerName =
          (room.data['ownerName'] ?? room.data['hostName'] ?? '').toString();
      final ownerLocation =
          (room.data['ownerLocation'] ?? room.data['country'] ?? '').toString();
      final category = (room.data['category'] ?? '').toString();
      final tags = room.data['tags'] is List
          ? (room.data['tags'] as List).map((value) => value.toString()).join(' ')
          : '';
      if (searchTextMatches(room.title, query) ||
          normalizeSearchText(room.publicId) == query ||
          searchTextMatches(ownerName, query) ||
          searchTextMatches(ownerLocation, query) ||
          searchTextMatches(category, query) ||
          searchTextMatches(tags, query)) {
        results[room.id] = room;
      }
    }

    // Legacy fallback: allow exact Firestore document ID searches until
    // every room has a dedicated publicId.
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
        final idRankA = normalizeSearchText(a.publicId) == query ? 0 : 1;
        final idRankB = normalizeSearchText(b.publicId) == query ? 0 : 1;
        final idCompare = idRankA.compareTo(idRankB);
        if (idCompare != 0) return idCompare;
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

  Future<String?> _askRoomPassword(String roomName) async {
    final controller = TextEditingController();
    final value = await showDialog<String>(
      context: context,
      builder: (dialogContext) => Directionality(
        textDirection: TextDirection.rtl,
        child: AlertDialog(
          backgroundColor: const Color(0xFF101827),
          title: Text(
            roomName,
            style: const TextStyle(color: Colors.white),
          ),
          content: TextField(
            controller: controller,
            autofocus: true,
            obscureText: true,
            style: const TextStyle(color: Colors.white),
            decoration: const InputDecoration(
              labelText: 'كلمة مرور الغرفة',
              labelStyle: TextStyle(color: Colors.white60),
              prefixIcon: Icon(
                Icons.lock_rounded,
                color: Color(0xFFFFD54A),
              ),
            ),
            onSubmitted: (password) {
              if (password.trim().isNotEmpty) {
                Navigator.pop(dialogContext, password);
              }
            },
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text('إلغاء'),
            ),
            FilledButton(
              onPressed: () {
                if (controller.text.trim().isEmpty) return;
                Navigator.pop(dialogContext, controller.text);
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

  Future<void> _openRoom(Map<String, dynamic> room) async {
    final args = Map<String, dynamic>.from(room);
    final visibility = (room['visibility'] ?? 'public').toString();
    final ownerUid =
        (room['ownerUid'] ?? room['ownerId'] ?? room['hostId'] ?? '').toString();
    final isOwner = ownerUid == _uid;
    if (visibility == 'password' && !isOwner) {
      final password = await _askRoomPassword(
        (room['name'] ?? room['title'] ?? 'غرفة').toString(),
      );
      if (!mounted || password == null) return;
      args['roomPassword'] = password;
    }

    NavigationService.navigateTo(
      AppRoutes.voiceChatRoom,
      arguments: args,
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
          [
            if ((room['publicId'] ?? '').toString().isNotEmpty)
              'ID: ${room['publicId']}',
            '${room['onlineCount'] ?? room['memberCount'] ?? room['participantsCount'] ?? 0} متصل',
          ].join(' • '),
          style: const TextStyle(color: Colors.white54),
        ),
        trailing: Icon(
          (room['visibility'] ?? '').toString() == 'password'
              ? Icons.lock_rounded
              : Icons.login_rounded,
          color: (room['visibility'] ?? '').toString() == 'password'
              ? const Color(0xFFFFD54A)
              : const Color(0xFF8A3DFF),
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
