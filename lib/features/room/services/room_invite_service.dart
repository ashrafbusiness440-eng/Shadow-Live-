import 'dart:convert';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

class RoomInviteFriend {
  const RoomInviteFriend({
    required this.uid,
    required this.name,
    required this.photoUrl,
    required this.online,
  });

  final String uid;
  final String name;
  final String photoUrl;
  final bool online;
}

class RoomInviteService {
  RoomInviteService({
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

  String get _uid {
    final value = _auth.currentUser?.uid;
    if (value == null || value.isEmpty) throw StateError('not_signed_in');
    return value;
  }

  static String conversationId(String a, String b) {
    final ids = [a, b]..sort();
    return ids.join('_');
  }

  Future<List<RoomInviteFriend>> loadFriends() async {
    final me = _uid;
    final results = await Future.wait([
      _firestore
          .collection('follows')
          .where('followerUid', isEqualTo: me)
          .limit(150)
          .get(),
      _firestore
          .collection('follows')
          .where('followingUid', isEqualTo: me)
          .limit(150)
          .get(),
    ]);

    final outgoing = results[0].docs
        .map((doc) => (doc.data()['followingUid'] ?? '').toString())
        .where((id) => id.isNotEmpty && id != me)
        .toSet();
    final incoming = results[1].docs
        .map((doc) => (doc.data()['followerUid'] ?? '').toString())
        .where((id) => id.isNotEmpty && id != me)
        .toSet();
    final ids = outgoing.intersection(incoming).take(100).toList();

    final friends = await Future.wait(
      ids.map((id) async {
        final profile =
            await _firestore.collection('public_profiles').doc(id).get();
        final data = profile.data() ?? <String, dynamic>{};
        return RoomInviteFriend(
          uid: id,
          name: (data['displayName'] ?? data['username'] ?? 'مستخدم Shadow Live')
              .toString(),
          photoUrl: (data['profileImageUrl'] ?? '').toString(),
          online: data['isOnline'] == true,
        );
      }),
    );

    friends.sort((a, b) {
      if (a.online != b.online) return a.online ? -1 : 1;
      return a.name.compareTo(b.name);
    });
    return friends;
  }

  Future<String> _ensureConversation(String otherUid) async {
    final me = _uid;
    final id = conversationId(me, otherUid);
    final ref = _firestore.collection('conversations').doc(id);

    var exists = false;
    try {
      exists = (await ref.get()).exists;
    } on FirebaseException catch (error) {
      if (error.code != 'permission-denied') rethrow;
    }

    if (!exists) {
      final participants = [me, otherUid]..sort();
      await ref.set({
        'participants': participants,
        'createdAt': FieldValue.serverTimestamp(),
        'updatedAt': FieldValue.serverTimestamp(),
        'unreadCounts': {me: 0, otherUid: 0},
      });
    }
    return id;
  }

  Future<void> sendInvite({
    required String friendUid,
    required String roomId,
  }) async {
    final me = _uid;
    final conversationId = await _ensureConversation(friendUid);
    final token = await _auth.currentUser?.getIdToken();
    if (token == null || token.isEmpty) throw StateError('not_signed_in');
    final key = [
      me,
      DateTime.now().microsecondsSinceEpoch.toString(),
      'room',
    ].join('_');

    final response = await _client.post(
      Uri.parse('$_baseUrl/chat-actions'),
      headers: {
        'authorization': 'Bearer ' + token,
        'content-type': 'application/json',
      },
      body: jsonEncode({
        'action': 'sendRoomInvite',
        'receiverId': friendUid,
        'conversationId': conversationId,
        'roomId': roomId,
        'idempotencyKey': key,
      }),
    );

    Map<String, dynamic> body = <String, dynamic>{};
    try {
      final decoded = jsonDecode(response.body);
      if (decoded is Map<String, dynamic>) body = decoded;
    } catch (_) {}

    if (response.statusCode != 200 || body['ok'] != true) {
      throw StateError((body['code'] ?? 'room_invite_failed').toString());
    }
  }

  void close() => _client.close();
}
