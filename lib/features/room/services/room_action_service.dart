import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

import 'room_image_source.dart';

class RoomGhostState {
  const RoomGhostState({
    required this.ghostMode,
    required this.canUseGhostMode,
    required this.requiredVipLevel,
  });

  final bool ghostMode;
  final bool canUseGhostMode;
  final int requiredVipLevel;
}

class RoomHiddenEntryState {
  const RoomHiddenEntryState({
    required this.hiddenRoomEntry,
    required this.canUseHiddenRoomEntry,
    required this.requiredVipLevel,
  });

  final bool hiddenRoomEntry;
  final bool canUseHiddenRoomEntry;
  final int requiredVipLevel;
}

class PersonalRoomInfo {
  const PersonalRoomInfo({
    required this.roomId,
    required this.name,
    required this.publicId,
    required this.ownerUid,
    this.hostUid = '',
    required this.roomType,
    required this.agencyId,
    required this.category,
    required this.ownerName,
    required this.ownerLocation,
    required this.chatEnabled,
    required this.coverImageUrl,
    required this.coverImageObjectId,
    required this.description,
    required this.tags,
    required this.visibility,
    required this.passwordProtected,
    required this.isActive,
    this.level = 1,
  });

  final String roomId;
  final String name;
  final String publicId;
  final String ownerUid;
  final String hostUid;
  final String roomType;
  final String agencyId;
  final String category;
  final String ownerName;
  final String ownerLocation;
  final bool chatEnabled;
  final String coverImageUrl;
  final String coverImageObjectId;
  final String description;
  final List<String> tags;
  final String visibility;
  final bool passwordProtected;
  final bool isActive;
  final int level;

  Map<String, dynamic> toNavigationArguments() => {
        'roomId': roomId,
        'name': name,
        'publicId': publicId,
        'ownerUid': ownerUid,
        'hostId': hostUid.isNotEmpty ? hostUid : ownerUid,
        'roomType': roomType,
        'type': roomType,
        if (agencyId.isNotEmpty) 'agencyId': agencyId,
        'category': category,
        'ownerName': ownerName,
        'ownerLocation': ownerLocation,
        'chatEnabled': chatEnabled,
        'coverImageUrl': coverImageUrl,
        'coverImageObjectId': coverImageObjectId,
        'description': description,
        'tags': tags,
        'visibility': visibility,
        'passwordProtected': passwordProtected,
        'isActive': isActive,
        'level': level,
      };

  factory PersonalRoomInfo.fromJson(
    Map<String, dynamic> json, {bool allowNoOwner = false}
  ) {
    final roomId = (json['roomId'] ?? '').toString().trim();
    final ownerUid = (json['ownerUid'] ?? '').toString().trim();
    if (roomId.isEmpty || (!allowNoOwner && ownerUid.isEmpty)) {
      throw const FormatException('invalid_personal_room');
    }
    return PersonalRoomInfo(
      roomId: roomId,
      name: (json['name'] ?? 'غرفتي').toString(),
      publicId: (json['publicId'] ?? '').toString(),
      ownerUid: ownerUid,
      hostUid: (json['hostUid'] ?? json['hostId'] ?? '').toString(),
      roomType: (json['roomType'] ?? json['type'] ?? 'personal').toString(),
      agencyId: (json['agencyId'] ?? '').toString(),
      category: (json['category'] ?? 'دردشة').toString(),
      ownerName: (json['ownerName'] ?? '').toString(),
      ownerLocation: (json['ownerLocation'] ?? '').toString(),
      chatEnabled: json['chatEnabled'] != false,
      // Respect the room's own live image (and the independent agency
      // room image) before a historical cover. No profile-avatar fallback.
      coverImageUrl: roomSurfaceImageUrl(json).isNotEmpty
          ? roomSurfaceImageUrl(json)
          : (json['coverImageUrl'] ?? json['imageUrl'] ?? '').toString(),
      coverImageObjectId: (json['coverImageObjectId'] ?? '').toString(),
      description: (json['description'] ?? '').toString(),
      tags: json['tags'] is List
          ? (json['tags'] as List).map((value) => value.toString()).toList()
          : const [],
      visibility: (json['visibility'] ?? 'public').toString(),
      passwordProtected: json['passwordProtected'] == true ||
          (json['visibility'] ?? '').toString() == 'password',
      isActive: json['isActive'] != false,
      level: ((json['level'] as num?)?.toInt() ?? 1).clamp(1, 100).toInt(),
    );
  }
}

class ManagedRoomEntry {
  const ManagedRoomEntry({required this.room, required this.relation});

  final PersonalRoomInfo room;
  final String relation;

  bool get isOwner => relation == 'owner';
  bool get isModerator => relation == 'moderator';

  factory ManagedRoomEntry.fromJson(Map<String, dynamic> json) {
    final relation = (json['relation'] ?? '').toString();
    if (relation != 'owner' && relation != 'moderator') {
      throw const FormatException('invalid_room_relation');
    }
    return ManagedRoomEntry(
      room: PersonalRoomInfo.fromJson(json, allowNoOwner: true),
      relation: relation,
    );
  }
}

class RoomActionService {
  RoomActionService({
    http.Client? client,
    String? baseUrl,
  })  : _client = client ?? http.Client(),
        _baseUrl = baseUrl ??
            const String.fromEnvironment(
              'SHADOW_CLOUDFLARE_API_BASE_URL',
              defaultValue: 'https://shadow-live.ashraf-business-440.workers.dev/api',
            );

  final http.Client _client;
  final String _baseUrl;

  Future<String> _idToken() async {
    final token = await FirebaseAuth.instance.currentUser?.getIdToken();
    if (token == null || token.isEmpty) throw StateError('not_signed_in');
    return token;
  }

  Future<Map<String, dynamic>> _post(Map<String, dynamic> body) async {
    final token = await _idToken();
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
      throw StateError((decoded['code'] ?? 'room_action_failed').toString());
    }
    return decoded;
  }

  /// One authenticated call when the owned/moderated rooms surface opens.
  /// The server verifies the current moderator grant for every room.
  Future<List<ManagedRoomEntry>> loadManagedRooms() async {
    final body = await _post({'action': 'roomManagedList'});
    final raw = body['rooms'];
    if (raw is! List) throw const FormatException('invalid_managed_rooms');
    return raw.whereType<Map>().map((entry) =>
      ManagedRoomEntry.fromJson(Map<String, dynamic>.from(entry))
    ).take(30).toList(growable: false);
  }

  Future<PersonalRoomInfo> openPersonalRoom() async {
    final body = await _post({'action': 'personalRoom'});
    final room = body['room'];
    if (room is! Map) throw const FormatException('invalid_personal_room');
    return PersonalRoomInfo.fromJson(Map<String, dynamic>.from(room));
  }

  Future<PersonalRoomInfo> openAgencyOwnerRoom() async {
    final body = await _post({'action': 'agencyRoom'});
    final room = body['room'];
    if (room is! Map) throw const FormatException('invalid_agency_room');
    final parsed = PersonalRoomInfo.fromJson(Map<String, dynamic>.from(room));
    if (parsed.roomType != 'agency' || parsed.agencyId.isEmpty) {
      throw const FormatException('invalid_agency_room');
    }
    return parsed;
  }

  Future<void> recordRoomVisit(String roomId) async {
    await _post({
      'action': 'recordRoomVisit',
      'roomId': roomId,
    });
  }

  /// Uses the existing authenticated room favorite action on voice-session.
  /// The server verifies the room and owns the persistent favorite state.
  Future<bool> setRoomFavorite({
    required String roomId,
    required bool favorite,
  }) async {
    final body = await _post({
      'action': 'setRoomFavorite',
      'roomId': roomId,
      'favorite': favorite,
    });
    if (body['roomId'] != roomId || body['favorite'] is! bool) {
      throw const FormatException('invalid_room_favorite');
    }
    return body['favorite'] == true;
  }

  Future<({
    List<Map<String, dynamic>> favorites,
    List<Map<String, dynamic>> history,
  })> loadRoomLibrary() async {
    final body = await _post({'action': 'roomLibrary'});

    List<Map<String, dynamic>> parse(String key) {
      final value = body[key];
      if (value is! List) return const [];
      return value
          .whereType<Map>()
          .map((item) => Map<String, dynamic>.from(item))
          .toList(growable: false);
    }

    return (
      favorites: parse('favorites'),
      history: parse('history'),
    );
  }

  Future<String> changeRoomPublicId({
    required String roomId,
    required String publicId,
  }) async {
    final body = await _post({
      'action': 'changeRoomPublicId',
      'roomId': roomId,
      'publicId': publicId,
    });
    final value = (body['publicId'] ?? '').toString();
    if (value.isEmpty) throw const FormatException('invalid_public_id');
    return value;
  }

  Future<Map<String, dynamic>> updateRoomSettings({
    required String roomId,
    required String name,
    required String description,
    required String category,
    required List<String> tags,
    required String visibility,
    required bool chatEnabled,
    required String coverImageUrl,
    String? coverImageObjectId,
    String? password,
  }) async {
    final body = await _post({
      'action': 'updateRoomSettings',
      'roomId': roomId,
      'name': name,
      'description': description,
      'category': category,
      'tags': tags,
      'visibility': visibility,
      'chatEnabled': chatEnabled,
      'coverImageUrl': coverImageUrl,
      if (coverImageObjectId != null)
        'coverImageObjectId': coverImageObjectId,
      if (password != null && password.isNotEmpty) 'password': password,
    });
    final room = body['room'];
    if (room is! Map) throw const FormatException('invalid_room_settings');
    return Map<String, dynamic>.from(room);
  }

  Future<bool> setRoomChatEnabled({
    required String roomId,
    required bool enabled,
  }) async {
    final body = await _post({
      'action': 'setRoomChatEnabled',
      'roomId': roomId,
      'enabled': enabled,
    });
    return body['chatEnabled'] == true;
  }

  Future<RoomGhostState> loadGhostState() async {
    final body = await _post({'action': 'roomGhostState'});
    return RoomGhostState(
      ghostMode: body['ghostMode'] == true,
      canUseGhostMode: body['canUseGhostMode'] == true,
      requiredVipLevel: (body['requiredVipLevel'] as num?)?.toInt() ?? 5,
    );
  }

  Future<bool> loadGhostMode() async => (await loadGhostState()).ghostMode;

  Future<bool> setGhostMode(bool enabled) async {
    final body = await _post({
      'action': 'setRoomGhostMode',
      'enabled': enabled,
    });
    return body['ghostMode'] == true;
  }

  Future<RoomHiddenEntryState> loadHiddenEntryState() async {
    final body = await _post({'action': 'roomHiddenEntryState'});
    return RoomHiddenEntryState(
      hiddenRoomEntry: body['hiddenRoomEntry'] == true,
      canUseHiddenRoomEntry: body['canUseHiddenRoomEntry'] == true,
      requiredVipLevel: (body['requiredVipLevel'] as num?)?.toInt() ?? 7,
    );
  }

  Future<bool> setHiddenEntry(bool enabled) async {
    final body = await _post({
      'action': 'setRoomHiddenEntry',
      'enabled': enabled,
    });
    return body['hiddenRoomEntry'] == true;
  }

  Future<void> closePersonalRoom(String roomId) async {
    await _post({
      'action': 'closePersonalRoom',
      'roomId': roomId,
    });
  }

  /// Report the room itself (not an individual chat message).
  /// The backend checks the real DO session presence and room owner.
  Future<String> reportRoom({
    required String roomId,
    required String reason,
    String details = '',
  }) async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null || user.isAnonymous) throw StateError('not_signed_in');
    final token = await _idToken();
    final key = 'roomrep_${user.uid}_${DateTime.now().microsecondsSinceEpoch}';
    final response = await _client.post(
      Uri.parse('$_baseUrl/chat-actions'),
      headers: {
        'authorization': 'Bearer $token',
        'content-type': 'application/json',
      },
      body: jsonEncode({
        'action': 'reportRoom',
        'roomId': roomId,
        'reason': reason,
        'details': details,
        'idempotencyKey': key,
      }),
    );
    Map<String, dynamic> data = <String, dynamic>{};
    try {
      final value = jsonDecode(response.body);
      if (value is Map) data = Map<String, dynamic>.from(value);
    } catch (_) {}
    if (response.statusCode != 200 || data['ok'] != true) {
      throw StateError((data['code'] ?? 'room_report_failed').toString());
    }
    return (data['reportId'] ?? '').toString();
  }

  void close() => _client.close();
}
