import 'dart:convert';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

class StarBattleLeader {
  const StarBattleLeader({
    required this.uid,
    required this.displayName,
    required this.profileImageUrl,
    required this.coins,
  });
  final String uid;
  final String displayName;
  final String profileImageUrl;
  final int coins;

  factory StarBattleLeader.fromMap(Map<String, dynamic> map) => StarBattleLeader(
        uid: (map['uid'] ?? '').toString(),
        displayName: (map['displayName'] ?? 'مستخدم Shadow Live').toString(),
        profileImageUrl: (map['profileImageUrl'] ?? '').toString(),
        coins: (map['coins'] as num?)?.toInt() ?? 0,
      );
}

class StarBattleState {
  const StarBattleState({
    required this.id,
    required this.status,
    required this.durationMinutes,
    required this.endsAtMs,
    required this.leaders,
  });
  final String id;
  final String status;
  final int durationMinutes;
  final int endsAtMs;
  final List<StarBattleLeader> leaders;

  bool get active => status == 'active';

  factory StarBattleState.fromMap(Map<String, dynamic> map) {
    final raw = map['leaders'];
    return StarBattleState(
      id: (map['id'] ?? '').toString(),
      status: (map['status'] ?? 'idle').toString(),
      durationMinutes: (map['durationMinutes'] as num?)?.toInt() ?? 0,
      endsAtMs: (map['endsAtMs'] as num?)?.toInt() ?? 0,
      leaders: raw is List
          ? raw.whereType<Map>().map((item) => StarBattleLeader.fromMap(
              Map<String, dynamic>.from(item))).toList(growable: false)
          : const [],
    );
  }
}

class StarBattleService {
  StarBattleService({
    FirebaseFirestore? firestore,
    FirebaseAuth? auth,
    http.Client? client,
    String? baseUrl,
  })  : _firestore = firestore ?? FirebaseFirestore.instance,
        _auth = auth ?? FirebaseAuth.instance,
        _client = client ?? http.Client(),
        _baseUrl = baseUrl ??
            const String.fromEnvironment(
              'SHADOW_CLOUDFLARE_API_BASE_URL',
              defaultValue: 'https://shadow-live.ashraf-business-440.workers.dev/api',
            );

  final FirebaseFirestore _firestore;
  final FirebaseAuth _auth;
  final http.Client _client;
  final String _baseUrl;

  Stream<StarBattleState?> watch(String roomId) => _firestore
      .collection('rooms')
      .doc(roomId)
      .snapshots()
      .map((snap) {
        final raw = snap.data()?['starBattleState'];
        return raw is Map
            ? StarBattleState.fromMap(Map<String, dynamic>.from(raw))
            : null;
      });

  Future<Map<String, dynamic>> _post(Map<String, dynamic> body) async {
    final token = await _auth.currentUser?.getIdToken();
    if (token == null || token.isEmpty) throw StateError('not_signed_in');
    final response = await _client.post(
      Uri.parse('$_baseUrl/voice-session'),
      headers: {
        'authorization': 'Bearer $token',
        'content-type': 'application/json',
      },
      body: jsonEncode(body),
    );
    final decoded = jsonDecode(response.body);
    final map = decoded is Map ? Map<String, dynamic>.from(decoded) : <String, dynamic>{};
    if (response.statusCode != 200 || map['ok'] != true) {
      throw StateError((map['code'] ?? 'star_battle_failed').toString());
    }
    return map;
  }

  Future<void> create({
    required String roomId,
    required int durationMinutes,
  }) async {
    await _post({
      'action': 'createStarBattle',
      'roomId': roomId,
      'durationMinutes': durationMinutes,
    });
  }

  Future<void> finish(String roomId) async {
    await _post({'action': 'finishStarBattle', 'roomId': roomId});
  }

  Future<void> sync(String roomId) async {
    await _post({'action': 'syncStarBattle', 'roomId': roomId});
  }

  Future<List<StarBattleState>> history(String roomId) async {
    final map = await _post({'action': 'starBattleHistory', 'roomId': roomId});
    final raw = map['history'];
    return raw is List
        ? raw.whereType<Map>().map((item) => StarBattleState.fromMap(
            Map<String, dynamic>.from(item))).toList(growable: false)
        : const [];
  }

  void close() => _client.close();
}
