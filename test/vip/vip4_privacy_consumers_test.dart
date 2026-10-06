import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/vip/utils/vip_public_state.dart';

void main() {
  test('06-H public Noble privacy requires active VIP4+', () {
    final now = DateTime.utc(2026, 10, 6, 8);

    expect(
      publicNobleLevelHidden(<String, dynamic>{
        'effectiveVipLevel': 4,
        'vipExpiresAt': now.add(const Duration(days: 1)),
        'hideNobleLevel': true,
      }, now: now),
      isTrue,
    );

    expect(
      publicNobleLevelHidden(<String, dynamic>{
        'effectiveVipLevel': 3,
        'vipExpiresAt': now.add(const Duration(days: 1)),
        'hideNobleLevel': true,
      }, now: now),
      isFalse,
    );

    expect(
      publicNobleLevelHidden(<String, dynamic>{
        'effectiveVipLevel': 10,
        'vipExpiresAt': now.subtract(const Duration(seconds: 1)),
        'hideNobleLevel': true,
      }, now: now),
      isFalse,
    );
  });
}
