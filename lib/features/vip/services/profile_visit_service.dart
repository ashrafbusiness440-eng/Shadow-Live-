import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

class ProfileVisitItem {
  const ProfileVisitItem({
    required this.uid,
    required this.publicId,
    required this.displayName,
    required this.profileImageUrl,
    required this.activeProfileFrameAssetKey,
    required this.activeProfileFrameImageUrl,
    required this.activeProfileFrameExpiresAtMs,
    required this.activeProfileFramePermanent,
    required this.effectiveVipLevel,
    required this.lastVisitedAt,
  });

  final String uid;
  final String publicId;
  final String displayName;
  final String profileImageUrl;
  final String activeProfileFrameAssetKey;
  final String activeProfileFrameImageUrl;
  final int activeProfileFrameExpiresAtMs;
  final bool activeProfileFramePermanent;
  final int effectiveVipLevel;
  final DateTime? lastVisitedAt;

  factory ProfileVisitItem.fromJson(Map<String, dynamic> json) {
    final rawDate = (json['lastVisitedAt'] ?? '').toString().trim();
    return ProfileVisitItem(
      uid: (json['uid'] ?? '').toString().trim(),
      publicId: (json['publicId'] ?? '').toString().trim(),
      displayName:
          (json['displayName'] ?? 'مستخدم Shadow Live').toString().trim(),
      profileImageUrl: (json['profileImageUrl'] ?? '').toString().trim(),
      activeProfileFrameAssetKey:
          (json['activeProfileFrameAssetKey'] ?? '').toString().trim(),
      activeProfileFrameImageUrl:
          (json['activeProfileFrameImageUrl'] ?? '').toString().trim(),
      activeProfileFrameExpiresAtMs:
          (json['activeProfileFrameExpiresAtMs'] as num?)?.toInt() ?? 0,
      activeProfileFramePermanent:
          json['activeProfileFramePermanent'] == true,
      effectiveVipLevel: ((json['effectiveVipLevel'] as num?)?.toInt() ?? 0)
          .clamp(0, 10)
          .toInt(),
      lastVisitedAt: rawDate.isEmpty ? null : DateTime.tryParse(rawDate),
    );
  }
}

class ProfileVisitService {
  ProfileVisitService({
    FirebaseAuth? auth,
    http.Client? client,
    String? baseUrl,
  })  : _auth = auth ?? FirebaseAuth.instance,
        _client = client ?? http.Client(),
        _baseUrl = baseUrl ??
            const String.fromEnvironment(
              'SHADOW_CLOUDFLARE_API_BASE_URL',
              defaultValue:
                  'https://shadow-live.ashraf-business-440.workers.dev/api',
            );

  final FirebaseAuth _auth;
  final http.Client _client;
  final String _baseUrl;

  Future<String> _token() async {
    final token = await _auth.currentUser?.getIdToken();
    if (token == null || token.isEmpty) throw StateError('not_signed_in');
    return token;
  }

  Future<Map<String, dynamic>> _post(Map<String, dynamic> payload) async {
    final token = await _token();
    final response = await _client.post(
      Uri.parse('$_baseUrl/profile-visits'),
      headers: {
        'authorization': 'Bearer $token',
        'content-type': 'application/json',
      },
      body: jsonEncode(payload),
    );
    Map<String, dynamic> body = const {};
    try {
      final decoded = jsonDecode(response.body);
      if (decoded is Map) body = Map<String, dynamic>.from(decoded);
    } catch (_) {}
    if (response.statusCode != 200 || body['ok'] != true) {
      throw StateError((body['code'] ?? 'profile_visits_failed').toString());
    }
    return body;
  }

  Future<void> record(String targetUid) async {
    final target = targetUid.trim();
    if (target.isEmpty || target == _auth.currentUser?.uid) return;
    await _post({'action': 'record', 'targetUid': target});
  }

  Future<List<ProfileVisitItem>> history({required bool visited}) async {
    final body = await _post({
      'action': 'history',
      'mode': visited ? 'visited' : 'visitors',
    });
    final raw = body['items'];
    if (raw is! List) return const [];
    return raw
        .whereType<Map>()
        .map((item) => ProfileVisitItem.fromJson(
              Map<String, dynamic>.from(item),
            ))
        .where((item) => item.uid.isNotEmpty)
        .toList(growable: false);
  }

  void close() => _client.close();
}
