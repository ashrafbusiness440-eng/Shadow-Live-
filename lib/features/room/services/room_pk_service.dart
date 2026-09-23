import 'dart:convert';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

class RoomPkSpeaker {
  const RoomPkSpeaker({
    required this.uid,
    required this.displayName,
    required this.profileImageUrl,
    required this.seatIndex,
  });

  final String uid;
  final String displayName;
  final String profileImageUrl;
  final int seatIndex;

  factory RoomPkSpeaker.fromMap(Map<String, dynamic> data) => RoomPkSpeaker(
        uid: (data['uid'] ?? '').toString(),
        displayName:
            (data['displayName'] ?? 'مستخدم Shadow Live').toString(),
        profileImageUrl: (data['profileImageUrl'] ?? '').toString(),
        seatIndex: (data['index'] as num?)?.toInt() ?? -1,
      );
}

class RoomPkParticipant {
  const RoomPkParticipant({
    required this.uid,
    required this.displayName,
    required this.profileImageUrl,
    required this.seatIndex,
    required this.team,
    required this.accepted,
    required this.score,
  });

  final String uid;
  final String displayName;
  final String profileImageUrl;
  final int seatIndex;
  final String team;
  final bool accepted;
  final num score;

  factory RoomPkParticipant.fromMap(Map<String, dynamic> data) =>
      RoomPkParticipant(
        uid: (data['uid'] ?? '').toString(),
        displayName:
            (data['displayName'] ?? 'مستخدم Shadow Live').toString(),
        profileImageUrl: (data['profileImageUrl'] ?? '').toString(),
        seatIndex: (data['seatIndex'] as num?)?.toInt() ?? -1,
        team: (data['team'] ?? 'a').toString(),
        accepted: data['accepted'] == true,
        score: (data['score'] as num?) ?? 0,
      );
}

class RoomPkSupporter {
  const RoomPkSupporter({
    required this.uid,
    required this.displayName,
    required this.profileImageUrl,
    required this.coins,
  });

  final String uid;
  final String displayName;
  final String profileImageUrl;
  final num coins;

  factory RoomPkSupporter.fromMap(Map<String, dynamic> data) =>
      RoomPkSupporter(
        uid: (data['uid'] ?? '').toString(),
        displayName:
            (data['displayName'] ?? 'مستخدم Shadow Live').toString(),
        profileImageUrl: (data['profileImageUrl'] ?? '').toString(),
        coins: (data['coins'] as num?) ?? 0,
      );
}

class RoomPkState {
  const RoomPkState({
    required this.id,
    required this.status,
    required this.mode,
    required this.durationMinutes,
    required this.participants,
    required this.createdBy,
    required this.countdownEndsAtMs,
    required this.endsAtMs,
    required this.overtimeUsed,
    required this.winner,
    required this.supporters,
  });

  final String id;
  final String status;
  final String mode;
  final int durationMinutes;
  final List<RoomPkParticipant> participants;
  final String createdBy;
  final int countdownEndsAtMs;
  final int endsAtMs;
  final bool overtimeUsed;
  final String winner;
  final List<RoomPkSupporter> supporters;

  num get scoreA => participants
      .where((item) => item.team == 'a')
      .fold<num>(0, (sum, item) => sum + item.score);

  num get scoreB => participants
      .where((item) => item.team == 'b')
      .fold<num>(0, (sum, item) => sum + item.score);

  bool participantAccepted(String uid) => participants
      .where((item) => item.uid == uid)
      .any((item) => item.accepted);

  bool isParticipant(String uid) =>
      participants.any((item) => item.uid == uid);

  factory RoomPkState.fromMap(Map<String, dynamic> data) {
    final rawParticipants = data['participants'];
    final rawSupporters = data['supporters'];
    return RoomPkState(
      id: (data['id'] ?? '').toString(),
      status: (data['status'] ?? 'idle').toString(),
      mode: (data['mode'] ?? '').toString(),
      durationMinutes: (data['durationMinutes'] as num?)?.toInt() ?? 0,
      participants: rawParticipants is List
          ? rawParticipants
              .whereType<Map>()
              .map(
                (item) => RoomPkParticipant.fromMap(
                  Map<String, dynamic>.from(item),
                ),
              )
              .toList(growable: false)
          : const [],
      createdBy: (data['createdBy'] ?? '').toString(),
      countdownEndsAtMs:
          (data['countdownEndsAtMs'] as num?)?.toInt() ?? 0,
      endsAtMs: (data['endsAtMs'] as num?)?.toInt() ?? 0,
      overtimeUsed: data['overtimeUsed'] == true,
      winner: (data['winner'] ?? '').toString(),
      supporters: rawSupporters is List
          ? rawSupporters
              .whereType<Map>()
              .map(
                (item) => RoomPkSupporter.fromMap(
                  Map<String, dynamic>.from(item),
                ),
              )
              .toList(growable: false)
          : const [],
    );
  }
}

class RoomPkContext {
  const RoomPkContext({
    required this.pk,
    required this.speakers,
  });

  final RoomPkState? pk;
  final List<RoomPkSpeaker> speakers;
}

class RoomPkService {
  RoomPkService({
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

  Stream<RoomPkContext> watch(String roomId) {
    return _firestore.collection('rooms').doc(roomId).snapshots().map((snap) {
      final data = snap.data() ?? <String, dynamic>{};
      final rawSeats = data['seats'];
      final speakers = rawSeats is List
          ? rawSeats
              .whereType<Map>()
              .map(
                (item) => RoomPkSpeaker.fromMap(
                  Map<String, dynamic>.from(item),
                ),
              )
              .where((item) => item.uid.isNotEmpty)
              .toList(growable: false)
          : const <RoomPkSpeaker>[];
      final rawPk = data['pkState'];
      return RoomPkContext(
        pk: rawPk is Map
            ? RoomPkState.fromMap(Map<String, dynamic>.from(rawPk))
            : null,
        speakers: speakers,
      );
    });
  }

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
      throw StateError((decoded['code'] ?? 'pk_action_failed').toString());
    }
    return decoded;
  }

  Future<void> create({
    required String roomId,
    required List<String> participantUids,
    required int durationMinutes,
  }) async {
    await _post({
      'action': 'createPk',
      'roomId': roomId,
      'participantUids': participantUids,
      'durationMinutes': durationMinutes,
    });
  }

  Future<void> accept(String roomId) async {
    await _post({'action': 'acceptPk', 'roomId': roomId});
  }

  Future<void> decline(String roomId) async {
    await _post({'action': 'declinePk', 'roomId': roomId});
  }

  Future<void> cancel(String roomId) async {
    await _post({'action': 'cancelPk', 'roomId': roomId});
  }

  Future<void> sync(String roomId) async {
    await _post({'action': 'syncPk', 'roomId': roomId});
  }

  void close() => _client.close();
}
