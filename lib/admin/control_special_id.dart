class SpecialIdPolicy {
  static String normalize(String value) => value.trim();

  static bool eligibleByVip(int vipLevel) => vipLevel >= 3;

  // Syntax-only compatibility helper. Eligibility/range enforcement must use
  // validForVip so the active VIP level is always part of authorization.
  static bool valid(String value) =>
      RegExp(r'^\d{3,7}$').hasMatch(normalize(value));

  static void validate(String value) {
    if (!valid(value)) {
      throw ArgumentError('Fancy ID غير صالح');
    }
  }

  static int? minDigitsForVip(int vipLevel) {
    if (vipLevel >= 10) return 3;
    if (vipLevel >= 8) return 4;
    if (vipLevel >= 3) return 6;
    return null;
  }

  static int? maxDigitsForVip(int vipLevel) =>
      eligibleByVip(vipLevel) ? 7 : null;

  static bool validForVip(String value, int vipLevel) {
    final min = minDigitsForVip(vipLevel);
    final max = maxDigitsForVip(vipLevel);
    if (min == null || max == null) return false;
    final normalized = normalize(value);
    return RegExp('^[0-9]{$min,$max}' r'
  }

  static void validateForVip(String value, int vipLevel) {
    if (!validForVip(value, vipLevel)) {
      throw ArgumentError('Fancy ID غير صالح لمستوى VIP الحالي');
    }
  }
}
).hasMatch(normalized);
  }

  static void validateForVip(String value, int vipLevel) {
    if (!validForVip(value, vipLevel)) {
      throw ArgumentError('Fancy ID غير صالح لمستوى VIP الحالي');
    }
  }
}
