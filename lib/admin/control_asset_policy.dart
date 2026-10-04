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
    'assets/images/chat_bubbles',
    'assets/images/entrances',
    'assets/images/audio_waves',
    'assets/images/name_effects',
    'assets/images/mic_effects',
    'assets/images/stickers',
    'assets/images/cards',
    'assets/images/events',
    'assets/images/agencies',
    'assets/images/system',
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

  static bool directoryAllowed(String value) {
    final directory = normalizeDirectory(value);
    if (directory.isEmpty ||
        directory.startsWith('/') ||
        directory.contains('//')) {
      return false;
    }
    final segments = directory.split('/');
    final safeSegment = RegExp(r'^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$');
    if (segments.any((segment) =>
        segment.isEmpty ||
        segment == '.' ||
        segment == '..' ||
        !safeSegment.hasMatch(segment))) {
      return false;
    }
    return allowedDirectories.any(
      (root) => directory == root || directory.startsWith('$root/'),
    );
  }

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
      RegExp(r'^[a-z0-9][A-Za-z0-9._-]{2,119}

  static String fullPath(String directory, String fileName) =>
      '${normalizeDirectory(directory)}/${fileName.trim()}';
}
).hasMatch(value.trim());

  static String fullPath(String directory, String fileName) =>
      '${normalizeDirectory(directory)}/${fileName.trim()}';
}
