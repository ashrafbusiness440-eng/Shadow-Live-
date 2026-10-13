import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';

import '../../vip/utils/vip_public_state.dart';
import '../../room/services/room_realtime_query_service.dart';
import 'home_async_cache.dart';

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

  bool get hasAvailablePresence => data['presenceState'] != 'unavailable';

  int get onlineCount {
    if (!hasAvailablePresence) return 0;
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

/// Use the same classification for Home suggestions and room discovery.
/// A featured ordinary room is not an official pinned room.
bool isOfficialRoomForDiscovery(DiscoveryRoom room) {
  final type = (room.data['roomType'] ?? room.data['type'] ?? 'personal')
      .toString()
      .trim();
  return room.data['systemOwned'] == true ||
      room.data['officialRoom'] == true ||
      const {'official', 'administrative', 'customer_service'}.contains(type);
}

bool isPinnedOfficialRoomForDiscovery(DiscoveryRoom room) =>
    isOfficialRoomForDiscovery(room) &&
    (room.isFeatured ||
        room.data['isPinned'] == true ||
        room.data['pinned'] == true);

int compareRoomsByDiscoveryPriority(DiscoveryRoom a, DiscoveryRoom b) {
  final aPinned = isPinnedOfficialRoomForDiscovery(a);
  final bPinned = isPinnedOfficialRoomForDiscovery(b);
  if (aPinned != bPinned) return aPinned ? -1 : 1;
  final byPresence = b.onlineCount.compareTo(a.onlineCount);
  if (byPresence != 0) return byPresence;
  return a.id.compareTo(b.id);
}

/// Mark missing realtime counts as unknown, never as a verified zero or
/// the old Firestore metadata value. Search and Home reuse this policy.
DiscoveryRoom roomWithVerifiedPresence(
  DiscoveryRoom room,
  int? liveCount,
) =>
    DiscoveryRoom(
      id: room.id,
      data: {
        ...room.data,
        'presenceState': liveCount == null ? 'unavailable' : 'live',
        if (liveCount != null) ...{
          'onlineCount': liveCount < 0 ? 0 : liveCount,
          'participantsCount': liveCount < 0 ? 0 : liveCount,
        },
      },
    );

/// Never infer public level visibility from an absent privacy field.
/// Own-account headers can show the user's own level without that restriction.
int homeVisibleGenderLevel(
  Map<String, dynamic> profile, {
  bool isOwnAccount = false,
}) {
  final gender = (profile['gender'] ?? '').toString().trim().toLowerCase();
  final male = gender == 'ذكر' || gender == 'male';
  final female = gender == 'أنثى' || gender == 'female';
  if (!male && !female) return 0;
  final privacyKey = male ? 'hideWealthLevel' : 'hideAttractionLevel';
  if (!isOwnAccount && profile[privacyKey] != false) return 0;
  final value = profile[male ? 'wealthLevel' : 'attractionLevel'];
  final parsed = value is num ? value.toInt() : int.tryParse(value?.toString() ?? '');
  return parsed != null && parsed > 0 ? parsed : 0;
}

/// The generic account level was retired. The home identity line may show
/// verified VIP or a permitted gender-specific level, but never legacy LV.
String? homeIdentityLabel(
  Map<String, dynamic> profile, {
  bool isOwnAccount = false,
}) {
  final vip = effectivePublicVipLevel(profile);
  if (vip > 0) return 'VIP $vip';
  final level = homeVisibleGenderLevel(profile, isOwnAccount: isOwnAccount);
  if (level <= 0) return null;
  final gender = (profile['gender'] ?? '').toString().trim().toLowerCase();
  final isMale = gender == 'ذكر' || gender == 'male';
  return '${isMale ? 'الثروة' : 'الجاذبية'} $level';
}

/// Only publicly discoverable, active rooms can enter the browsing grid.
/// A password-protected room can be listed, but its existing admission flow
/// must still request the password. Restricted/hidden rooms are never listed.
bool isDiscoverableRoom(DiscoveryRoom room) =>
    room.isActive &&
    !room.isHidden &&
    room.data['isPrivate'] != true &&
    const {'public', 'password'}.contains(room.visibility);

/// Firestore document cursor rather than an offset or an expanded limit.
/// The cursor covers raw documents, including filtered ones, so hidden rooms
/// cannot make the same page repeat on the next request.
class DiscoveryRoomPage {
  const DiscoveryRoomPage({
    required this.rooms,
    required this.nextCursor,
    required this.hasMore,
  });

  final List<DiscoveryRoom> rooms;
  final DocumentSnapshot<Map<String, dynamic>>? nextCursor;
  final bool hasMore;
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

  /// Verified VIP entitlement; never use the legacy, potentially expired
  /// vipLevel field as proof of a current badge.
  int get vipLevel => effectivePublicVipLevel(data);

  /// A publicly visible rank is supplied only when the level's visibility
  /// has been explicitly confirmed in the existing profile snapshot.
  /// Missing visibility is unknown, not permission to expose a hidden level.
  int get visibleGenderLevel => homeVisibleGenderLevel(data);

  String? get identityLabel => homeIdentityLabel(data);

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
    final result = [...rooms]..sort(compareRoomsByDiscoveryPriority);
    return result;
  }

  List<DiscoveryRoom> get mostActive {
    // The activity rail remains strictly presence-ranked (no pinned override).
    final result = rooms.where((room) => room.onlineCount > 0).toList()
      ..sort((a, b) {
        final byPresence = b.onlineCount.compareTo(a.onlineCount);
        return byPresence != 0 ? byPresence : a.id.compareTo(b.id);
      });
    return result;
  }

  /// Home shows up to four suggested rooms in its 2x2 grid. The activity
  /// rail excludes exactly those visible room ids from the shared snapshot.
  /// Sorting and filtering are in memory; no additional reads.
  List<DiscoveryRoom> get otherActiveForHome {
    final visibleRoomIds =
        suggested.take(4).map((room) => room.id).toSet();
    return mostActive
        .where((room) => !visibleRoomIds.contains(room.id))
        .take(10)
        .toList(growable: false);
  }

  List<DiscoveryPerson> get suggestedPeople {
    final result = [...people]
      ..sort((a, b) {
        // public_profiles.isOnline is an unverified/stale flag, not a
        // live server presence lease. Do not rank people by that signal.
        final vipCompare = b.vipLevel.compareTo(a.vipLevel);
        if (vipCompare != 0) return vipCompare;
        final levelCompare = b.visibleGenderLevel.compareTo(a.visibleGenderLevel);
        if (levelCompare != 0) return levelCompare;
        return a.id.compareTo(b.id);
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

  static final AsyncTtlCache<List<DiscoveryPerson>> _peopleCache =
      AsyncTtlCache<List<DiscoveryPerson>>(
        ttl: const Duration(seconds: 30),
      );
  static final AsyncTtlCache<Map<String, dynamic>> _configCache =
      AsyncTtlCache<Map<String, dynamic>>(
        ttl: const Duration(seconds: 60),
      );

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
        .map((room) => roomWithVerifiedPresence(room, counts[room.id]))
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
    if (running != null) return running;

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

  /// Additional discovery pages are independent from the small Home cache.
  /// Stable document-ID cursors avoid offsets, repeated reads of earlier
  /// pages and any unbounded query. Priority is applied to fetched results;
  /// the realtime service verifies headcounts in one request per page.
  Future<DiscoveryRoomPage> loadRoomPage({
    DocumentSnapshot<Map<String, dynamic>>? after,
    int pageSize = 16,
  }) async {
    final requestUid = _auth.currentUser?.uid;
    final boundedSize = pageSize < 1 ? 1 : (pageSize > 24 ? 24 : pageSize);
    Query<Map<String, dynamic>> query = _firestore
        .collection('rooms')
        .orderBy(FieldPath.documentId)
        .limit(boundedSize);
    if (after != null) query = query.startAfterDocument(after);
    final snapshot = await query.get();
    if (_auth.currentUser?.uid != requestUid) {
      return const DiscoveryRoomPage(
        rooms: <DiscoveryRoom>[],
        nextCursor: null,
        hasMore: false,
      );
    }
    final candidates = snapshot.docs
        .map((doc) => DiscoveryRoom(id: doc.id, data: doc.data()))
        .where(isDiscoverableRoom)
        .toList(growable: false);
    final hydrated = await hydrateRealtimeCounts(candidates);
    if (_auth.currentUser?.uid != requestUid) {
      return const DiscoveryRoomPage(
        rooms: <DiscoveryRoom>[],
        nextCursor: null,
        hasMore: false,
      );
    }
    hydrated.sort(compareRoomsByDiscoveryPriority);
    return DiscoveryRoomPage(
      rooms: List<DiscoveryRoom>.unmodifiable(hydrated),
      nextCursor: snapshot.docs.isEmpty ? null : snapshot.docs.last,
      hasMore: snapshot.docs.length == boundedSize,
    );
  }

  /// A single fresh metadata check on an actual tap; never per grid tile.
  /// Admission and password verification remain in the existing room route.
  Future<DiscoveryRoom?> findRoomForEntry(String roomId) async {
    final requestUid = _auth.currentUser?.uid;
    final snapshot = await _firestore.collection('rooms').doc(roomId).get();
    if (_auth.currentUser?.uid != requestUid || !snapshot.exists) return null;
    final room = DiscoveryRoom(id: snapshot.id, data: snapshot.data()!);
    return isDiscoverableRoom(room) ? room : null;
  }

  Future<Map<String, dynamic>?> _loadCurrentUserData(User? currentUser) async {
    if (currentUser == null || currentUser.isAnonymous) return null;
    final userSnapshot =
        await _firestore.collection('users').doc(currentUser.uid).get();
    return userSnapshot.data();
  }

  Future<List<DiscoveryPerson>> _loadPeople({
    required bool forceRefresh,
  }) {
    return _peopleCache.get(
      () async {
        final peopleSnapshot =
            await _firestore.collection('public_profiles').limit(24).get();
        return List<DiscoveryPerson>.unmodifiable(
          peopleSnapshot.docs.map(
            (doc) => DiscoveryPerson(id: doc.id, data: doc.data()),
          ),
        );
      },
      forceRefresh: forceRefresh,
    );
  }

  Future<Map<String, dynamic>> _loadConfig({
    required bool forceRefresh,
  }) {
    return _configCache.get(
      () async {
        final configSnapshot = await _firestore
            .collection('system_config')
            .doc('home_discovery')
            .get();
        return Map<String, dynamic>.unmodifiable(
          configSnapshot.data() ?? const <String, dynamic>{},
        );
      },
      forceRefresh: forceRefresh,
    );
  }

  Future<HomeDiscoveryData> loadHome({bool forceRefresh = false}) async {
    final currentUser = _auth.currentUser;

    final userFuture = _loadCurrentUserData(currentUser);
    final roomsFuture = () async {
      try {
        return await loadRooms(forceRefresh: forceRefresh);
      } catch (_) {
        // Keep Home usable if room discovery is temporarily unavailable.
        return <DiscoveryRoom>[];
      }
    }();
    final peopleFuture = () async {
      try {
        return await _loadPeople(forceRefresh: forceRefresh);
      } catch (_) {
        // People discovery is optional.
        return <DiscoveryPerson>[];
      }
    }();
    final configFuture = () async {
      try {
        return await _loadConfig(forceRefresh: forceRefresh);
      } catch (_) {
        // Remote Home content is optional.
        return <String, dynamic>{};
      }
    }();

    final userData = await userFuture;
    final rooms = await roomsFuture;
    final cachedPeople = await peopleFuture;
    final config = await configFuture;
    final people = cachedPeople
        .where((person) => person.id != currentUser?.uid)
        .toList(growable: false);

    return HomeDiscoveryData(
      userData: userData,
      rooms: rooms,
      people: people,
      config: config,
    );
  }

  void close() => _realtime.close();
}
