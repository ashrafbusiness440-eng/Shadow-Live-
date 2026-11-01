import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/profile/services/profile_membership_days.dart';

void main() {
  final now = DateTime.utc(2026, 11, 1, 12);
  test('creation timestamps produce elapsed full days', () {
    expect(verifiedMembershipDays({'createdAt': Timestamp.fromDate(DateTime.utc(2026, 10, 29, 11))}, now: now), 3);
    expect(verifiedMembershipDays({'createdAt': '2026-10-31T12:00:00Z'}, now: now), 1);
    expect(verifiedMembershipDays({'createdAt': DateTime.utc(2026, 11, 1, 11)}, now: now), 0);
  });

  test('missing invalid or future creation does not invent age', () {
    expect(verifiedMembershipDays({}, now: now), isNull);
    expect(verifiedMembershipDays({'createdAt': 'invalid'}, now: now), isNull);
    expect(verifiedMembershipDays({'createdAt': 123}, now: now), isNull);
    expect(verifiedMembershipDays({'createdAt': DateTime.utc(2026, 11, 2)}, now: now), isNull);
  });
}
