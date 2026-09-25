import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';

import '../../room/services/room_realtime_query_service.dart';

class DiscoveryRoom {
  const DiscoveryRoom({
    required this.id,
    required this.data,
  });

  final String id;
  final Map<String, dynamic> data;

  String get title =>
      (data['name'] ?? data['title'] ?? 'غرفة صوتية').toString();

  String get publicId => (data['publicId'] ?? '').toString();

  int get onlineCount {
    final value = data['onlineCount'] ??
        data['memberCount'] ??
        data['participantsCount'] ??
        0;
    return value is num ? value.toInt() : int.tryParse(value.toString()) ?? 0;
  }

  bool get isFeatured =>
      data['isFeatured'] == true || data['featured'] == true;

  bool get isActive => data['isActive'] != false;

  String get visibility => (data['visibility'] ?? 'public').toString();

  bool get isHidden =>
      data['isHidden'] == true || visibility == 'hidden';

  bool get isPasswordProtected => visibility == 'password';

  Map<String, dynamic> toNavigationArguments() => {
        ...data,
        'roomId': id,
      };
}

class DiscoveryPerson {
  const DiscoveryPerson({
    required this.id,
    required this.data,
  });

  final String id;
  final Map<String, dynamic> data;

  String get displayName =>
      (data['displayName'] ?? data['username'] ?? 'مستخدم Shadow Live')
          .toString();

  String get publicId => (data['publicId'] ?? '').toString();

  String get avatarUrl => (data['profileImageUrl'] ?? '').toString().trim();

  int get level {
    final value = data['level'] ?? 0;
    return value is num ? value.toInt() : int.tryParse(value.toString()) ?? 0;
  }

  int get vipLevel {
    final value = data['vipLevel'] ?? 0;
    return value is num ? value.toInt() : int.tryParse(value.toString()) ?? 0;
  }

  bool get isOnline => data['isOnline'] == true;
}

class HomeDiscoveryData {
  const HomeDiscoveryData({
    required this.userData,
    required this.rooms,
    required this.people,
    required this.config,
  });

  final Map<String, dynamic>? userData;
  final List<DiscoveryRoom> rooms;
  final List<DiscoveryPerson> people;
  final Map<String, dynamic> config;

  List<DiscoveryRoom> get suggested {
    final result = [...rooms]
      ..sort((a, b) {
        if (a.isFeatured != b.isFeatured) return a.isFeatured ? -1 : 1;
        return b.onlineCount.compareTo(a.onlineCount);
      });
    return result;
  }

  List<DiscoveryRoom> get mostActive {
    final result = rooms.where((room) => room.onlineCount > 0).toList()
      ..sort((a, b) => b.onlineCount.compareTo(a.onlineCount));
    return result;
  }

  List<DiscoveryPerson> get suggestedPeople {
    final result = [...people]
      ..sort((a, b) {
        if (a.isOnline != b.isOnline) return a.isOnline ? -1 : 1;
        final vipCompare = b.vipLevel.compareTo(a.vipLevel);
        if (vipCompare != 0) return vipCompare;
        return b.level.compareTo(a.level);
      });
    return result;
  }

  List<Map<String, dynamic>> get events => _configList('events');

  List<Map<String, dynamic>> get rankingPreview =>
      _configList('rankingPreview');

  List<Map<String, dynamic>> _configList(String key) {
    final raw = config[key];
    if (raw is! List) return const [];
    return raw
        .whereType<Map>()
        .map((item) => Map<String, dynamic>.from(item))
        .toList();
  }
}

class DiscoveryService {
  DiscoveryService({
    FirebaseFirestore? firestore,
    FirebaseAuth? auth,
    RoomRealtimeQueryService? realtime,
  })  : _firestore = firestore ?? FirebaseFirestore.instance,
        _auth = auth ?? FirebaseAuth.instance,
        _realtime = realtime ??
            RoomRealtimeQueryService(
              auth: auth ?? FirebaseAuth.instance,
            );

  final FirebaseFirestore _firestore;
  final FirebaseAuth _auth;
  final RoomRealtimeQueryService _realtime;

  static List<DiscoveryRoom>? _roomsCache;
  static DateTime? _roomsCacheUntil;
  static Future<List<DiscoveryRoom>>? _roomsInFlight;

  Future<List<DiscoveryRoom>> hydrateRealtimeCounts(
    Iterable<DiscoveryRoom> source,
  ) async {
    final rooms = source.toList(growable: false);
    if (rooms.isEmpty) return const <DiscoveryRoom>[];

    Map<String, int> counts = const <String, int>{};
    try {
      counts = await _realtime.loadCounts(rooms.map((room) => room.id));
    } catch (_) {
      // During a realtime rollout keep the persistent room metadata usable.
      // Old onlineCount values are a temporary compatibility fallback only.
    }

    return rooms
        .map((room) {
          final liveCount = counts[room.id];
          if (liveCount == null) return room;
          return DiscoveryRoom(
            id: room.id,
            data: {
              ...room.data,
              'onlineCount': liveCount,
              'participantsCount': liveCount,
            },
          );
        })
        .toList(growable: false);
  }

  Future<List<DiscoveryRoom>> loadRooms({bool forceRefresh = false}) {
    final now = DateTime.now();
    final cached = _roomsCache;
    final cacheUntil = _roomsCacheUntil;
    if (!forceRefresh &&
        cached != null &&
        cacheUntil != null &&
        cacheUntil.isAfter(now)) {
      return Future<List<DiscoveryRoom>>.value(
        List<DiscoveryRoom>.unmodifiable(cached),
      );
    }

    final running = _roomsInFlight;
    if (!forceRefresh && running != null) return running;

    final future = () async {
      final roomSnapshot = await _firestore.collection('rooms').limit(60).get();
      final persistentRooms = roomSnapshot.docs
          .map((doc) => DiscoveryRoom(id: doc.id, data: doc.data()))
          .where((room) => room.isActive && !room.isHidden)
          .toList(growable: false);
      final rooms = await hydrateRealtimeCounts(persistentRooms);
      _roomsCache = rooms;
      _roomsCacheUntil = DateTime.now().add(const Duration(seconds: 10));
      return List<DiscoveryRoom>.unmodifiable(rooms);
    }();

    _roomsInFlight = future;
    return future.whenComplete(() {
      if (identical(_roomsInFlight, future)) _roomsInFlight = null;
    });
  }

  Future<HomeDiscoveryData> loadHome() async {
    final currentUser = _auth.currentUser;

    Map<String, dynamic>? userData;
    if (currentUser != null && !currentUser.isAnonymous) {
      final userSnapshot =
          await _firestore.collection('users').doc(currentUser.uid).get();
      userData = userSnapshot.data();
    }

    var rooms = <DiscoveryRoom>[];
    try {
      rooms = await loadRooms();
    } catch (_) {
      // Live Firebase may still be on the previous ruleset while Phase 4
      // rules are awaiting deployment. Keep the rest of Home usable.
    }

    final people = <DiscoveryPerson>[];
    try {
      final peopleSnapshot =
          await _firestore.collection('public_profiles').limit(24).get();
      for (final doc in peopleSnapshot.docs) {
        if (doc.id == currentUser?.uid) continue;
        people.add(DiscoveryPerson(id: doc.id, data: doc.data()));
      }
    } catch (_) {
      // People discovery is optional. Room discovery and the rest of Home
      // should still render when public profiles are unavailable.
    }

    Map<String, dynamic> config = const {};
    try {
      final configSnapshot = await _firestore
          .collection('system_config')
          .doc('home_discovery')
          .get();
      config = configSnapshot.data() ?? const {};
    } catch (_) {
      // Home must keep its lightweight local fallback when remote content
      // is not configured yet.
    }

    return HomeDiscoveryData(
      userData: userData,
      rooms: rooms,
      people: people,
      config: config,
    );
  }

  void close() => _realtime.close();
}
