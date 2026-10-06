import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

class VipFancyIdState {
  const VipFancyIdState({
    required this.active,
    required this.fancyId,
    required this.assignmentId,
    required this.expiresAtMs,
    required this.effectiveVipLevel,
    required this.minDigits,
    required this.maxDigits,
  });

  final bool active;
  final String fancyId;
  final String assignmentId;
  final int expiresAtMs;
  final int effectiveVipLevel;
  final int minDigits;
  final int maxDigits;

  factory VipFancyIdState.fromJson(Map<String, dynamic> json) {
    int intValue(Object? raw) {
      if (raw is num) return raw.toInt();
      return int.tryParse(raw?.toString() ?? '') ?? 0;
    }

    final range = json['allowedRange'];
    final rangeMap =
        range is Map ? Map<String, dynamic>.from(range) : const <String, dynamic>{};
    final fancyId = (json['fancyId'] ?? '').toString().trim();
    return VipFancyIdState(
      active: json['active'] == true || fancyId.isNotEmpty,
      fancyId: fancyId,
      assignmentId: (json['assignmentId'] ?? '').toString().trim(),
      expiresAtMs: intValue(json['expiresAtMs']),
      effectiveVipLevel: intValue(json['effectiveVipLevel']).clamp(0, 10).toInt(),
      minDigits: intValue(rangeMap['min']),
      maxDigits: intValue(rangeMap['max']),
    );
  }
}

class UserIdResolution {
  const UserIdResolution({
    required this.uid,
    required this.source,
    this.publicId = '',
    this.fancyId = '',
    this.assignmentId = '',
    this.assignmentVersion = 0,
    this.expiresAtMs = 0,
  });

  final String uid;
  final String source;
  final String publicId;
  final String fancyId;
  final String assignmentId;
  final int assignmentVersion;
  final int expiresAtMs;

  factory UserIdResolution.fromJson(Map<String, dynamic> json) {
    int intValue(Object? raw) {
      if (raw is num) return raw.toInt();
      return int.tryParse(raw?.toString() ?? '') ?? 0;
    }
    return UserIdResolution(
      uid: (json['uid'] ?? '').toString().trim(),
      source: (json['source'] ?? '').toString().trim(),
      publicId: (json['publicId'] ?? '').toString().trim(),
      fancyId: (json['fancyId'] ?? '').toString().trim(),
      assignmentId: (json['assignmentId'] ?? '').toString().trim(),
      assignmentVersion: intValue(json['assignmentVersion']),
      expiresAtMs: intValue(json['expiresAtMs']),
    );
  }
}

class VipFancyIdService {
  VipFancyIdService({
    FirebaseAuth? auth,
    http.Client? client,
    String? baseUrl,
  })  : _auth = auth ?? FirebaseAuth.instance,
        _client = client ?? http.Client(),
        _ownsClient = client == null,
        _baseUrl = baseUrl ??
            const String.fromEnvironment(
              'SHADOW_CLOUDFLARE_API_BASE_URL',
              defaultValue:
                  'https://shadow-live.ashraf-business-440.workers.dev/api',
            );

  final FirebaseAuth _auth;
  final http.Client _client;
  final bool _ownsClient;
  final String _baseUrl;

  Future<String> _token() async {
    final token = await _auth.currentUser?.getIdToken();
    if (token == null || token.isEmpty) throw StateError('not_signed_in');
    return token;
  }

  Future<Map<String, dynamic>> _post(Map<String, dynamic> body) async {
    final token = await _token();
    final response = await _client.post(
      Uri.parse('$_baseUrl/vip-fancy-id'),
      headers: {
        'authorization': 'Bearer $token',
        'content-type': 'application/json',
      },
      body: jsonEncode(body),
    );
    Map<String, dynamic> data = const {};
    try {
      final decoded = jsonDecode(response.body);
      if (decoded is Map) data = Map<String, dynamic>.from(decoded);
    } catch (_) {}
    if (response.statusCode != 200 || data['ok'] != true) {
      throw StateError((data['code'] ?? 'fancy_id_failed').toString());
    }
    return data;
  }

  Future<VipFancyIdState> state() async {
    return VipFancyIdState.fromJson(await _post({'action': 'state'}));
  }

  Future<VipFancyIdState> assign(String fancyId) async {
    final data = await _post({
      'action': 'assign',
      'fancyId': fancyId.trim(),
      'idempotencyKey':
          'fancy_${DateTime.now().microsecondsSinceEpoch}_${_auth.currentUser?.uid ?? 'user'}',
    });
    return VipFancyIdState.fromJson({
      ...data,
      'active': true,
      'allowedRange': _rangeForVip(
        (data['effectiveVipLevel'] as num?)?.toInt() ?? 0,
      ),
    });
  }

  Future<UserIdResolution> resolve(String id) async {
    return UserIdResolution.fromJson(
      await _post({'action': 'resolve', 'id': id.trim()}),
    );
  }

  Map<String, int> _rangeForVip(int level) {
    if (level >= 10) return const {'min': 3, 'max': 7};
    if (level >= 8) return const {'min': 4, 'max': 7};
    if (level >= 3) return const {'min': 6, 'max': 7};
    return const {'min': 0, 'max': 0};
  }

  void close() {
    if (_ownsClient) _client.close();
  }
}
