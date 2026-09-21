import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

class VoiceSeat {
  const VoiceSeat({
    required this.index,
    required this.uid,
    required this.displayName,
    required this.profileImageUrl,
    required this.muted,
  });

  final int index;
  final String uid;
  final String displayName;
  final String profileImageUrl;
  final bool muted;

  bool get occupied => uid.isNotEmpty;

  factory VoiceSeat.fromJson(Map<String, dynamic> json) => VoiceSeat(
        index: (json['index'] as num?)?.toInt() ?? 0,
        uid: (json['uid'] ?? '').toString(),
        displayName: (json['displayName'] ?? '').toString(),
        profileImageUrl: (json['profileImageUrl'] ?? '').toString(),
        muted: json['muted'] != false,
      );
}

class RoomSeatState {
  const RoomSeatState({
    required this.roomId,
    required this.seats,
    required this.micInvites,
    required this.micRequests,
    required this.isOwner,
  });

  final String roomId;
  final List<VoiceSeat> seats;
  final List<String> micInvites;
  final List<String> micRequests;
  final bool isOwner;

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
      isOwner: json['isOwner'] == true,
    );
  }
}

class RoomSeatService {
  RoomSeatService({
    http.Client? client,
    FirebaseAuth? auth,
    String? baseUrl,
  })  : _client = client ?? http.Client(),
        _auth = auth ?? FirebaseAuth.instance,
        _baseUrl = baseUrl ??
            const String.fromEnvironment(
              'SHADOW_API_BASE_URL',
              defaultValue: 'https://shadow-live-six.vercel.app/api',
            );

  final http.Client _client;
  final FirebaseAuth _auth;
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
  }) async {
    final body = await _post({
      'action': 'roomSeatAction',
      'roomId': roomId,
      'seatAction': seatAction,
      if (seatIndex != null) 'seatIndex': seatIndex,
      if (targetUid != null && targetUid.isNotEmpty) 'targetUid': targetUid,
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

  Future<RoomSeatState> leaveSeat(String roomId) =>
      _action(roomId: roomId, seatAction: 'leaveSeat');

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
