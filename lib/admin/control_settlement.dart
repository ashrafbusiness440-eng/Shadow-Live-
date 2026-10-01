abstract final class AgencySettlementPolicy {
  static const qualifiedMicMinutesPerDay = 120;
  static const requiredQualifiedDays = 14;

  // Activity never reduces Base Host or Agency earnings. The approved
  // Activity Bonus is a separate month-end payout keyed by the highest
  // achieved Target; percentage payout multipliers are retired.
  static int payoutPercent(int qualifiedDays) => 100;

  static num payable(num gross, int qualifiedDays) => gross;

  static bool activityBonusEligible(int qualifiedDays) =>
      qualifiedDays >= requiredQualifiedDays;
}
