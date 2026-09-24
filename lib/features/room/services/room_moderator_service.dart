import 'dart:convert';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

class RoomModerator {
  const RoomModerator({
    required this.uid,
    required this.displayName,
    required this.profileImageUrl,
    required this.capabilities,
  });

  final String uid;
  final String displayName;
  final String profileImageUrl;
  final Set<String> capabilities;

  factory RoomModerator.fromMap(Map<String, dynamic> data) {
    final caps = data['capabilities'];
    return RoomModerator(
      uid: (data['uid'] ?? '').toString(),
      displayName:
          (data['displayName'] ?? 'مستخدم Shadow Live').toString(),
      profileImageUrl: (data['profileImageUrl'] ?? '').toString(),
      capabilities: caps is List
          ? caps.map((value) => value.toString()).toSet()
          : <String>{},
    );
  }
}

class RoomModeratorState {
  const RoomModeratorState({
    required this.roomId,
    required this.isOwner,
    required this.limit,
    required this.myCapabilities,
    required this.moderators,
  });

  final String roomId;
  final bool isOwner;
  final int limit;
  final Set<String> myCapabilities;
  final List<RoomModerator> moderators;

  bool has(String capability) => isOwner || myCapabilities.contains(capability);
}

class RoomModeratorService {
  RoomModeratorService({
    FirebaseFirestore? firestore,
    FirebaseAuth? auth,
    http.Client? client,
    String? baseUrl,
  })  : _firestore = firestore ?? FirebaseFirestore.instance,
        _auth = auth ?? FirebaseAuth.instance,
        _client = client ?? http.Client(),
        _baseUrl = baseUrl ??
            const String.fromEnvironment(
              'SHADOW_CLOUDFLARE_API_BASE_URL',
              defaultValue: 'https://shadow-live.ashraf-business-440.workers.dev/api',
            );

  static const capabilities = <String>{
    'manageMic',
    'moderateUsers',
    'moderateChat',
    'manageMusic',
    'manageMusicPolicy',
    'managePk',
    'manageIds',
  };

  final FirebaseFirestore _firestore;
  final FirebaseAuth _auth;
  final http.Client _client;
  final String _baseUrl;

  int _limit(Map<String, dynamic> room) {
    final rawLevel = room['level'];
    final level = (rawLevel is num
            ? rawLevel.toInt()
            : int.tryParse(rawLevel?.toString() ?? '') ?? 1)
        .clamp(1, 6)
        .toInt();
    final agency = (room['roomType'] ?? room['type']).toString() == 'agency';
    const normal = [3, 4, 5, 7, 9, 12];
    const agencyTable = [5, 6, 7, 9, 11, 14];
    return (agency ? agencyTable : normal)[level - 1];
  }

  Stream<RoomModeratorState> watch(String roomId) {
    return _firestore.collection('rooms').doc(roomId).snapshots().map((snap) {
      final room = snap.data() ?? <String, dynamic>{};
      final uid = _auth.currentUser?.uid ?? '';
      final ownerUid =
          (room['ownerUid'] ?? room['ownerId'] ?? room['hostId'] ?? '')
              .toString();
      final raw = room['moderators'];
      final moderators = raw is List
          ? raw
              .whereType<Map>()
              .map(
                (item) => RoomModerator.fromMap(
                  Map<String, dynamic>.from(item),
                ),
              )
              .where((item) => item.uid.isNotEmpty)
              .toList(growable: false)
          : const <RoomModerator>[];
      final mine = moderators
          .where((item) => item.uid == uid)
          .map((item) => item.capabilities)
          .fold<Set<String>>(<String>{}, (all, caps) => all..addAll(caps));
      return RoomModeratorState(
        roomId: roomId,
        isOwner: uid.isNotEmpty && uid == ownerUid,
        limit: _limit(room),
        myCapabilities: mine,
        moderators: moderators,
      );
    });
  }

  Future<void> setModerator({
    required String roomId,
    String? targetUid,
    String? targetPublicId,
    required bool enabled,
    Set<String> capabilities = const {},
  }) async {
    final token = await _auth.currentUser?.getIdToken();
    if (token == null || token.isEmpty) throw StateError('not_signed_in');

    final cleanCaps =
        capabilities.where(RoomModeratorService.capabilities.contains).toList();
    final response = await _client.post(
      Uri.parse('$_baseUrl/voice-session'),
      headers: {
        'authorization': 'Bearer $token',
        'content-type': 'application/json',
      },
      body: jsonEncode({
        'action': 'setRoomModerator',
        'roomId': roomId,
        if (targetUid != null && targetUid.isNotEmpty) 'targetUid': targetUid,
        if (targetPublicId != null && targetPublicId.isNotEmpty)
          'targetPublicId': targetPublicId,
        'enabled': enabled,
        'capabilities': cleanCaps,
      }),
    );

    Map<String, dynamic> body = <String, dynamic>{};
    try {
      final decoded = jsonDecode(response.body);
      if (decoded is Map<String, dynamic>) body = decoded;
    } catch (_) {}

    if (response.statusCode != 200 || body['ok'] != true) {
      throw StateError(
        (body['code'] ?? 'room_moderator_failed').toString(),
      );
    }
  }

  void close() => _client.close();
}
