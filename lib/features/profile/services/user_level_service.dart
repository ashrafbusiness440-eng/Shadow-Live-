import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

class UserLevelSectionSummary {
  const UserLevelSectionSummary({
    required this.level,
    required this.maxLevel,
    required this.points,
    required this.minimumThreshold,
    required this.nextThreshold,
    required this.remaining,
    required this.progressBps,
  });

  final int level;
  final int maxLevel;
  final int points;
  final int minimumThreshold;
  final int? nextThreshold;
  final int remaining;
  final int progressBps;

  static int _int(Object? value) {
    if (value is num) return value.toInt();
    return int.tryParse(value?.toString() ?? '') ?? 0;
  }

  factory UserLevelSectionSummary.fromJson(Map<String, dynamic> json) {
    return UserLevelSectionSummary(
      level: _int(json['level']),
      maxLevel: _int(json['maxLevel']),
      points: _int(json['points']),
      minimumThreshold: _int(json['minimumThreshold']),
      nextThreshold:
          json['nextThreshold'] == null ? null : _int(json['nextThreshold']),
      remaining: _int(json['remaining']),
      progressBps: _int(json['progressBps']).clamp(0, 10000),
    );
  }
}

class UserGameLevelSummary extends UserLevelSectionSummary {
  const UserGameLevelSummary({
    required super.level,
    required super.maxLevel,
    required super.points,
    required super.minimumThreshold,
    required super.nextThreshold,
    required super.remaining,
    required super.progressBps,
    required this.storedPoints,
    required this.pendingDecayPoints,
    required this.pendingDecayDays,
    required this.lastGameActivityAtMs,
  });

  final int storedPoints;
  final int pendingDecayPoints;
  final int pendingDecayDays;
  final int? lastGameActivityAtMs;

  factory UserGameLevelSummary.fromJson(Map<String, dynamic> json) {
    final base = UserLevelSectionSummary.fromJson(json);
    final lastActivity = json['lastGameActivityAtMs'];
    return UserGameLevelSummary(
      level: base.level,
      maxLevel: base.maxLevel,
      points: base.points,
      minimumThreshold: base.minimumThreshold,
      nextThreshold: base.nextThreshold,
      remaining: base.remaining,
      progressBps: base.progressBps,
      storedPoints: UserLevelSectionSummary._int(json['storedPoints']),
      pendingDecayPoints:
          UserLevelSectionSummary._int(json['pendingDecayPoints']),
      pendingDecayDays:
          UserLevelSectionSummary._int(json['pendingDecayDays']),
      lastGameActivityAtMs: lastActivity == null
          ? null
          : UserLevelSectionSummary._int(lastActivity),
    );
  }
}

class UserLevelSummary {
  const UserLevelSummary({
    required this.uid,
    required this.policyVersion,
    required this.wealth,
    required this.attraction,
    required this.games,
  });

  final String uid;
  final int policyVersion;
  final UserLevelSectionSummary wealth;
  final UserLevelSectionSummary attraction;
  final UserGameLevelSummary games;

  factory UserLevelSummary.fromJson(Map<String, dynamic> json) {
    Map<String, dynamic> map(Object? value) =>
        value is Map ? Map<String, dynamic>.from(value) : <String, dynamic>{};

    return UserLevelSummary(
      uid: (json['uid'] ?? '').toString(),
      policyVersion: UserLevelSectionSummary._int(json['policyVersion']),
      wealth: UserLevelSectionSummary.fromJson(map(json['wealth'])),
      attraction: UserLevelSectionSummary.fromJson(map(json['attraction'])),
      games: UserGameLevelSummary.fromJson(map(json['games'])),
    );
  }
}

class UserLevelService {
  UserLevelService({
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

  Future<UserLevelSummary> loadSelf() async {
    final user = _auth.currentUser;
    if (user == null) throw StateError('not_signed_in');
    return loadForUser(user.uid);
  }

  Future<UserLevelSummary> loadForUser(String uid) async {
    final targetUid = uid.trim();
    if (targetUid.isEmpty || targetUid.contains('/')) {
      throw StateError('invalid_user');
    }
    final user = _auth.currentUser;
    final token = await user?.getIdToken();
    if (user == null || token == null || token.isEmpty) {
      throw StateError('not_signed_in');
    }

    final response = await _client.get(
      Uri.parse('$_baseUrl/user-level').replace(
        queryParameters: <String, String>{'uid': targetUid},
      ),
      headers: {
        'authorization': 'Bearer $token',
        'accept': 'application/json',
      },
    );

    Map<String, dynamic> body = <String, dynamic>{};
    try {
      final decoded = jsonDecode(response.body);
      if (decoded is Map) {
        body = Map<String, dynamic>.from(decoded);
      }
    } catch (_) {}

    if (response.statusCode != 200 || body['ok'] != true) {
      throw StateError((body['code'] ?? 'user_level_failed').toString());
    }

    final raw = body['summary'];
    if (raw is! Map) throw StateError('invalid_user_level_summary');
    return UserLevelSummary.fromJson(Map<String, dynamic>.from(raw));
  }

  void close() => _client.close();
}
