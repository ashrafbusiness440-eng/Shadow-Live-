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
  FollowService({
    FirebaseFirestore? firestore,
    FirebaseAuth? auth,
    String? baseUrl,
  })  : _firestore = firestore ?? FirebaseFirestore.instance,
        _auth = auth ?? FirebaseAuth.instance,
        _baseUrl = baseUrl ??
            const String.fromEnvironment(
              'SHADOW_CLOUDFLARE_API_BASE_URL',
              defaultValue: 'https://shadow-live.ashraf-business-440.workers.dev/api',
            );

  final FirebaseFirestore _firestore;
  final FirebaseAuth _auth;
  final String _baseUrl;

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

  /// One bounded snapshot for the Home suggestions. The existing follow
  /// document ids are reused; never create a listener per visible person.
  /// Returns only server-confirmed relations, or throws on read failure so the
  /// caller can avoid claiming that an unknown relation is "not following".
  Future<Set<String>> followingAmong(Iterable<String> targetUids) async {
    final current = _auth.currentUser;
    if (current == null || current.isAnonymous) return <String>{};
    final me = current.uid;
    final targets = targetUids
        .map((uid) => uid.trim())
        .where((uid) => uid.isNotEmpty && uid != me)
        .toSet()
        .take(10)
        .toList(growable: false);
    if (targets.isEmpty) return <String>{};

    final byRelationId = {
      for (final uid in targets) relationId(me, uid): uid,
    };
    final snapshot = await _follows
        .where(FieldPath.documentId, whereIn: byRelationId.keys.toList())
        .get();
    return <String>{
      for (final doc in snapshot.docs)
        if (byRelationId.containsKey(doc.id)) byRelationId[doc.id]!,
    };
  }

  Future<void> setFollowing(String targetUid, bool value) async {
    final me = _auth.currentUser?.uid;
    if (me == null || me.isEmpty) throw StateError('not_signed_in');
    if (me == targetUid) throw StateError('cannot_follow_self');
    final token = await _auth.currentUser?.getIdToken();
    if (token == null || token.isEmpty) throw StateError('not_signed_in');
    final response = await http.post(
      Uri.parse('$_baseUrl/chat-actions'),
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
