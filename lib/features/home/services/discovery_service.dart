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

class HomeDiscoveryData {
  const HomeDiscoveryData({
    required this.userData,
    required this.rooms,
    required this.config,
  });

  final Map<String, dynamic>? userData;
  final List<DiscoveryRoom> rooms;
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
}

class DiscoveryService {
  DiscoveryService({
    FirebaseFirestore? firestore,
    FirebaseAuth? auth,
  })  : _firestore = firestore ?? FirebaseFirestore.instance,
        _auth = auth ?? FirebaseAuth.instance;

  final FirebaseFirestore _firestore;
  final FirebaseAuth _auth;

  Future<HomeDiscoveryData> loadHome() async {
    final currentUser = _auth.currentUser;

    Map<String, dynamic>? userData;
    if (currentUser != null && !currentUser.isAnonymous) {
      final userSnapshot =
          await _firestore.collection('users').doc(currentUser.uid).get();
      userData = userSnapshot.data();
    }

    final roomSnapshot = await _firestore.collection('rooms').limit(40).get();
    final rooms = roomSnapshot.docs
        .map((doc) => DiscoveryRoom(id: doc.id, data: doc.data()))
        .where((room) => room.isActive && !room.isHidden)
        .toList();

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
      config: config,
    );
  }
}
