import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

class VoiceSessionCredentials {
  const VoiceSessionCredentials({
    required this.appId,
    required this.token,
    required this.userId,
    required this.roomId,
    required this.expiresAt,
    required this.realtimeAdmission,
  });

  final int appId;
  final String token;
  final String userId;
  final String roomId;
  final DateTime expiresAt;
  final String realtimeAdmission;

  factory VoiceSessionCredentials.fromJson(Map<String, dynamic> json) {
    final appId = (json['appId'] as num?)?.toInt();
    final token = (json['token'] ?? '').toString();
    final userId = (json['userId'] ?? '').toString();
    final roomId = (json['roomId'] ?? '').toString();
    final expiresAt = (json['expiresAt'] as num?)?.toInt();
    if (appId == null ||
        appId <= 0 ||
        token.isEmpty ||
        userId.isEmpty ||
        roomId.isEmpty ||
        expiresAt == null) {
      throw const FormatException('invalid_voice_session');
    }
    return VoiceSessionCredentials(
      appId: appId,
      token: token,
      userId: userId,
      roomId: roomId,
      expiresAt: DateTime.fromMillisecondsSinceEpoch(expiresAt * 1000, isUtc: true),
      realtimeAdmission: (json['realtimeAdmission'] ?? '').toString(),
    );
  }
}

class VoiceTokenClient {
  VoiceTokenClient({
    http.Client? client,
    Future<String?> Function()? idTokenProvider,
    String? baseUrl,
  })  : _client = client ?? http.Client(),
        _idTokenProvider = idTokenProvider ??
            (() async {
              final user = FirebaseAuth.instance.currentUser;
              return user == null ? null : await user.getIdToken();
            }),
        _baseUrl = baseUrl ??
            const String.fromEnvironment(
              'SHADOW_CLOUDFLARE_API_BASE_URL',
              defaultValue:
                  'https://shadow-live.ashraf-business-440.workers.dev/api',
            );

  final http.Client _client;
  final Future<String?> Function() _idTokenProvider;
  final String _baseUrl;

  Future<VoiceSessionCredentials> createSession(
    String roomId, {
    String? roomPassword,
  }) async {
    final idToken = await _idTokenProvider();
    if (idToken == null || idToken.isEmpty) {
      throw StateError('not_signed_in');
    }
    final response = await _client.post(
      Uri.parse('$_baseUrl/voice-session'),
      headers: {
        'authorization': 'Bearer $idToken',
        'content-type': 'application/json',
      },
      body: jsonEncode({
        'roomId': roomId,
        if (roomPassword != null && roomPassword.isNotEmpty)
          'roomPassword': roomPassword,
      }),
    );
    Map<String, dynamic> body = <String, dynamic>{};
    try {
      final decoded = jsonDecode(response.body);
      if (decoded is Map<String, dynamic>) body = decoded;
    } catch (_) {}

    if (response.statusCode != 200 || body['ok'] != true) {
      throw StateError((body['code'] ?? 'voice_session_failed').toString());
    }
    return VoiceSessionCredentials.fromJson(body);
  }

  void close() => _client.close();
}
