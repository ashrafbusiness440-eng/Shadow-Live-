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
      actionState == 'resolved' ||
      finalStatus == 'accepted' ||
      finalStatus == 'rejected';

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

  Future<NotificationPage> load({DocumentSnapshot<Map<String, dynamic>>? after}) async {
    final uid = _auth.currentUser?.uid;
    if (uid == null) throw StateError('auth_required');
    Query<Map<String, dynamic>> query = _firestore
        .collection('notifications')
        .where('userId', isEqualTo: uid)
        .orderBy(FieldPath.documentId)
        .limit(pageLimit);
    if (after != null) query = query.startAfterDocument(after);
    final snapshot = await query.get();
    final items = snapshot.docs
        .map((doc) => AppNotification.fromMap(doc.id, doc.data()))
        .toList();
    items.sort((a, b) {
      final left = a.createdAt?.millisecondsSinceEpoch ?? 0;
      final right = b.createdAt?.millisecondsSinceEpoch ?? 0;
      return right.compareTo(left);
    });
    return NotificationPage(
      items: items,
      cursor: snapshot.docs.isEmpty ? null : snapshot.docs.last,
      hasMore: snapshot.docs.length == pageLimit,
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
  });

  final List<AppNotification> items;
  final DocumentSnapshot<Map<String, dynamic>>? cursor;
  final bool hasMore;
}


String? _nullable(dynamic value) {
  final normalized = (value ?? '').toString().trim();
  return normalized.isEmpty ? null : normalized;
}
