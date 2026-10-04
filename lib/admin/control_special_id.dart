class SpecialIdPolicy {
  static String normalize(String value) => value.trim();

  static bool eligibleByVip(int vipLevel) => vipLevel >= 3;

  static bool _digitsOnly(String value) {
    if (value.isEmpty) return false;
    for (final unit in value.codeUnits) {
      if (unit < 48 || unit > 57) return false;
    }
    return true;
  }

  // Syntax-only compatibility helper. Eligibility/range enforcement must use
  // validForVip so the active VIP level is always part of authorization.
  static bool valid(String value) {
    final normalized = normalize(value);
    return normalized.length >= 3 &&
        normalized.length <= 7 &&
        _digitsOnly(normalized);
  }

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
    return normalized.length >= min &&
        normalized.length <= max &&
        _digitsOnly(normalized);
  }

  static void validateForVip(String value, int vipLevel) {
    if (!validForVip(value, vipLevel)) {
      throw ArgumentError('Fancy ID غير صالح لمستوى VIP الحالي');
    }
  }
}
