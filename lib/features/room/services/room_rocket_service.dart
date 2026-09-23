import 'dart:convert';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

class RoomRocketEvent {
  const RoomRocketEvent({
    required this.id,
    required this.roomId,
    required this.level,
    required this.startsAtMs,
    required this.endsAtMs,
    required this.triggerUid,
    required this.triggerDisplayName,
    required this.triggerProfileImageUrl,
    required this.contributorIds,
    required this.top3Ids,
  });

  final String id;
  final String roomId;
  final int level;
  final int startsAtMs;
  final int endsAtMs;
  final String triggerUid;
  final String triggerDisplayName;
  final String triggerProfileImageUrl;
  final List<String> contributorIds;
  final List<String> top3Ids;

  bool activeAt(int nowMs) => nowMs >= startsAtMs && nowMs < endsAtMs;
  bool endedAt(int nowMs) => nowMs >= endsAtMs;

  factory RoomRocketEvent.fromDoc(
    QueryDocumentSnapshot<Map<String, dynamic>> doc,
  ) {
    final data = doc.data();
    final top3 = data['top3'] is List ? data['top3'] as List : const [];
    return RoomRocketEvent(
      id: doc.id,
      roomId: (data['roomId'] ?? '').toString(),
      level: (data['level'] as num?)?.toInt() ?? 0,
      startsAtMs: (data['startsAtMs'] as num?)?.toInt() ?? 0,
      endsAtMs: (data['endsAtMs'] as num?)?.toInt() ?? 0,
      triggerUid: (data['triggerUid'] ?? '').toString(),
      triggerDisplayName:
          (data['triggerDisplayName'] ?? 'مستخدم Shadow Live').toString(),
      triggerProfileImageUrl:
          (data['triggerProfileImageUrl'] ?? '').toString(),
      contributorIds: data['contributorIds'] is List
          ? (data['contributorIds'] as List)
              .map((e) => e.toString())
              .where((e) => e.isNotEmpty)
              .toList(growable: false)
          : const [],
      top3Ids: top3
          .whereType<Map>()
          .map((e) => (e['uid'] ?? '').toString())
          .where((e) => e.isNotEmpty)
          .toList(growable: false),
    );
  }
}

class RoomRocketState {
  const RoomRocketState({
    required this.currentLevel,
    required this.progressCoins,
    required this.thresholdCoins,
    required this.contributors,
  });

  final int currentLevel;
  final int progressCoins;
  final int thresholdCoins;
  final List<Map<String, dynamic>> contributors;

  double get progress => thresholdCoins <= 0
      ? 0
      : (progressCoins / thresholdCoins).clamp(0.0, 1.0).toDouble();

  factory RoomRocketState.fromMap(Map<String, dynamic> data) {
    final raw = data['levelContributors'];
    final contributors = <Map<String, dynamic>>[];
    if (raw is Map) {
      for (final entry in raw.entries) {
        if (entry.value is! Map) continue;
        final item = Map<String, dynamic>.from(entry.value as Map);
        item['uid'] = (item['uid'] ?? entry.key).toString();
        contributors.add(item);
      }
      contributors.sort(
        (a, b) => ((b['coins'] as num?)?.toInt() ?? 0)
            .compareTo((a['coins'] as num?)?.toInt() ?? 0),
      );
    }
    return RoomRocketState(
      currentLevel: (data['currentLevel'] as num?)?.toInt() ?? 1,
      progressCoins: (data['progressCoins'] as num?)?.toInt() ?? 0,
      thresholdCoins: (data['levelThresholdCoins'] as num?)?.toInt() ?? 100000,
      contributors: contributors,
    );
  }
}

class RoomRocketService {
  RoomRocketService({
    FirebaseFirestore? firestore,
    FirebaseAuth? auth,
    http.Client? client,
    String? baseUrl,
  })  : _firestore = firestore ?? FirebaseFirestore.instance,
        _auth = auth ?? FirebaseAuth.instance,
        _client = client ?? http.Client(),
        _baseUrl = baseUrl ??
            const String.fromEnvironment(
              'SHADOW_API_BASE_URL',
              defaultValue: 'https://shadow-live-six.vercel.app/api',
            );

  final FirebaseFirestore _firestore;
  final FirebaseAuth _auth;
  final http.Client _client;
  final String _baseUrl;

  Stream<List<RoomRocketEvent>> watchRecentEvents() {
    return _firestore
        .collection('room_rocket_explosions')
        .orderBy('startsAtMs', descending: true)
        .limit(80)
        .snapshots()
        .map(
          (snapshot) => snapshot.docs
              .map(RoomRocketEvent.fromDoc)
              .where((event) => event.roomId.isNotEmpty)
              .toList(growable: false),
        );
  }

  Stream<RoomRocketState> watchRoomState(String roomId) {
    return _firestore
        .collection('room_rocket_state')
        .doc(roomId)
        .snapshots()
        .map(
          (snapshot) => RoomRocketState.fromMap(
            snapshot.data() ?? const <String, dynamic>{},
          ),
        );
  }

  Future<Map<String, dynamic>> _post(
    String action,
    String explosionId,
  ) async {
    final token = await _auth.currentUser?.getIdToken();
    if (token == null || token.isEmpty) throw StateError('not_signed_in');
    final uri = Uri.parse('$_baseUrl/economy-router').replace(
      queryParameters: const {'route': 'room-rocket'},
    );
    final response = await _client
        .post(
          uri,
          headers: {
            'authorization': 'Bearer $token',
            'content-type': 'application/json',
          },
          body: jsonEncode({
            'action': action,
            'explosionId': explosionId,
          }),
        )
        .timeout(const Duration(seconds: 20));

    final decoded = response.body.isEmpty
        ? <String, dynamic>{}
        : Map<String, dynamic>.from(jsonDecode(response.body) as Map);
    if (response.statusCode < 200 ||
        response.statusCode >= 300 ||
        decoded['ok'] != true) {
      throw StateError((decoded['code'] ?? 'room_rocket_failed').toString());
    }
    return decoded;
  }

  Future<void> enter(String explosionId) async {
    await _post('enter', explosionId);
  }

  Future<Map<String, dynamic>> claim(String explosionId) =>
      _post('claim', explosionId);

  Future<Map<String, dynamic>?> loadRoomNavigationArguments(
    String roomId,
  ) async {
    final snapshot = await _firestore.collection('rooms').doc(roomId).get();
    if (!snapshot.exists) return null;
    final data = snapshot.data() ?? const <String, dynamic>{};
    return {
      ...data,
      'roomId': roomId,
    };
  }

  void close() => _client.close();
}
