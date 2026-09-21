import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';

class DiscoveryRoom {
  const DiscoveryRoom({
    required this.id,
    required this.data,
  });

  final String id;
  final Map<String, dynamic> data;

  String get title => (data['name'] ?? data['title'] ?? 'غرفة صوتية').toString();

  int get onlineCount {
    final value =
        data['onlineCount'] ?? data['memberCount'] ?? data['participantsCount'] ?? 0;
    return value is num ? value.toInt() : int.tryParse(value.toString()) ?? 0;
  }

  bool get isFeatured => data['isFeatured'] == true || data['featured'] == true;

  bool get isActive => data['isActive'] != false;

  bool get isHidden =>
      data['isHidden'] == true || data['visibility']?.toString() == 'hidden';

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
      (data['displayName'] ?? data['username'] ?? 'مستخدم Shadow Live').toString();

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

  List<Map<String, dynamic>> get rankingPreview => _configList('rankingPreview');

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
  })  : _firestore = firestore ?? FirebaseFirestore.instance,
        _auth = auth ?? FirebaseAuth.instance;

  final FirebaseFirestore _firestore;
  final FirebaseAuth _auth;

  Future<List<DiscoveryRoom>> loadRooms() async {
    final roomSnapshot = await _firestore.collection('rooms').limit(60).get();
    return roomSnapshot.docs
        .map((doc) => DiscoveryRoom(id: doc.id, data: doc.data()))
        .where((room) => room.isActive && !room.isHidden)
        .toList();
  }

  Future<HomeDiscoveryData> loadHome() async {
    final currentUser = _auth.currentUser;

    Map<String, dynamic>? userData;
    if (currentUser != null && !currentUser.isAnonymous) {
      final userSnapshot =
          await _firestore.collection('users').doc(currentUser.uid).get();
      userData = userSnapshot.data();
    }

    final rooms = await loadRooms();

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
      final configSnapshot =
          await _firestore.collection('system_config').doc('home_discovery').get();
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
}
