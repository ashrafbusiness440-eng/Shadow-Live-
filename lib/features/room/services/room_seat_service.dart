import 'dart:convert';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

class VoiceSeat {
  const VoiceSeat({
    required this.index,
    required this.uid,
    required this.displayName,
    required this.profileImageUrl,
    required this.muted,
    this.starBattleCoins = 0,
  });

  final int index;
  final String uid;
  final String displayName;
  final String profileImageUrl;
  final bool muted;
  final int starBattleCoins;

  bool get occupied => uid.isNotEmpty;

  factory VoiceSeat.fromJson(Map<String, dynamic> json) => VoiceSeat(
        index: (json['index'] as num?)?.toInt() ?? 0,
        uid: (json['uid'] ?? '').toString(),
        displayName: (json['displayName'] ?? '').toString(),
        profileImageUrl: (json['profileImageUrl'] ?? '').toString(),
        muted: json['muted'] != false,
        starBattleCoins: (json['starBattleCoins'] as num?)?.toInt() ?? 0,
      );
}

class RoomSeatState {
  const RoomSeatState({
    required this.roomId,
    required this.seats,
    required this.micInvites,
    required this.micRequests,
    required this.micInviteOnly,
    required this.starBattleActive,
    required this.isOwner,
    required this.isActive,
    required this.onlineCount,
  });

  final String roomId;
  final List<VoiceSeat> seats;
  final List<String> micInvites;
  final List<String> micRequests;
  final bool micInviteOnly;
  final bool starBattleActive;
  final bool isOwner;
  final bool isActive;
  final int onlineCount;

  bool invited(String uid) => micInvites.contains(uid);
  bool requested(String uid) => micRequests.contains(uid);

  factory RoomSeatState.fromJson(Map<String, dynamic> json) {
    final rawSeats = json['seats'];
    final rawInvites = json['micInvites'];
    final rawRequests = json['micRequests'];
    return RoomSeatState(
      roomId: (json['roomId'] ?? '').toString(),
      seats: rawSeats is List
          ? rawSeats
              .whereType<Map>()
              .map(
                (item) => VoiceSeat.fromJson(
                  Map<String, dynamic>.from(item),
                ),
              )
              .toList()
          : const [],
      micInvites: rawInvites is List
          ? rawInvites.map((item) => item.toString()).toList()
          : const [],
      micRequests: rawRequests is List
          ? rawRequests.map((item) => item.toString()).toList()
          : const [],
      micInviteOnly: json['micInviteOnly'] == true,
      starBattleActive: json['starBattleActive'] == true,
      isOwner: json['isOwner'] == true,
      isActive: json['isActive'] != false,
      onlineCount: (json['onlineCount'] as num?)?.toInt() ?? 0,
    );
  }
}

class RoomSeatService {
  RoomSeatService({
    http.Client? client,
    FirebaseAuth? auth,
    FirebaseFirestore? firestore,
    String? baseUrl,
  })  : _client = client ?? http.Client(),
        _auth = auth ?? FirebaseAuth.instance,
        _firestore = firestore ?? FirebaseFirestore.instance,
        _baseUrl = baseUrl ??
            const String.fromEnvironment(
              'SHADOW_API_BASE_URL',
              defaultValue: 'https://shadow-live-six.vercel.app/api',
            );

  final http.Client _client;
  final FirebaseAuth _auth;
  final FirebaseFirestore _firestore;
  final String _baseUrl;

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
      throw StateError((decoded['code'] ?? 'room_seat_failed').toString());
    }
    return decoded;
  }

  Stream<RoomSeatState> watch(String roomId) {
    final uid = _auth.currentUser?.uid ?? '';
    return _firestore.collection('rooms').doc(roomId).snapshots().map((snapshot) {
      final data = snapshot.data() ?? <String, dynamic>{};
      final rawBattle = data['starBattleState'];
      final battle = rawBattle is Map
          ? Map<String, dynamic>.from(rawBattle)
          : const <String, dynamic>{};
      final rawScores = battle['scores'];
      final scores = rawScores is Map
          ? Map<String, dynamic>.from(rawScores)
          : const <String, dynamic>{};
      final rawSeats = data['seats'];
      final seats = rawSeats is List
          ? rawSeats.whereType<Map>().map((raw) {
              final item = Map<String, dynamic>.from(raw);
              final uid = (item['uid'] ?? '').toString();
              final scoreRaw = scores[uid];
              final score = scoreRaw is Map
                  ? Map<String, dynamic>.from(scoreRaw)
                  : const <String, dynamic>{};
              return {
                ...item,
                'starBattleCoins': battle['status'] == 'active'
                    ? ((score['coins'] as num?)?.toInt() ?? 0)
                    : 0,
              };
            }).toList(growable: false)
          : const <Map<String, dynamic>>[];
      final ownerUid =
          (data['ownerUid'] ?? data['ownerId'] ?? data['hostId'] ?? '').toString();
      return RoomSeatState.fromJson({
        ...data,
        'seats': seats,
        'roomId': roomId,
        'starBattleActive': battle['status'] == 'active',
        'isOwner': uid.isNotEmpty && ownerUid == uid,
        'isActive': snapshot.exists && data['isActive'] != false,
      });
    });
  }

  Future<RoomSeatState> load(String roomId) async {
    final body = await _post({
      'action': 'roomSeatState',
      'roomId': roomId,
    });
    return RoomSeatState.fromJson(body);
  }

  Future<RoomSeatState> _action({
    required String roomId,
    required String seatAction,
    int? seatIndex,
    String? targetUid,
    bool? enabled,
  }) async {
    final body = await _post({
      'action': 'roomSeatAction',
      'roomId': roomId,
      'seatAction': seatAction,
      if (seatIndex != null) 'seatIndex': seatIndex,
      if (targetUid != null && targetUid.isNotEmpty) 'targetUid': targetUid,
      if (enabled != null) 'enabled': enabled,
    });
    return RoomSeatState.fromJson(body);
  }

  Future<RoomSeatState> requestMic(String roomId) =>
      _action(roomId: roomId, seatAction: 'requestMic');

  Future<RoomSeatState> cancelMicRequest(String roomId) =>
      _action(roomId: roomId, seatAction: 'cancelMicRequest');

  Future<RoomSeatState> inviteToMic({
    required String roomId,
    required String targetUid,
  }) =>
      _action(
        roomId: roomId,
        seatAction: 'inviteToMic',
        targetUid: targetUid,
      );

  Future<RoomSeatState> declineMicInvite(String roomId) =>
      _action(roomId: roomId, seatAction: 'declineMicInvite');

  Future<RoomSeatState> setMicInviteOnly({
    required String roomId,
    required bool enabled,
  }) =>
      _action(
        roomId: roomId,
        seatAction: 'setMicInviteOnly',
        enabled: enabled,
      );

  Future<RoomSeatState> approveMicRequest({
    required String roomId,
    required String targetUid,
  }) =>
      _action(
        roomId: roomId,
        seatAction: 'approveMicRequest',
        targetUid: targetUid,
      );

  Future<RoomSeatState> rejectMicRequest({
    required String roomId,
    required String targetUid,
  }) =>
      _action(
        roomId: roomId,
        seatAction: 'rejectMicRequest',
        targetUid: targetUid,
      );

  Future<RoomSeatState> takeSeat({
    required String roomId,
    required int seatIndex,
  }) =>
      _action(
        roomId: roomId,
        seatAction: 'takeSeat',
        seatIndex: seatIndex,
      );

  Future<RoomSeatState> switchSeat({
    required String roomId,
    required int seatIndex,
  }) =>
      _action(
        roomId: roomId,
        seatAction: 'switchSeat',
        seatIndex: seatIndex,
      );

  Future<RoomSeatState> setSeatMuted({
    required String roomId,
    required bool muted,
  }) =>
      _action(
        roomId: roomId,
        seatAction: muted ? 'muteSeat' : 'unmuteSeat',
      );

  Future<RoomSeatState> leaveSeat(String roomId) =>
      _action(roomId: roomId, seatAction: 'leaveSeat');

  Future<RoomSeatState> setTargetSeatMuted({
    required String roomId,
    required String targetUid,
    required bool muted,
  }) =>
      _action(
        roomId: roomId,
        seatAction: muted ? 'muteTargetSeat' : 'unmuteTargetSeat',
        targetUid: targetUid,
      );

  Future<RoomSeatState> removeFromMic({
    required String roomId,
    required String targetUid,
  }) =>
      _action(
        roomId: roomId,
        seatAction: 'removeFromMic',
        targetUid: targetUid,
      );

  void close() => _client.close();
}
