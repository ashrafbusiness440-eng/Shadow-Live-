abstract final class ControlAssetPolicy {
  static const allowedDirectories = <String>[
    'assets/images',
    'assets/images/avatars',
    'assets/images/coins',
    'assets/images/badges',
    'assets/images/vip',
    'assets/images/levels',
    'assets/images/roles',
    'assets/images/frames',
    'assets/images/gifts',
    'assets/images/rooms',
    'assets/images/backgrounds',
    'assets/images/banners',
    'assets/images/games',
    'assets/images/games/greedy_cat',
    'assets/images/games/witch',
    'assets/images/games/slot',
    'assets/images/store',
    'assets/images/misc',
  ];

  static const allowedExtensions = <String>{'png','jpg','jpeg','webp','gif'};
  static const maxBytes = 2500000;

  static String normalizeDirectory(String value) {
    var text = value.trim().replaceAll('\\', '/');
    while (text.endsWith('/')) {
      text = text.substring(0, text.length - 1);
    }
    return text;
  }

  static bool directoryAllowed(String value) =>
      allowedDirectories.contains(normalizeDirectory(value));

  static bool fileNameAllowed(String value) {
    final name = value.trim();
    if (!RegExp(r'^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$').hasMatch(name)) {
      return false;
    }
    final dot = name.lastIndexOf('.');
    if (dot <= 0 || dot == name.length - 1) return false;
    return allowedExtensions.contains(name.substring(dot + 1).toLowerCase());
  }

  static bool assetKeyAllowed(String value) =>
      RegExp(r'^[a-z0-9][a-z0-9._-]{2,119}$').hasMatch(value.trim());

  static String fullPath(String directory, String fileName) =>
      '${normalizeDirectory(directory)}/${fileName.trim()}';
}
