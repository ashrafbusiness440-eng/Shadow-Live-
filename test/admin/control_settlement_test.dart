import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/admin/control_settlement.dart';

void main() {
  test('attendance never discounts base Host or Agency payout', () {
    for (final days in <int>[0, 2, 3, 7, 8, 9, 13, 14, 30]) {
      expect(AgencySettlementPolicy.payoutPercent(days), 100);
    }
  });

  test('base payable is independent from attendance', () {
    expect(AgencySettlementPolicy.payable(100, 0), 100);
    expect(AgencySettlementPolicy.payable(100, 7), 100);
    expect(AgencySettlementPolicy.payable(100, 14), 100);
  });

  test('activity bonus eligibility requires fourteen qualified days', () {
    expect(AgencySettlementPolicy.activityBonusEligible(13), isFalse);
    expect(AgencySettlementPolicy.activityBonusEligible(14), isTrue);
    expect(AgencySettlementPolicy.requiredQualifiedDays, 14);
    expect(AgencySettlementPolicy.qualifiedMicMinutesPerDay, 120);
  });
}
