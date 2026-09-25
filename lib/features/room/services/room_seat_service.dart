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
    this.frameRewardId = '',
    this.frameAssetKey = '',
    this.frameImageUrl = '',
    this.frameExpiresAtMs = 0,
    this.voiceWaveRewardId = '',
    this.voiceWaveAssetKey = '',
    this.voiceWaveImageUrl = '',
    this.voiceWaveExpiresAtMs = 0,
  });

  final int index;
  final String uid;
  final String displayName;
  final String profileImageUrl;
  final bool muted;
  final int starBattleCoins;
  final String frameRewardId;
  final String frameAssetKey;
  final String frameImageUrl;
  final int frameExpiresAtMs;
  final String voiceWaveRewardId;
  final String voiceWaveAssetKey;
  final String voiceWaveImageUrl;
  final int voiceWaveExpiresAtMs;

  bool get occupied => uid.isNotEmpty;
  bool get frameActive =>
      occupied && frameExpiresAtMs > DateTime.now().millisecondsSinceEpoch;
  bool get voiceWaveActive =>
      occupied &&
      !muted &&
      voiceWaveExpiresAtMs > DateTime.now().millisecondsSinceEpoch;

  factory VoiceSeat.fromJson(Map<String, dynamic> json) => VoiceSeat(
        index: (json['index'] as num?)?.toInt() ?? 0,
        uid: (json['uid'] ?? '').toString(),
        displayName: (json['displayName'] ?? '').toString(),
        profileImageUrl: (json['profileImageUrl'] ?? '').toString(),
        muted: json['muted'] != false,
        starBattleCoins: (json['starBattleCoins'] as num?)?.toInt() ?? 0,
        frameRewardId: (json['frameRewardId'] ?? '').toString(),
        frameAssetKey: (json['frameAssetKey'] ?? '').toString(),
        frameImageUrl: (json['frameImageUrl'] ?? '').toString(),
        frameExpiresAtMs: (json['frameExpiresAtMs'] as num?)?.toInt() ?? 0,
        voiceWaveRewardId: (json['voiceWaveRewardId'] ?? '').toString(),
        voiceWaveAssetKey: (json['voiceWaveAssetKey'] ?? '').toString(),
        voiceWaveImageUrl: (json['voiceWaveImageUrl'] ?? '').toString(),
        voiceWaveExpiresAtMs:
            (json['voiceWaveExpiresAtMs'] as num?)?.toInt() ?? 0,
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
    this.isHost = false,
    this.canManageMic = false,
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
  final bool isHost;
  final bool canManageMic;
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
      isHost: json['isHost'] == true,
      canManageMic: json['canManageMic'] == true,
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
              'SHADOW_CLOUDFLARE_API_BASE_URL',
              defaultValue: 'https://shadow-live.ashraf-business-440.workers.dev/api',
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

  RoomSeatState fromRoomData(
    String roomId,
    Map<String, dynamic> data, {
    int? onlineCountOverride,
    bool exists = true,
  }) {
    final uid = _auth.currentUser?.uid ?? '';
    final rawBattle = data['starBattleState'];
    final battle = rawBattle is Map
        ? Map<String, dynamic>.from(rawBattle)
        : const <String, dynamic>{};
    final rawScores = battle['scores'];
    final scores = rawScores is Map
        ? Map<String, dynamic>.from(rawScores)
        : const <String, dynamic>{};
    final roomType =
        (data['roomType'] ?? data['type'] ?? 'personal').toString();
    final official = data['systemOwned'] == true ||
        data['officialRoom'] == true ||
        roomType == 'official' ||
        roomType == 'administrative' ||
        roomType == 'customer_service';

    final level = ((data['level'] as num?)?.toInt() ?? 1).clamp(1, 6);
    final rawOverrides = data['controlOverrides'];
    final overrides = rawOverrides is Map
        ? Map<String, dynamic>.from(rawOverrides)
        : const <String, dynamic>{};
    final overrideSeats = (overrides['seats'] as num?)?.toInt();
    final validOverrideSeats =
        overrideSeats != null && overrideSeats >= 1 && overrideSeats <= 50
            ? overrideSeats
            : null;
    final bypassLevelCapacity = overrides['bypassLevelCapacity'] == true;
    final baseCapacity = roomType == 'customer_service'
        ? 5
        : roomType == 'agency'
            ? const [10, 12, 14, 16, 20, 22][level - 1]
            : const [8, 10, 12, 15, 20, 20][level - 1];
    final capacity =
        (official || bypassLevelCapacity) && validOverrideSeats != null
            ? validOverrideSeats
            : baseCapacity;

    final rawSeats = data['seats'];
    final seatsByIndex = <int, Map<String, dynamic>>{};
    if (rawSeats is List) {
      for (final raw in rawSeats.whereType<Map>()) {
        final item = Map<String, dynamic>.from(raw);
        final index = (item['index'] as num?)?.toInt();
        if (index == null || index < 0 || index >= capacity) continue;
        seatsByIndex[index] = item;
      }
    }
    final seats = List<Map<String, dynamic>>.generate(capacity, (index) {
      final item = seatsByIndex[index] ??
          <String, dynamic>{
            'index': index,
            'uid': '',
            'displayName': '',
            'profileImageUrl': '',
            'muted': true,
          };
      final seatUid = (item['uid'] ?? '').toString();
      final scoreRaw = scores[seatUid];
      final score = scoreRaw is Map
          ? Map<String, dynamic>.from(scoreRaw)
          : const <String, dynamic>{};
      return {
        ...item,
        'index': index,
        'starBattleCoins': battle['status'] == 'active'
            ? ((score['coins'] as num?)?.toInt() ?? 0)
            : 0,
      };
    }, growable: false);

    final ownerUid = (data['ownerUid'] ?? data['ownerId'] ?? '').toString();
    final hostUid = (data['hostUid'] ?? data['hostId'] ?? '').toString();
    final moderators =
        data['moderators'] is List ? data['moderators'] as List : const [];
    final moderatorCanManageMic = moderators.whereType<Map>().any((raw) {
      final item = Map<String, dynamic>.from(raw);
      final moderatorUid = (item['uid'] ?? '').toString();
      final capabilities = item['capabilities'] is List
          ? (item['capabilities'] as List).map((e) => e.toString())
          : const <String>[];
      return moderatorUid == uid && capabilities.contains('manageMic');
    });
    final isOwner = uid.isNotEmpty && !official && ownerUid == uid;
    final isHost = uid.isNotEmpty && official && hostUid == uid;

    return RoomSeatState.fromJson({
      ...data,
      'seats': seats,
      'roomId': roomId,
      'starBattleActive': battle['status'] == 'active',
      'isOwner': isOwner,
      'isHost': isHost,
      'canManageMic': isOwner || isHost || moderatorCanManageMic,
      'isActive': exists && data['isActive'] != false,
      if (onlineCountOverride != null)
        'onlineCount': onlineCountOverride,
    });
  }

  Stream<RoomSeatState> watch(String roomId) {
    return _firestore.collection('rooms').doc(roomId).snapshots().map(
      (snapshot) => fromRoomData(
        roomId,
        snapshot.data() ?? <String, dynamic>{},
        exists: snapshot.exists,
      ),
    );
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

  Future<void> announceEntrance(String roomId) async {
    await _post({
      'action': 'announceEntrance',
      'roomId': roomId,
    });
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
