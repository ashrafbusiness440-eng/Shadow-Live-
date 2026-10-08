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
    this.hidden = false,
    this.publiclyHidden = false,
  });

  final int level;
  final int maxLevel;
  final int points;
  final int minimumThreshold;
  final int? nextThreshold;
  final int remaining;
  final int progressBps;
  final bool hidden;
  final bool publiclyHidden;

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
      progressBps: _int(json['progressBps']).clamp(0, 10000).toInt(),
      hidden: json['hidden'] == true,
      publiclyHidden: json['publiclyHidden'] == true,
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
    super.hidden = false,
    super.publiclyHidden = false,
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
      hidden: base.hidden,
      publiclyHidden: base.publiclyHidden,
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

class UserLevelVisibility {
  const UserLevelVisibility({
    this.hiddenLevelEntitled = false,
    this.hideWealthLevel = false,
    this.hideAttractionLevel = false,
    this.hideGameLevel = false,
    this.isSelf = false,
    this.canEdit = false,
    this.viewerOverride = const <String, bool>{},
  });

  final bool hiddenLevelEntitled;
  final bool hideWealthLevel;
  final bool hideAttractionLevel;
  final bool hideGameLevel;
  final bool isSelf;
  final bool canEdit;
  final Map<String, bool> viewerOverride;

  factory UserLevelVisibility.fromJson(Map<String, dynamic> json) {
    final rawOverride = json['viewerOverride'];
    final override = <String, bool>{};
    if (rawOverride is Map) {
      for (final entry in rawOverride.entries) {
        override[entry.key.toString()] = entry.value == true;
      }
    }
    return UserLevelVisibility(
      hiddenLevelEntitled: json['hiddenLevelEntitled'] == true,
      hideWealthLevel: json['hideWealthLevel'] == true,
      hideAttractionLevel: json['hideAttractionLevel'] == true,
      hideGameLevel: json['hideGameLevel'] == true,
      isSelf: json['isSelf'] == true,
      canEdit: json['canEdit'] == true,
      viewerOverride: Map<String, bool>.unmodifiable(override),
    );
  }

  UserLevelVisibility copyWith({
    bool? hiddenLevelEntitled,
    bool? hideWealthLevel,
    bool? hideAttractionLevel,
    bool? hideGameLevel,
    bool? isSelf,
    bool? canEdit,
    Map<String, bool>? viewerOverride,
  }) {
    return UserLevelVisibility(
      hiddenLevelEntitled:
          hiddenLevelEntitled ?? this.hiddenLevelEntitled,
      hideWealthLevel: hideWealthLevel ?? this.hideWealthLevel,
      hideAttractionLevel:
          hideAttractionLevel ?? this.hideAttractionLevel,
      hideGameLevel: hideGameLevel ?? this.hideGameLevel,
      isSelf: isSelf ?? this.isSelf,
      canEdit: canEdit ?? this.canEdit,
      viewerOverride: viewerOverride ?? this.viewerOverride,
    );
  }

  Map<String, bool> toRequestJson() => <String, bool>{
        'hideWealthLevel': hideWealthLevel,
        'hideAttractionLevel': hideAttractionLevel,
        'hideGameLevel': hideGameLevel,
      };
}

class UserLevelSummary {
  const UserLevelSummary({
    required this.uid,
    required this.policyVersion,
    required this.wealth,
    required this.attraction,
    required this.games,
    this.visibility = const UserLevelVisibility(),
  });

  final String uid;
  final int policyVersion;
  final UserLevelSectionSummary wealth;
  final UserLevelSectionSummary attraction;
  final UserGameLevelSummary games;
  final UserLevelVisibility visibility;

  factory UserLevelSummary.fromJson(Map<String, dynamic> json) {
    Map<String, dynamic> map(Object? value) =>
        value is Map ? Map<String, dynamic>.from(value) : <String, dynamic>{};

    return UserLevelSummary(
      uid: (json['uid'] ?? '').toString(),
      policyVersion: UserLevelSectionSummary._int(json['policyVersion']),
      visibility: UserLevelVisibility.fromJson(map(json['visibility'])),
      wealth: UserLevelSectionSummary.fromJson(map(json['wealth'])),
      attraction: UserLevelSectionSummary.fromJson(map(json['attraction'])),
      games: UserGameLevelSummary.fromJson(map(json['games'])),
    );
  }

  UserLevelSummary copyWithVisibility(UserLevelVisibility next) {
    return UserLevelSummary(
      uid: uid,
      policyVersion: policyVersion,
      wealth: wealth,
      attraction: attraction,
      games: games,
      visibility: next,
    );
  }
}

class UserLevelSupportItem {
  const UserLevelSupportItem({
    required this.uid,
    required this.displayName,
    required this.profileImageUrl,
    required this.publicId,
    required this.rank,
    required this.points,
    required this.giftCount,
    required this.mysteriousMode,
    required this.mysteriousId,
  });

  final String uid;
  final String displayName;
  final String profileImageUrl;
  final String publicId;
  final int rank;
  final int points;
  final int giftCount;
  final bool mysteriousMode;
  final String mysteriousId;

  factory UserLevelSupportItem.fromJson(Map<String, dynamic> json) =>
      UserLevelSupportItem(
        uid: (json['uid'] ?? '').toString(),
        displayName: (json['displayName'] ?? 'مستخدم Shadow Live').toString(),
        profileImageUrl: (json['profileImageUrl'] ?? '').toString(),
        publicId: (json['publicId'] ?? '').toString(),
        rank: UserLevelSectionSummary._int(json['rank']),
        points: UserLevelSectionSummary._int(json['points']),
        giftCount: UserLevelSectionSummary._int(json['giftCount']),
        mysteriousMode: json['mysteriousMode'] == true,
        mysteriousId: (json['mysteriousId'] ?? '').toString(),
      );
}

class UserLevelSupportPage {
  const UserLevelSupportPage({
    required this.metric,
    required this.items,
    required this.nextCursor,
    required this.totalCap,
    required this.pageSize,
  });

  final String metric;
  final List<UserLevelSupportItem> items;
  final String? nextCursor;
  final int totalCap;
  final int pageSize;

  bool get hasMore => nextCursor != null && nextCursor!.isNotEmpty;

  factory UserLevelSupportPage.fromJson(Map<String, dynamic> json) {
    final rawItems = json['items'];
    return UserLevelSupportPage(
      metric: (json['metric'] ?? '').toString(),
      items: rawItems is List
          ? rawItems
              .whereType<Map>()
              .map(
                (item) => UserLevelSupportItem.fromJson(
                  Map<String, dynamic>.from(item),
                ),
              )
              .toList(growable: false)
          : const <UserLevelSupportItem>[],
      nextCursor: json['nextCursor'] == null
          ? null
          : (json['nextCursor'] ?? '').toString(),
      totalCap: UserLevelSectionSummary._int(json['totalCap']),
      pageSize: UserLevelSectionSummary._int(json['pageSize']),
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

    final body = _decode(response.body);
    if (response.statusCode != 200 || body['ok'] != true) {
      throw StateError((body['code'] ?? 'user_level_failed').toString());
    }

    final raw = body['summary'];
    if (raw is! Map) throw StateError('invalid_user_level_summary');
    return UserLevelSummary.fromJson(Map<String, dynamic>.from(raw));
  }

  Future<UserLevelSupportPage> loadSupportPage({
    required String uid,
    required String metric,
    String? cursor,
  }) async {
    final targetUid = uid.trim();
    final normalizedMetric = metric.trim();
    if (targetUid.isEmpty || targetUid.contains('/')) {
      throw StateError('invalid_user');
    }
    if (normalizedMetric != 'wealth' && normalizedMetric != 'attraction') {
      throw StateError('invalid_support_metric');
    }

    final user = _auth.currentUser;
    final token = await user?.getIdToken();
    if (user == null || token == null || token.isEmpty) {
      throw StateError('not_signed_in');
    }

    final query = <String, String>{
      'uid': targetUid,
      'supportMetric': normalizedMetric,
      'limit': '20',
      if (cursor != null && cursor.trim().isNotEmpty)
        'cursor': cursor.trim(),
    };
    final response = await _client.get(
      Uri.parse('$_baseUrl/user-level').replace(queryParameters: query),
      headers: {
        'authorization': 'Bearer $token',
        'accept': 'application/json',
      },
    );

    final body = _decode(response.body);
    if (response.statusCode != 200 || body['ok'] != true) {
      throw StateError(
        (body['code'] ?? 'user_level_support_failed').toString(),
      );
    }
    final raw = body['support'];
    if (raw is! Map) throw StateError('invalid_user_level_support');
    return UserLevelSupportPage.fromJson(Map<String, dynamic>.from(raw));
  }

  Future<UserLevelVisibility> updateVisibility({
    required bool hideWealthLevel,
    required bool hideAttractionLevel,
    required bool hideGameLevel,
  }) async {
    final user = _auth.currentUser;
    final token = await user?.getIdToken();
    if (user == null || token == null || token.isEmpty) {
      throw StateError('not_signed_in');
    }

    final response = await _client.post(
      Uri.parse('$_baseUrl/user-level'),
      headers: {
        'authorization': 'Bearer $token',
        'content-type': 'application/json',
        'accept': 'application/json',
      },
      body: jsonEncode({
        'action': 'updateVisibility',
        'visibility': {
          'hideWealthLevel': hideWealthLevel,
          'hideAttractionLevel': hideAttractionLevel,
          'hideGameLevel': hideGameLevel,
        },
      }),
    );

    final body = _decode(response.body);
    if (response.statusCode != 200 || body['ok'] != true) {
      throw StateError((body['code'] ?? 'user_level_visibility_failed').toString());
    }
    final raw = body['visibility'];
    if (raw is! Map) throw StateError('invalid_user_level_visibility');
    return UserLevelVisibility.fromJson(Map<String, dynamic>.from(raw));
  }

  Map<String, dynamic> _decode(String raw) {
    try {
      final decoded = jsonDecode(raw);
      if (decoded is Map) return Map<String, dynamic>.from(decoded);
    } catch (_) {}
    return <String, dynamic>{};
  }

  void close() => _client.close();
}
