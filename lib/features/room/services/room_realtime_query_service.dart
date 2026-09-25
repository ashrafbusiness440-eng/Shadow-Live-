import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

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
    final raw = decoded['counts'];
    if (raw is! Map) return const <String, int>{};

    return {
      for (final entry in raw.entries)
        entry.key.toString():
            entry.value is num ? (entry.value as num).toInt() : 0,
    };
  }

  void close() => _client.close();
}
