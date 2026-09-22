import 'dart:convert';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

class RoomMusicTrack {
  const RoomMusicTrack({
    required this.id,
    required this.title,
    required this.artist,
    required this.durationMs,
    required this.sourceOwnerUid,
    required this.sourceOwnerName,
  });

  final String id;
  final String title;
  final String artist;
  final int durationMs;
  final String sourceOwnerUid;
  final String sourceOwnerName;

  factory RoomMusicTrack.fromMap(Map<String, dynamic> data) => RoomMusicTrack(
        id: (data['id'] ?? '').toString(),
        title: (data['title'] ?? 'مقطع صوتي').toString(),
        artist: (data['artist'] ?? '').toString(),
        durationMs: (data['durationMs'] as num?)?.toInt() ?? 0,
        sourceOwnerUid: (data['sourceOwnerUid'] ?? '').toString(),
        sourceOwnerName:
            (data['sourceOwnerName'] ?? 'مستخدم Shadow Live').toString(),
      );
}

class RoomMusicSnapshot {
  const RoomMusicSnapshot({
    required this.allowMembers,
    required this.queue,
    required this.status,
    required this.currentTrackId,
    required this.sourceOwnerUid,
  });

  final bool allowMembers;
  final List<RoomMusicTrack> queue;
  final String status;
  final String currentTrackId;
  final String sourceOwnerUid;

  RoomMusicTrack? get currentTrack {
    for (final track in queue) {
      if (track.id == currentTrackId) return track;
    }
    return null;
  }

  factory RoomMusicSnapshot.fromRoom(Map<String, dynamic> room) {
    final rawPolicy = room['musicPolicy'];
    final policy = rawPolicy is Map
        ? Map<String, dynamic>.from(rawPolicy)
        : const <String, dynamic>{};
    final rawState = room['musicState'];
    final state = rawState is Map
        ? Map<String, dynamic>.from(rawState)
        : const <String, dynamic>{};
    final rawQueue = room['musicQueue'];
    return RoomMusicSnapshot(
      allowMembers: policy['allowMembers'] == true,
      queue: rawQueue is List
          ? rawQueue
              .whereType<Map>()
              .map(
                (item) => RoomMusicTrack.fromMap(
                  Map<String, dynamic>.from(item),
                ),
              )
              .where((item) => item.id.isNotEmpty)
              .toList(growable: false)
          : const [],
      status: (state['status'] ?? 'stopped').toString(),
      currentTrackId: (state['currentTrackId'] ?? '').toString(),
      sourceOwnerUid: (state['sourceOwnerUid'] ?? '').toString(),
    );
  }
}

class RoomMusicService {
  RoomMusicService({
    FirebaseFirestore? firestore,
    FirebaseAuth? auth,
    http.Client? client,
    String? baseUrl,
  })  : _firestore = firestore ?? FirebaseFirestore.instance,
        _auth = auth ?? FirebaseAuth.instance,
        _client = client ?? http.Client(),
        _baseUrl = baseUrl ??
            const String.fromEnvironment(
              'SHADOW_API_BASE_URL',
              defaultValue: 'https://shadow-live-six.vercel.app/api',
            );

  final FirebaseFirestore _firestore;
  final FirebaseAuth _auth;
  final http.Client _client;
  final String _baseUrl;

  Stream<RoomMusicSnapshot> watch(String roomId) => _firestore
      .collection('rooms')
      .doc(roomId)
      .snapshots()
      .map((snapshot) => RoomMusicSnapshot.fromRoom(
            snapshot.data() ?? const <String, dynamic>{},
          ));

  Future<Map<String, dynamic>> _post(Map<String, dynamic> body) async {
    final token = await _auth.currentUser?.getIdToken();
    if (token == null || token.isEmpty) throw StateError('not_signed_in');
    final response = await _client.post(
      Uri.parse('$_baseUrl/voice-session'),
      headers: {
        'authorization': 'Bearer $token',
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
      throw StateError(
        (decoded['code'] ?? 'room_music_failed').toString(),
      );
    }
    return decoded;
  }

  Future<RoomMusicTrack> addTrack({
    required String roomId,
    required String title,
    String artist = '',
    int durationMs = 0,
  }) async {
    final body = await _post({
      'action': 'addRoomMusicTrack',
      'roomId': roomId,
      'title': title,
      'artist': artist,
      'durationMs': durationMs,
    });
    final track = body['track'];
    if (track is! Map) throw StateError('invalid_music_track');
    return RoomMusicTrack.fromMap(
      Map<String, dynamic>.from(track),
    );
  }

  Future<void> removeTrack({
    required String roomId,
    required String trackId,
  }) async {
    await _post({
      'action': 'removeRoomMusicTrack',
      'roomId': roomId,
      'trackId': trackId,
    });
  }

  Future<void> clearQueue(String roomId) async {
    await _post({
      'action': 'clearRoomMusicQueue',
      'roomId': roomId,
    });
  }

  Future<void> setAllowMembers({
    required String roomId,
    required bool value,
  }) async {
    await _post({
      'action': 'setRoomMusicPolicy',
      'roomId': roomId,
      'allowMembers': value,
    });
  }

  Future<void> play({
    required String roomId,
    required String trackId,
  }) async {
    await _post({
      'action': 'roomMusicCommand',
      'roomId': roomId,
      'command': 'play',
      'trackId': trackId,
    });
  }

  Future<void> stop(String roomId) async {
    await _post({
      'action': 'roomMusicCommand',
      'roomId': roomId,
      'command': 'stop',
    });
  }

  Future<void> skip(String roomId) async {
    await _post({
      'action': 'roomMusicCommand',
      'roomId': roomId,
      'command': 'skip',
    });
  }

  void close() => _client.close();
}
