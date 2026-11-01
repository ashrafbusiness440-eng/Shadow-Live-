import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

/// Return only counts explicitly verified by the live server for requested rooms.
/// A malformed value or missing key is unknown, never an invented zero.
Map<String, int> verifiedRoomPresenceCounts(
  Object? raw,
  Iterable<String> requestedRoomIds,
) {
  if (raw is! Map) return const {};
  final requested = requestedRoomIds.toSet();
  return {
    for (final entry in raw.entries)
      if (entry.key is String &&
          requested.contains(entry.key) &&
          entry.value is num &&
          (entry.value as num).isFinite &&
          (entry.value as num) >= 0)
        entry.key as String: (entry.value as num).toInt(),
  };
}

class RoomFollowLocation {
  const RoomFollowLocation({
    required this.targetUid,
    required this.roomId,
    required this.roomName,
    required this.requiresPassword,
  });

  final String targetUid;
  final String roomId;
  final String roomName;
  final bool requiresPassword;

  factory RoomFollowLocation.fromMap(Map<String, dynamic> data) =>
      RoomFollowLocation(
        targetUid: (data['targetUid'] ?? '').toString(),
        roomId: (data['roomId'] ?? '').toString(),
        roomName: (data['roomName'] ?? 'غرفة صوتية').toString(),
        requiresPassword: data['requiresPassword'] == true,
      );
}

class RoomRealtimeQueryService {
  RoomRealtimeQueryService({
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

  Future<Map<String, int>> loadCounts(Iterable<String> roomIds) async {
    final ids = roomIds
        .map((id) => id.trim())
        .where((id) => id.isNotEmpty)
        .toSet()
        .take(60)
        .toList(growable: false);
    if (ids.isEmpty) return const <String, int>{};

    final token = await _auth.currentUser?.getIdToken();
    if (token == null || token.isEmpty) return const <String, int>{};

    final response = await _client.post(
      Uri.parse('$_baseUrl/room-realtime'),
      headers: {
        'authorization': 'Bearer $token',
        'content-type': 'application/json',
      },
      body: jsonEncode({
        'action': 'presenceCounts',
        'roomIds': ids,
      }),
    );

    if (response.statusCode != 200) {
      throw StateError('room_realtime_counts_failed');
    }

    final decoded = jsonDecode(response.body);
    if (decoded is! Map || decoded['ok'] != true) {
      throw StateError('room_realtime_counts_failed');
    }
    return verifiedRoomPresenceCounts(decoded['counts'], ids);
  }

  /// Shared by chat headers, suggested people and profile visitors.
  /// Reuses one authenticated room-realtime endpoint, no avatar listeners.
  Future<Map<String, RoomFollowLocation>> resolveRoomFollows(
    Iterable<String> targetUids,
  ) async {
    final userUid = _auth.currentUser?.uid;
    if (userUid == null || userUid.isEmpty) return const {};
    final ids = targetUids
        .map((id) => id.trim())
        .where((id) => id.isNotEmpty && id != userUid)
        .toSet()
        .take(8)
        .toList(growable: false);
    if (ids.isEmpty) return const {};

    final token = await _auth.currentUser?.getIdToken();
    if (_auth.currentUser?.uid != userUid) {
      throw StateError('room_follow_account_changed');
    }
    if (token == null || token.isEmpty) {
      throw StateError('room_follow_auth_required');
    }
    final response = await _client.post(
      Uri.parse('$_baseUrl/room-realtime'),
      headers: {
        'authorization': 'Bearer $token',
        'content-type': 'application/json',
      },
      body: jsonEncode({
        'action': 'resolveRoomFollows',
        'targetUids': ids,
      }),
    );
    if (_auth.currentUser?.uid != userUid) {
      throw StateError('room_follow_account_changed');
    }
    if (response.statusCode != 200) {
      throw StateError('room_follow_unavailable');
    }
    final payload = jsonDecode(response.body);
    if (payload is! Map || payload['ok'] != true ||
        payload['targets'] is! List) {
      throw StateError('room_follow_unavailable');
    }
    final followable = <String, RoomFollowLocation>{};
    for (final raw in payload['targets'] as List) {
      if (raw is! Map) continue;
      final item = RoomFollowLocation.fromMap(
        Map<String, dynamic>.from(raw),
      );
      if (ids.contains(item.targetUid) && item.roomId.isNotEmpty) {
        followable[item.targetUid] = item;
      }
    }
    return followable;
  }

  void close() => _client.close();
}
