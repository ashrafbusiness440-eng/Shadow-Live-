import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

import '../../games/services/game_runtime_service.dart';
import 'room_insights_service.dart';
import 'room_moderator_service.dart';
import 'room_rocket_service.dart';
import 'room_seat_service.dart';

class RoomBootstrapSnapshot {
  const RoomBootstrapSnapshot({
    required this.room,
    required this.ownerProfile,
    required this.seatState,
    required this.moderatorState,
    required this.insights,
    required this.rocketState,
    required this.games,
    required this.serverNowMs,
  });

  final Map<String, dynamic> room;
  final Map<String, dynamic> ownerProfile;
  final RoomSeatState seatState;
  final RoomModeratorState moderatorState;
  final RoomInsights insights;
  final RoomRocketState rocketState;
  final List<GameCatalogEntry> games;
  final int serverNowMs;

  factory RoomBootstrapSnapshot.fromJson(Map<String, dynamic> json) {
    final room = json['room'] is Map
        ? Map<String, dynamic>.from(json['room'] as Map)
        : const <String, dynamic>{};
    final ownerProfile = json['ownerProfile'] is Map
        ? Map<String, dynamic>.from(json['ownerProfile'] as Map)
        : const <String, dynamic>{};
    final seat = json['seatState'] is Map
        ? Map<String, dynamic>.from(json['seatState'] as Map)
        : const <String, dynamic>{};
    final moderator = json['moderatorState'] is Map
        ? Map<String, dynamic>.from(json['moderatorState'] as Map)
        : const <String, dynamic>{};
    final insights = json['insights'] is Map
        ? Map<String, dynamic>.from(json['insights'] as Map)
        : const <String, dynamic>{};
    final rocket = json['rocketState'] is Map
        ? Map<String, dynamic>.from(json['rocketState'] as Map)
        : const <String, dynamic>{};
    final gamesBody = json['games'] is Map
        ? Map<String, dynamic>.from(json['games'] as Map)
        : const <String, dynamic>{};
    final rawGames = gamesBody['items'];

    final rawModerators = moderator['moderators'];
    final rawCapabilities = moderator['myCapabilities'];

    return RoomBootstrapSnapshot(
      room: room,
      ownerProfile: ownerProfile,
      seatState: RoomSeatState.fromJson(seat),
      moderatorState: RoomModeratorState(
        roomId: (moderator['roomId'] ?? '').toString(),
        isOwner: moderator['isOwner'] == true,
        limit: (moderator['limit'] as num?)?.toInt() ?? 0,
        myCapabilities: rawCapabilities is List
            ? rawCapabilities.map((item) => item.toString()).toSet()
            : const <String>{},
        moderators: rawModerators is List
            ? rawModerators
                .whereType<Map>()
                .map(
                  (item) => RoomModerator.fromMap(
                    Map<String, dynamic>.from(item),
                  ),
                )
                .where((item) => item.uid.isNotEmpty)
                .toList(growable: false)
            : const <RoomModerator>[],
      ),
      insights: RoomInsights.fromJson(insights),
      rocketState: RoomRocketState.fromMap(rocket),
      games: rawGames is List
          ? rawGames
              .whereType<Map>()
              .map(
                (item) => GameCatalogEntry.fromJson(
                  Map<String, dynamic>.from(item),
                ),
              )
              .where((item) => item.key.isNotEmpty)
              .toList(growable: false)
          : const <GameCatalogEntry>[],
      serverNowMs: (json['serverNowMs'] as num?)?.toInt() ?? 0,
    );
  }
}

class RoomBootstrapService {
  RoomBootstrapService({
    http.Client? client,
    FirebaseAuth? auth,
    String? baseUrl,
  })  : _client = client ?? http.Client(),
        _auth = auth ?? FirebaseAuth.instance,
        _baseUrl = baseUrl ??
            const String.fromEnvironment(
              'SHADOW_CLOUDFLARE_API_BASE_URL',
              defaultValue:
                  'https://shadow-live.ashraf-business-440.workers.dev/api',
            );

  final http.Client _client;
  final FirebaseAuth _auth;
  final String _baseUrl;

  Future<RoomBootstrapSnapshot> load(String roomId) async {
    final cleanRoomId = roomId.trim();
    if (cleanRoomId.isEmpty) throw StateError('room_id_missing');
    final token = await _auth.currentUser?.getIdToken();
    if (token == null || token.isEmpty) throw StateError('not_signed_in');

    final response = await _client.post(
      Uri.parse('$_baseUrl/voice-session'),
      headers: {
        'authorization': 'Bearer $token',
        'content-type': 'application/json',
      },
      body: jsonEncode({
        'action': 'roomBootstrap',
        'roomId': cleanRoomId,
      }),
    );

    Map<String, dynamic> decoded = <String, dynamic>{};
    try {
      final value = jsonDecode(response.body);
      if (value is Map<String, dynamic>) decoded = value;
    } catch (_) {}

    if (response.statusCode != 200 || decoded['ok'] != true) {
      throw StateError(
        (decoded['code'] ?? 'room_bootstrap_failed').toString(),
      );
    }
    return RoomBootstrapSnapshot.fromJson(decoded);
  }

  void close() => _client.close();
}
