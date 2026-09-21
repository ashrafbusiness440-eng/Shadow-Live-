import 'package:cloud_firestore/cloud_firestore.dart';
import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

class FollowCounts {
  final int followers;
  final int following;
  const FollowCounts({required this.followers, required this.following});
}

class FollowService {
  FollowService({FirebaseFirestore? firestore, FirebaseAuth? auth})
      : _firestore = firestore ?? FirebaseFirestore.instance,
        _auth = auth ?? FirebaseAuth.instance;

  final FirebaseFirestore _firestore;
  final FirebaseAuth _auth;

  static String relationId(String followerUid, String followingUid) =>
      '${followerUid}__${followingUid}';

  CollectionReference<Map<String, dynamic>> get _follows =>
      _firestore.collection('follows');

  Stream<bool> isFollowing(String targetUid) {
    final me = _auth.currentUser?.uid;
    if (me == null || me.isEmpty || me == targetUid) {
      return Stream<bool>.value(false);
    }
    return _follows.doc(relationId(me, targetUid)).snapshots().map((doc) => doc.exists);
  }

  Future<void> setFollowing(String targetUid, bool value) async {
    final me = _auth.currentUser?.uid;
    if (me == null || me.isEmpty) throw StateError('not_signed_in');
    if (me == targetUid) throw StateError('cannot_follow_self');
    final token = await _auth.currentUser?.getIdToken();
    if (token == null || token.isEmpty) throw StateError('not_signed_in');
    final response = await http.post(
      Uri.parse(
        'https://shadow-live-git-feature-shadow-control-foundation-shadow-c916.vercel.app/api/chat-actions',
      ),
      headers: {
        'authorization': 'Bearer ' + token,
        'content-type': 'application/json',
      },
      body: jsonEncode({
        'action': 'setFollow',
        'targetUserId': targetUid,
        'following': value,
      }),
    );
    Map<String, dynamic> body = <String, dynamic>{};
    try {
      final decoded = jsonDecode(response.body);
      if (decoded is Map<String, dynamic>) body = decoded;
    } catch (_) {}
    if (response.statusCode != 200 || body['ok'] != true) {
      throw StateError((body['code'] ?? 'follow_failed').toString());
    }
  }

  Future<FollowCounts> counts(String userId) async {
    final results = await Future.wait([
      _follows.where('followingUid', isEqualTo: userId).count().get(),
      _follows.where('followerUid', isEqualTo: userId).count().get(),
    ]);
    return FollowCounts(
      followers: results[0].count ?? 0,
      following: results[1].count ?? 0,
    );
  }

  Future<bool> isMutual(String otherUid) async {
    final me = _auth.currentUser?.uid;
    if (me == null || me.isEmpty || me == otherUid) return false;
    final docs = await Future.wait([
      _follows.doc(relationId(me, otherUid)).get(),
      _follows.doc(relationId(otherUid, me)).get(),
    ]);
    return docs[0].exists && docs[1].exists;
  }
}
