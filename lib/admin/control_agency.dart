abstract final class AgencyPolicy {
  static const cycleStartDay = 1;
  static const removalResponseHours = 24, rejoinCooldownHours = 24;

  /// Agencies use one calendar-month cycle only.
  static String cycleForDay(int day) {
    if (day < 1 || day > 31) throw ArgumentError('invalid day');
    return 'monthly';
  }

  static bool qualifiesDay(Duration micTime) => micTime.inMinutes >= 120;
}
