import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

class RoomPresenceUser {
  const RoomPresenceUser({
    required this.uid,
    required this.displayName,
    required this.profileImageUrl,
    required this.joinedAtMs,
    required this.lastSeenAtMs,
  });

  final String uid;
  final String displayName;
  final String profileImageUrl;
  final int joinedAtMs;
  final int lastSeenAtMs;

  factory RoomPresenceUser.fromMap(Map<String, dynamic> data) =>
      RoomPresenceUser(
        uid: (data['uid'] ?? '').toString(),
        displayName:
            (data['displayName'] ?? 'مستخدم Shadow Live').toString(),
        profileImageUrl: (data['profileImageUrl'] ?? '').toString(),
        joinedAtMs: (data['joinedAtMs'] as num?)?.toInt() ?? 0,
        lastSeenAtMs: (data['lastSeenAtMs'] as num?)?.toInt() ?? 0,
      );
}

class RoomPresenceService {
  RoomPresenceService({
    FirebaseAuth? auth,
    http.Client? client,
    String? baseUrl,
  })  : _auth = auth ?? FirebaseAuth.instance,
        _client = client ?? http.Client(),
        _baseUrl = baseUrl ??
            const String.fromEnvironment(
              'SHADOW_CLOUDFLARE_API_BASE_URL',
              defaultValue: 'https://shadow-live.ashraf-business-440.workers.dev/api',
            );

  final FirebaseAuth _auth;
  final http.Client _client;
  final String _baseUrl;

  Future<Map<String, dynamic>> _post(
    String action,
    String roomId,
  ) async {
    final token = await _auth.currentUser?.getIdToken();
    if (token == null || token.isEmpty) throw StateError('not_signed_in');

    final response = await _client.post(
      Uri.parse('$_baseUrl/voice-session'),
      headers: {
        'authorization': 'Bearer $token',
        'content-type': 'application/json',
      },
      body: jsonEncode({
        'action': action,
        'roomId': roomId,
      }),
    );

    Map<String, dynamic> decoded = <String, dynamic>{};
    try {
      final value = jsonDecode(response.body);
      if (value is Map<String, dynamic>) decoded = value;
    } catch (_) {}

    if (response.statusCode != 200 || decoded['ok'] != true) {
      throw StateError(
        (decoded['code'] ?? 'room_presence_failed').toString(),
      );
    }
    return decoded;
  }

  Future<void> join(String roomId) async {
    await _post('roomPresenceJoin', roomId);
  }

  Future<void> heartbeat(String roomId) async {
    await _post('roomPresenceHeartbeat', roomId);
  }

  Future<void> leave(String roomId) async {
    await _post('roomPresenceLeave', roomId);
  }

  Future<List<RoomPresenceUser>> load(String roomId) async {
    final body = await _post('roomPresenceState', roomId);
    final raw = body['participants'];
    if (raw is! List) return const [];
    return raw
        .whereType<Map>()
        .map(
          (item) => RoomPresenceUser.fromMap(
            Map<String, dynamic>.from(item),
          ),
        )
        .where((item) => item.uid.isNotEmpty)
        .toList(growable: false);
  }

  void close() => _client.close();
}
