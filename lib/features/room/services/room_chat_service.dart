import 'dart:convert';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

class RoomChatMessage {
  const RoomChatMessage({
    required this.id,
    required this.type,
    required this.senderUid,
    required this.displayName,
    required this.profileImageUrl,
    required this.text,
    required this.mentionUids,
    required this.replyTo,
    required this.replyPreview,
    required this.replySenderUid,
    required this.createdAt,
    required this.systemKind,
    required this.vipLevel,
    required this.entryEffectKey,
  });

  final String id;
  final String type;
  final String senderUid;
  final String displayName;
  final String profileImageUrl;
  final String text;
  final List<String> mentionUids;
  final String? replyTo;
  final String? replyPreview;
  final String? replySenderUid;
  final DateTime? createdAt;
  final String systemKind;
  final int vipLevel;
  final String entryEffectKey;

  factory RoomChatMessage.fromDoc(
    QueryDocumentSnapshot<Map<String, dynamic>> doc,
  ) {
    final data = doc.data();
    final timestamp = data['createdAt'];
    return RoomChatMessage(
      id: doc.id,
      type: (data['type'] ?? 'text').toString(),
      senderUid: (data['senderUid'] ?? '').toString(),
      displayName:
          (data['displayName'] ?? 'مستخدم Shadow Live').toString(),
      profileImageUrl: (data['profileImageUrl'] ?? '').toString(),
      text: (data['text'] ?? data['systemText'] ?? '').toString(),
      mentionUids: data['mentionUids'] is List
          ? (data['mentionUids'] as List)
              .map((value) => value.toString())
              .toList(growable: false)
          : const [],
      replyTo: data['replyTo']?.toString(),
      replyPreview: data['replyPreview']?.toString(),
      replySenderUid: data['replySenderUid']?.toString(),
      createdAt: timestamp is Timestamp ? timestamp.toDate() : null,
      systemKind: (data['systemKind'] ?? '').toString(),
      vipLevel: (data['vipLevel'] as num?)?.toInt() ?? 0,
      entryEffectKey: (data['entryEffectKey'] ?? '').toString(),
    );
  }
}

class RoomChatService {
  RoomChatService({
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

  Stream<List<RoomChatMessage>> watchMessages(String roomId) {
    return _firestore
        .collection('rooms')
        .doc(roomId)
        .collection('messages')
        .orderBy('createdAt', descending: true)
        .limit(60)
        .snapshots()
        .map(
          (snapshot) =>
              snapshot.docs.map(RoomChatMessage.fromDoc).toList(growable: false),
        );
  }

  Future<void> sendMessage({
    required String roomId,
    required String text,
    String? replyTo,
    List<String> mentionUids = const [],
  }) async {
    final user = _auth.currentUser;
    final token = await user?.getIdToken();
    if (user == null || token == null || token.isEmpty) {
      throw StateError('not_signed_in');
    }

    final response = await _client.post(
      Uri.parse('$_baseUrl/voice-session'),
      headers: {
        'authorization': 'Bearer ' + token,
        'content-type': 'application/json',
      },
      body: jsonEncode({
        'action': 'sendRoomChat',
        'roomId': roomId,
        'text': text,
        if (replyTo != null && replyTo.isNotEmpty) 'replyTo': replyTo,
        if (mentionUids.isNotEmpty) 'mentionUids': mentionUids,
      }),
    );

    Map<String, dynamic> body = <String, dynamic>{};
    try {
      final decoded = jsonDecode(response.body);
      if (decoded is Map<String, dynamic>) body = decoded;
    } catch (_) {}

    if (response.statusCode != 200 || body['ok'] != true) {
      throw StateError((body['code'] ?? 'room_chat_failed').toString());
    }
  }

  void close() => _client.close();
}
