import 'dart:convert';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

class RoomModerator {
  const RoomModerator({
    required this.uid,
    required this.displayName,
    required this.profileImageUrl,
    this.profileAvatarAsset = '',
    this.activeProfileFrameAssetKey = '',
    this.activeProfileFrameImageUrl = '',
    this.activeProfileFrameExpiresAtMs = 0,
    this.activeProfileFramePermanent = false,
    required this.capabilities,
  });

  final String uid;
  final String displayName;
  final String profileImageUrl;
  final String profileAvatarAsset;
  final String activeProfileFrameAssetKey;
  final String activeProfileFrameImageUrl;
  final int activeProfileFrameExpiresAtMs;
  final bool activeProfileFramePermanent;
  final Set<String> capabilities;

  factory RoomModerator.fromMap(Map<String, dynamic> data) {
    final caps = data['capabilities'];
    return RoomModerator(
      uid: (data['uid'] ?? '').toString(),
      displayName:
          (data['displayName'] ?? 'مستخدم Shadow Live').toString(),
      profileImageUrl: (data['profileImageUrl'] ?? '').toString(),
      profileAvatarAsset:
          (data['profileAvatarAsset'] ?? '').toString(),
      activeProfileFrameAssetKey:
          (data['activeProfileFrameAssetKey'] ?? '').toString(),
      activeProfileFrameImageUrl:
          (data['activeProfileFrameImageUrl'] ?? '').toString(),
      activeProfileFrameExpiresAtMs:
          (data['activeProfileFrameExpiresAtMs'] as num?)?.toInt() ?? 0,
      activeProfileFramePermanent:
          data['activeProfileFramePermanent'] == true,
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
    this.platformOwner = false,
    this.ownerAbsoluteRoomAccess = false,
    this.globalRoomManage = false,
  });

  final String roomId;
  final bool isOwner;
  final int limit;
  final Set<String> myCapabilities;
  final List<RoomModerator> moderators;
  final bool platformOwner;
  final bool ownerAbsoluteRoomAccess;
  final bool globalRoomManage;

  bool has(String capability) =>
      isOwner || globalRoomManage || myCapabilities.contains(capability);

  RoomModeratorState copyWithPlatformAccess({
    required bool platformOwner,
    required bool ownerAbsoluteRoomAccess,
    required bool globalRoomManage,
  }) {
    return RoomModeratorState(
      roomId: roomId,
      isOwner: isOwner,
      limit: limit,
      myCapabilities: myCapabilities,
      moderators: moderators,
      platformOwner: platformOwner,
      ownerAbsoluteRoomAccess: ownerAbsoluteRoomAccess,
      globalRoomManage: globalRoomManage,
    );
  }
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

  RoomModeratorState fromRoomData(
    String roomId,
    Map<String, dynamic> room,
  ) {
    final uid = _auth.currentUser?.uid ?? '';
    final ownerUid =
        (room['ownerUid'] ?? room['ownerId'] ?? room['hostId'] ?? '')
            .toString();
    final roomType =
        (room['roomType'] ?? room['type'] ?? 'personal').toString();
    final official = room['systemOwned'] == true ||
        room['officialRoom'] == true ||
        roomType == 'official' ||
        roomType == 'administrative' ||
        roomType == 'customer_service';
    final hostUid = (room['hostUid'] ?? room['hostId'] ?? '').toString();
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
    if (official && uid.isNotEmpty && uid == hostUid) {
      mine.addAll(const {
        'manageMic',
        'moderateUsers',
        'moderateChat',
        'manageMusic',
        'manageMusicPolicy',
        'managePk',
      });
    }

    return RoomModeratorState(
      roomId: roomId,
      isOwner: uid.isNotEmpty && !official && uid == ownerUid,
      limit: _limit(room),
      myCapabilities: mine,
      moderators: moderators,
    );
  }

  Future<RoomModeratorState> _hydrateModeratorProfiles(
    RoomModeratorState state,
  ) async {
    if (state.moderators.isEmpty) return state;

    final ids = state.moderators
        .map((item) => item.uid.trim())
        .where((uid) => uid.isNotEmpty)
        .toSet()
        .toList(growable: false);
    final profiles = <String, Map<String, dynamic>>{};

    for (var offset = 0; offset < ids.length; offset += 10) {
      final batch = ids.skip(offset).take(10).toList(growable: false);
      if (batch.isEmpty) continue;
      final snapshot = await _firestore
          .collection('public_profiles')
          .where(FieldPath.documentId, whereIn: batch)
          .get();
      for (final doc in snapshot.docs) {
        profiles[doc.id] = doc.data();
      }
    }

    final moderators = state.moderators.map((item) {
      final profile = profiles[item.uid];
      if (profile == null) return item;
      return RoomModerator(
        uid: item.uid,
        displayName:
            (profile['displayName'] ?? item.displayName).toString(),
        profileImageUrl:
            (profile['profileImageUrl'] ?? item.profileImageUrl).toString(),
        profileAvatarAsset:
            (profile['profileAvatarAsset'] ?? '').toString(),
        activeProfileFrameAssetKey:
            (profile['activeProfileFrameAssetKey'] ?? '').toString(),
        activeProfileFrameImageUrl:
            (profile['activeProfileFrameImageUrl'] ?? '').toString(),
        activeProfileFrameExpiresAtMs:
            (profile['activeProfileFrameExpiresAtMs'] as num?)?.toInt() ?? 0,
        activeProfileFramePermanent:
            profile['activeProfileFramePermanent'] == true,
        capabilities: item.capabilities,
      );
    }).toList(growable: false);

    return RoomModeratorState(
      roomId: state.roomId,
      isOwner: state.isOwner,
      limit: state.limit,
      myCapabilities: state.myCapabilities,
      moderators: moderators,
      platformOwner: state.platformOwner,
      ownerAbsoluteRoomAccess: state.ownerAbsoluteRoomAccess,
      globalRoomManage: state.globalRoomManage,
    );
  }

  Stream<RoomModeratorState> watch(String roomId) {
    return _firestore
        .collection('rooms')
        .doc(roomId)
        .snapshots()
        .asyncMap((snap) async {
      final state = fromRoomData(
        roomId,
        snap.data() ?? <String, dynamic>{},
      );
      try {
        return await _hydrateModeratorProfiles(state);
      } catch (_) {
        return state;
      }
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
