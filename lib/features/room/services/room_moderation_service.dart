import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

class RoomBanEntry {
  const RoomBanEntry({
    required this.uid,
    required this.displayName,
    required this.profileImageUrl,
    required this.permanent,
    required this.durationMinutes,
    required this.expiresAt,
    required this.blockedByUid,
    required this.blockedByName,
  });

  final String uid;
  final String displayName;
  final String profileImageUrl;
  final bool permanent;
  final int durationMinutes;
  final DateTime? expiresAt;
  final String blockedByUid;
  final String blockedByName;

  factory RoomBanEntry.fromJson(Map<String, dynamic> json) {
    final expiresMs = (json['expiresAt'] as num?)?.toInt();
    return RoomBanEntry(
      uid: (json['uid'] ?? '').toString(),
      displayName:
          (json['displayName'] ?? 'مستخدم Shadow Live').toString(),
      profileImageUrl: (json['profileImageUrl'] ?? '').toString(),
      permanent: json['permanent'] == true,
      durationMinutes: (json['durationMinutes'] as num?)?.toInt() ?? 0,
      expiresAt: expiresMs == null
          ? null
          : DateTime.fromMillisecondsSinceEpoch(expiresMs),
      blockedByUid: (json['blockedByUid'] ?? '').toString(),
      blockedByName: (json['blockedByName'] ?? '').toString(),
    );
  }
}

class RoomModerationService {
  RoomModerationService({
    FirebaseAuth? auth,
    http.Client? client,
    String? baseUrl,
  })  : _auth = auth ?? FirebaseAuth.instance,
        _client = client ?? http.Client(),
        _baseUrl = baseUrl ??
            const String.fromEnvironment(
              'SHADOW_API_BASE_URL',
              defaultValue: 'https://shadow-live-six.vercel.app/api',
            );

  final FirebaseAuth _auth;
  final http.Client _client;
  final String _baseUrl;

  Future<Map<String, dynamic>> _post(Map<String, dynamic> body) async {
    final token = await _auth.currentUser?.getIdToken();
    if (token == null || token.isEmpty) throw StateError('not_signed_in');

    final response = await _client.post(
      Uri.parse('$_baseUrl/voice-session'),
      headers: {
        'authorization': 'Bearer ' + token,
        'content-type': 'application/json',
      },
      body: jsonEncode(body),
    );

    Map<String, dynamic> decoded = <String, dynamic>{};
    try {
      final value = jsonDecode(response.body);
      if (value is Map<String, dynamic>) decoded = value;
    } catch (_) {}

    if (response.statusCode != 200 || decoded['ok'] != true) {
      throw StateError((decoded['code'] ?? 'room_moderation_failed').toString());
    }
    return decoded;
  }

  Future<void> kick({
    required String roomId,
    required String targetUid,
    required String duration,
  }) async {
    await _post({
      'action': 'kickRoomUser',
      'roomId': roomId,
      'targetUid': targetUid,
      'duration': duration,
    });
  }

  Future<void> unban({
    required String roomId,
    required String targetUid,
  }) async {
    await _post({
      'action': 'unbanRoomUser',
      'roomId': roomId,
      'targetUid': targetUid,
    });
  }

  Future<List<RoomBanEntry>> loadBans(String roomId) async {
    final body = await _post({
      'action': 'roomBanList',
      'roomId': roomId,
    });
    final raw = body['bans'];
    if (raw is! List) return const [];
    return raw
        .whereType<Map>()
        .map(
          (item) => RoomBanEntry.fromJson(
            Map<String, dynamic>.from(item),
          ),
        )
        .toList(growable: false);
  }

  void close() => _client.close();
}
