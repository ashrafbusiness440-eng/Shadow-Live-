import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

class RoomSupporter {
  const RoomSupporter({
    required this.uid,
    required this.rank,
    required this.displayName,
    required this.profileImageUrl,
    required this.totalSupport,
    required this.dailySupport,
  });

  final String uid;
  final int rank;
  final String displayName;
  final String profileImageUrl;
  final num totalSupport;
  final num dailySupport;

  factory RoomSupporter.fromJson(Map<String, dynamic> json) => RoomSupporter(
        uid: (json['uid'] ?? '').toString(),
        rank: (json['rank'] as num?)?.toInt() ?? 0,
        displayName:
            (json['displayName'] ?? 'مستخدم Shadow Live').toString(),
        profileImageUrl: (json['profileImageUrl'] ?? '').toString(),
        totalSupport: (json['totalSupport'] as num?) ?? 0,
        dailySupport: (json['dailySupport'] as num?) ?? 0,
      );
}

class RoomRankEntry {
  const RoomRankEntry({
    required this.roomId,
    required this.rank,
    required this.name,
    required this.publicId,
    required this.activityScore,
    required this.dailySupport,
  });

  final String roomId;
  final int rank;
  final String name;
  final String publicId;
  final int activityScore;
  final num dailySupport;

  factory RoomRankEntry.fromJson(Map<String, dynamic> json) => RoomRankEntry(
        roomId: (json['roomId'] ?? '').toString(),
        rank: (json['rank'] as num?)?.toInt() ?? 0,
        name: (json['name'] ?? 'غرفة صوتية').toString(),
        publicId: (json['publicId'] ?? '').toString(),
        activityScore: (json['activityScore'] as num?)?.toInt() ?? 0,
        dailySupport: (json['dailySupport'] as num?) ?? 0,
      );
}

class RoomInsights {
  const RoomInsights({
    required this.roomId,
    required this.level,
    required this.levelPoints,
    required this.levelTarget,
    required this.followerCount,
    required this.followed,
    required this.favorited,
    required this.dailySupport,
    required this.weeklySupport,
    required this.monthlySupport,
    required this.activityScore,
    required this.dailyRank,
    required this.supporters,
    required this.ranking,
  });

  final String roomId;
  final int level;
  final num levelPoints;
  final num levelTarget;
  final int followerCount;
  final bool followed;
  final bool favorited;
  final num dailySupport;
  final num weeklySupport;
  final num monthlySupport;
  final int activityScore;
  final int? dailyRank;
  final List<RoomSupporter> supporters;
  final List<RoomRankEntry> ranking;

  double get levelProgress {
    if (levelTarget <= 0) return 0;
    return (levelPoints / levelTarget).clamp(0, 1).toDouble();
  }

  factory RoomInsights.fromJson(Map<String, dynamic> json) {
    final rawSupporters = json['supporters'];
    final rawRanking = json['ranking'];
    return RoomInsights(
      roomId: (json['roomId'] ?? '').toString(),
      level: (json['level'] as num?)?.toInt() ?? 1,
      levelPoints: (json['levelPoints'] as num?) ?? 0,
      levelTarget: (json['levelTarget'] as num?) ?? 1000,
      followerCount: (json['followerCount'] as num?)?.toInt() ?? 0,
      followed: json['followed'] == true,
      favorited: json['favorited'] == true,
      dailySupport: (json['dailySupport'] as num?) ?? 0,
      weeklySupport: (json['weeklySupport'] as num?) ?? 0,
      monthlySupport: (json['monthlySupport'] as num?) ?? 0,
      activityScore: (json['activityScore'] as num?)?.toInt() ?? 0,
      dailyRank: (json['dailyRank'] as num?)?.toInt(),
      supporters: rawSupporters is List
          ? rawSupporters
              .whereType<Map>()
              .map(
                (item) => RoomSupporter.fromJson(
                  Map<String, dynamic>.from(item),
                ),
              )
              .toList()
          : const [],
      ranking: rawRanking is List
          ? rawRanking
              .whereType<Map>()
              .map(
                (item) => RoomRankEntry.fromJson(
                  Map<String, dynamic>.from(item),
                ),
              )
              .toList()
          : const [],
    );
  }
}

class RoomInsightsService {
  RoomInsightsService({
    http.Client? client,
    FirebaseAuth? auth,
    String? baseUrl,
  })  : _client = client ?? http.Client(),
        _auth = auth ?? FirebaseAuth.instance,
        _baseUrl = baseUrl ??
            const String.fromEnvironment(
              'SHADOW_CLOUDFLARE_API_BASE_URL',
              defaultValue: 'https://shadow-live.ashraf-business-440.workers.dev/api',
            );

  final http.Client _client;
  final FirebaseAuth _auth;
  final String _baseUrl;
  final Map<String, RoomInsights> _cache = <String, RoomInsights>{};
  final Map<String, DateTime> _cacheExpiresAt = <String, DateTime>{};
  final Map<String, Future<RoomInsights>> _inFlight =
      <String, Future<RoomInsights>>{};

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
      throw StateError((decoded['code'] ?? 'room_insights_failed').toString());
    }
    return decoded;
  }

  Future<RoomInsights> load(
    String roomId, {
    bool includeSupporters = false,
    bool includeRanking = false,
    bool bypassCache = false,
  }) {
    final key =
        '$roomId|supporters=$includeSupporters|ranking=$includeRanking';
    final now = DateTime.now();
    final cached = _cache[key];
    final expiresAt = _cacheExpiresAt[key];
    if (!bypassCache &&
        cached != null &&
        expiresAt != null &&
        expiresAt.isAfter(now)) {
      return Future<RoomInsights>.value(cached);
    }

    final running = _inFlight[key];
    if (running != null) return running;

    final future = () async {
      final body = await _post({
        'action': 'roomInsights',
        'roomId': roomId,
        'includeSupporters': includeSupporters,
        'includeRanking': includeRanking,
      });
      final value = RoomInsights.fromJson(body);
      _cache[key] = value;
      _cacheExpiresAt[key] = DateTime.now().add(
        Duration(seconds: includeSupporters || includeRanking ? 15 : 10),
      );
      return value;
    }();

    _inFlight[key] = future;
    return future.whenComplete(() => _inFlight.remove(key));
  }

  void _invalidateRoom(String roomId) {
    final prefix = '$roomId|';
    for (final key in _cache.keys.where((key) => key.startsWith(prefix)).toList()) {
      _cache.remove(key);
      _cacheExpiresAt.remove(key);
    }
  }

  Future<RoomInsights> setFavorite({
    required String roomId,
    required bool favorite,
  }) async {
    await _post({
      'action': 'setRoomFavorite',
      'roomId': roomId,
      'favorite': favorite,
    });
    _invalidateRoom(roomId);
    return load(roomId, bypassCache: true);
  }

  Future<RoomInsights> setFollowing({
    required String roomId,
    required bool following,
  }) async {
    await _post({
      'action': 'setRoomFollow',
      'roomId': roomId,
      'following': following,
    });
    _invalidateRoom(roomId);
    return load(roomId, bypassCache: true);
  }

  void close() => _client.close();
}
