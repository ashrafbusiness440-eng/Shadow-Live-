import 'package:cloud_firestore/cloud_firestore.dart';

/// Returns elapsed full days only when a genuine account creation timestamp
/// is present. Never infer membership age from a public ID or document order.
int? verifiedMembershipDays(
  Map<String, dynamic> profile, {
  DateTime? now,
}) {
  final raw = profile['createdAt'];
  DateTime? created;
  if (raw is Timestamp) {
    created = raw.toDate();
  } else if (raw is DateTime) {
    created = raw;
  } else if (raw is String && raw.trim().isNotEmpty) {
    created = DateTime.tryParse(raw.trim());
  }
  if (created == null) return null;
  final time = now ?? DateTime.now();
  if (created.isAfter(time)) return null;
  return time.toUtc().difference(created.toUtc()).inDays;
}
