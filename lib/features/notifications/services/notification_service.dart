import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';

class AppNotification {
  const AppNotification({
    required this.id,
    required this.title,
    required this.body,
    required this.type,
    required this.read,
    required this.createdAt,
    required this.requestId,
    required this.diaryId,
    required this.commentId,
    this.objectId,
    this.operationId,
    this.reviewStatus,
    required this.agencyId,
    required this.requestType,
    required this.applicantUid,
    required this.actionState,
    required this.finalStatus,
    required this.finalDecision,
    required this.resolvedBy,
    required this.resolvedByName,
    required this.resolvedAt,
  });

  final String id;
  final String title;
  final String body;
  final String type;
  final bool read;
  final DateTime? createdAt;
  final String? requestId;
  final String? diaryId;
  final String? commentId;
  final String? objectId;
  final String? operationId;
  final String? reviewStatus;
  final String? agencyId;
  final String? requestType;
  final String? applicantUid;
  final String? actionState;
  final String? finalStatus;
  final String? finalDecision;
  final String? resolvedBy;
  final String? resolvedByName;
  final DateTime? resolvedAt;

  bool get agencyReviewAction =>
      (type == 'agency_join_request' || type == 'agency_leave_request') &&
      (requestId?.isNotEmpty ?? false);

  bool get agencyReviewResolved =>
      (type == 'agency_join_request' || type == 'agency_leave_request') &&
      (actionState == 'resolved' ||
          finalStatus == 'accepted' ||
          finalStatus == 'rejected');

  bool get relationshipRequestAction =>
      type == 'relationship_request' &&
      (requestId?.isNotEmpty ?? false);

  bool get relationshipRequestResolved =>
      type == 'relationship_request' &&
      (actionState == 'resolved' ||
          finalStatus == 'accepted' ||
          finalStatus == 'rejected' ||
          finalStatus == 'cancelled');

  factory AppNotification.fromMap(String id, Map<String, dynamic> data) {
    final rawCreatedAt = data['createdAt'];
    DateTime? createdAt;
    if (rawCreatedAt is Timestamp) createdAt = rawCreatedAt.toDate();
    if (rawCreatedAt is DateTime) createdAt = rawCreatedAt;
    final rawResolvedAt = data['resolvedAt'];
    DateTime? resolvedAt;
    if (rawResolvedAt is Timestamp) resolvedAt = rawResolvedAt.toDate();
    if (rawResolvedAt is DateTime) resolvedAt = rawResolvedAt;
    return AppNotification(
      id: id,
      title: (data['title'] ?? 'إشعار من النظام').toString().trim(),
      body: (data['body'] ?? '').toString().trim(),
      type: (data['type'] ?? 'system').toString().trim(),
      read: data['read'] == true,
      createdAt: createdAt,
      requestId: _nullable(data['requestId']),
      diaryId: _nullable(data['diaryId']),
      commentId: _nullable(data['commentId']),
      objectId: _nullable(data['objectId']),
      operationId: _nullable(data['operationId']),
      reviewStatus: _nullable(data['reviewStatus']),
      agencyId: _nullable(data['agencyId']),
      requestType: _nullable(data['requestType']),
      applicantUid: _nullable(data['applicantUid'] ?? data['memberUid']),
      actionState: _nullable(data['actionState']),
      finalStatus: _nullable(data['finalStatus']),
      finalDecision: _nullable(data['finalDecision']),
      resolvedBy: _nullable(data['resolvedBy']),
      resolvedByName: _nullable(data['resolvedByName']),
      resolvedAt: resolvedAt,
    );
  }
}

class NotificationService {
  NotificationService({FirebaseAuth? auth, FirebaseFirestore? firestore})
      : _auth = auth ?? FirebaseAuth.instance,
        _firestore = firestore ?? FirebaseFirestore.instance;

  static const int pageLimit = 50;
  final FirebaseAuth _auth;
  final FirebaseFirestore _firestore;

  /// One bounded listener for the messages-tab unread indicator. Keep the
  /// query inside the notifications service and scoped to the signed-in user.
  Stream<bool> watchHasUnread(String userId) {
    if (userId.isEmpty) return Stream<bool>.value(false);
    return _firestore
        .collection('notifications')
        .where('userId', isEqualTo: userId)
        .where('read', isEqualTo: false)
        .limit(1)
        .snapshots()
        .map((snapshot) => snapshot.docs.isNotEmpty);
  }

  /// Server-ordered recent notifications first. Once those pages end, read
  /// the legacy documents which never received a createdAt field through a
  /// separately paginated document-ID query. Firestore orderBy(createdAt)
  /// excludes such documents, so replacing the old query without this phase
  /// would permanently hide historical notifications.
  /// Both phases fetch at most 50 documents per explicit page request.
  Future<NotificationPage> load({NotificationPage? after}) async {
    final uid = _auth.currentUser?.uid;
    if (uid == null) throw StateError('auth_required');

    if (after?.legacyPhase == true) {
      Query<Map<String, dynamic>> legacyQuery = _firestore
          .collection('notifications')
          .where('userId', isEqualTo: uid)
          .orderBy(FieldPath.documentId)
          .limit(pageLimit);
      if (after?.legacyCursor != null) {
        legacyQuery = legacyQuery.startAfterDocument(after!.legacyCursor!);
      }
      final snapshot = await legacyQuery.get();
      if (_auth.currentUser?.uid != uid) throw StateError('account_changed');
      final oldItems = snapshot.docs
          .where((doc) => notificationHasMissingCreatedAt(doc.data()))
          .map((doc) => AppNotification.fromMap(doc.id, doc.data()))
          .toList();
      return NotificationPage(
        items: oldItems,
        cursor: after?.cursor,
        legacyCursor: snapshot.docs.isEmpty ? after?.legacyCursor : snapshot.docs.last,
        legacyPhase: true,
        hasMore: snapshot.docs.length == pageLimit,
      );
    }

    Query<Map<String, dynamic>> query = _firestore
        .collection('notifications')
        .where('userId', isEqualTo: uid)
        .orderBy('createdAt', descending: true)
        .orderBy(FieldPath.documentId, descending: true)
        .limit(pageLimit);
    if (after?.cursor != null) {
      query = query.startAfterDocument(after!.cursor!);
    }
    final snapshot = await query.get();
    if (_auth.currentUser?.uid != uid) throw StateError('account_changed');
    return NotificationPage(
      items: snapshot.docs
          .map((doc) => AppNotification.fromMap(doc.id, doc.data()))
          .toList(),
      cursor: snapshot.docs.isEmpty ? after?.cursor : snapshot.docs.last,
      legacyPhase: snapshot.docs.length < pageLimit,
      // Continue to the bounded legacy pass even after the modern feed ends.
      hasMore: true,
    );
  }

  Future<void> markRead(String notificationId) async {
    if (_auth.currentUser == null) throw StateError('auth_required');
    await _firestore.collection('notifications').doc(notificationId).update({
      'read': true,
    });
  }
}

class NotificationPage {
  const NotificationPage({
    required this.items,
    required this.cursor,
    required this.hasMore,
    this.legacyCursor,
    this.legacyPhase = false,
  });

  final List<AppNotification> items;
  // Cursor for ordered notifications; legacy queries maintain a second cursor.
  final DocumentSnapshot<Map<String, dynamic>>? cursor;
  final DocumentSnapshot<Map<String, dynamic>>? legacyCursor;
  final bool legacyPhase;
  final bool hasMore;
}

/// A missing timestamp is not indexed by orderBy('createdAt'). A present
/// null timestamp is indexed and must not be repeated in the legacy pass.
bool notificationHasMissingCreatedAt(Map<String, dynamic> data) =>
    !data.containsKey('createdAt');


String? _nullable(dynamic value) {
  final normalized = (value ?? '').toString().trim();
  return normalized.isEmpty ? null : normalized;
}
