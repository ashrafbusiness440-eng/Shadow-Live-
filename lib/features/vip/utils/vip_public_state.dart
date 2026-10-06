import 'package:cloud_firestore/cloud_firestore.dart';

DateTime? vipExpiryDate(dynamic value) {
  if (value == null) return null;
  if (value is Timestamp) return value.toDate();
  if (value is DateTime) return value;
  if (value is num) {
    final ms = value.toInt();
    if (ms <= 0) return null;
    return DateTime.fromMillisecondsSinceEpoch(ms);
  }
  final raw = value.toString().trim();
  if (raw.isEmpty) return null;
  return DateTime.tryParse(raw);
}

int effectivePublicVipLevel(
  Map<String, dynamic> data, {
  DateTime? now,
}) {
  final raw = data['effectiveVipLevel'];
  final level = raw is num ? raw.toInt() : int.tryParse(raw?.toString() ?? '');
  if (level == null || level < 1 || level > 10) return 0;

  final expiry = vipExpiryDate(data['vipExpiresAt']);
  if (expiry == null) return 0;

  final current = now ?? DateTime.now();
  return expiry.isAfter(current) ? level : 0;
}


bool publicNobleLevelHidden(
  Map<String, dynamic> data, {
  DateTime? now,
}) {
  return effectivePublicVipLevel(data, now: now) >= 4 &&
      data['hideNobleLevel'] == true;
}
