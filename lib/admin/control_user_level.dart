abstract final class UserLevelMigrationPolicy {
  static const forbiddenLegacyFields = <String>{
    'level',
    'userLevel',
    'memberLevel',
    'popularity',
    'popularityLevel',
    'wealth',
    'wealthLevel',
  };

  static bool isLegacyField(String field) =>
      forbiddenLegacyFields.contains(field);
}
