import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

class PersonalRoomInfo {
  const PersonalRoomInfo({
    required this.roomId,
    required this.name,
    required this.publicId,
    required this.ownerUid,
    required this.roomType,
    required this.category,
    required this.description,
    required this.tags,
    required this.visibility,
    required this.passwordProtected,
    required this.isActive,
  });

  final String roomId;
  final String name;
  final String publicId;
  final String ownerUid;
  final String roomType;
  final String category;
  final String description;
  final List<String> tags;
  final String visibility;
  final bool passwordProtected;
  final bool isActive;

  Map<String, dynamic> toNavigationArguments() => {
        'roomId': roomId,
        'name': name,
        'publicId': publicId,
        'ownerUid': ownerUid,
        'hostId': ownerUid,
        'roomType': roomType,
        'category': category,
        'description': description,
        'tags': tags,
        'visibility': visibility,
        'passwordProtected': passwordProtected,
        'isActive': isActive,
      };

  factory PersonalRoomInfo.fromJson(Map<String, dynamic> json) {
    final roomId = (json['roomId'] ?? '').toString().trim();
    final ownerUid = (json['ownerUid'] ?? '').toString().trim();
    if (roomId.isEmpty || ownerUid.isEmpty) {
      throw const FormatException('invalid_personal_room');
    }
    return PersonalRoomInfo(
      roomId: roomId,
      name: (json['name'] ?? 'غرفتي').toString(),
      publicId: (json['publicId'] ?? '').toString(),
      ownerUid: ownerUid,
      roomType: (json['roomType'] ?? 'personal').toString(),
      category: (json['category'] ?? 'دردشة').toString(),
      description: (json['description'] ?? '').toString(),
      tags: json['tags'] is List
          ? (json['tags'] as List).map((value) => value.toString()).toList()
          : const [],
      visibility: (json['visibility'] ?? 'public').toString(),
      passwordProtected: json['passwordProtected'] == true ||
          (json['visibility'] ?? '').toString() == 'password',
      isActive: json['isActive'] != false,
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
              'SHADOW_API_BASE_URL',
              defaultValue: 'https://shadow-live-six.vercel.app/api',
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

  Future<PersonalRoomInfo> openPersonalRoom() async {
    final body = await _post({'action': 'personalRoom'});
    final room = body['room'];
    if (room is! Map) throw const FormatException('invalid_personal_room');
    return PersonalRoomInfo.fromJson(Map<String, dynamic>.from(room));
  }

  Future<void> recordRoomVisit(String roomId) async {
    await _post({
      'action': 'recordRoomVisit',
      'roomId': roomId,
    });
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

  Future<Map<String, dynamic>> updateRoomSettings({
    required String roomId,
    required String name,
    required String description,
    required String category,
    required List<String> tags,
    required String visibility,
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
      if (password != null && password.isNotEmpty) 'password': password,
    });
    final room = body['room'];
    if (room is! Map) throw const FormatException('invalid_room_settings');
    return Map<String, dynamic>.from(room);
  }

  Future<void> closePersonalRoom(String roomId) async {
    await _post({
      'action': 'closePersonalRoom',
      'roomId': roomId,
    });
  }

  void close() => _client.close();
}
