class ControlAssetStudioTemplate {
  const ControlAssetStudioTemplate({
    required this.id,
    required this.type,
    required this.version,
    required this.labelAr,
    required this.directories,
    required this.extensions,
    required this.maxBytes,
    required this.width,
    required this.height,
    required this.dimensionsStatus,
    required this.transparency,
    required this.motion,
    required this.prompt,
    required this.noteAr,
  });

  final String id;
  final String type;
  final int version;
  final String labelAr;
  final List<String> directories;
  final List<String> extensions;
  final int maxBytes;
  final int? width;
  final int? height;
  final String dimensionsStatus;
  final String transparency;
  final String motion;
  final String prompt;
  final String noteAr;

  factory ControlAssetStudioTemplate.fromMap(Map<String, dynamic> map) {
    int? asNullableInt(dynamic value) {
      if (value is num) return value.toInt();
      return int.tryParse('${value ?? ''}');
    }

    List<String> strings(dynamic value) => value is List
        ? value
            .map((e) => e.toString().trim())
            .where((e) => e.isNotEmpty)
            .toList(growable: false)
        : const <String>[];

    return ControlAssetStudioTemplate(
      id: '${map['id'] ?? ''}'.trim(),
      type: '${map['type'] ?? ''}'.trim(),
      version: (map['version'] as num?)?.toInt() ?? 1,
      labelAr: '${map['labelAr'] ?? map['type'] ?? ''}'.trim(),
      directories: strings(map['directories']),
      extensions: strings(map['extensions']),
      maxBytes: (map['maxBytes'] as num?)?.toInt() ?? 2500000,
      width: asNullableInt(map['width']),
      height: asNullableInt(map['height']),
      dimensionsStatus: '${map['dimensionsStatus'] ?? 'tbd'}'.trim(),
      transparency: '${map['transparency'] ?? 'optional'}'.trim(),
      motion: '${map['motion'] ?? 'static_or_animated'}'.trim(),
      prompt: '${map['prompt'] ?? ''}'.trim(),
      noteAr: '${map['noteAr'] ?? ''}'.trim(),
    );
  }

  bool allowsDirectory(String value) {
    var directory = value.trim().replaceAll('\\', '/');
    directory = directory.replaceAll(RegExp(r'/+

  bool allowsExtension(String value) =>
      extensions.contains(value.trim().toLowerCase());

  bool dimensionsMatch(int actualWidth, int actualHeight) {
    if (width == null || height == null) return true;
    return actualWidth == width && actualHeight == height;
  }

  String get dimensionsLabel =>
      width == null || height == null ? 'غير مثبتة بعد' : '$width×$height';

  String get transparencyLabel => switch (transparency) {
        'required' => 'شفافية مطلوبة',
        'forbidden' => 'بدون شفافية',
        _ => 'الشفافية اختيارية',
      };

  String get motionLabel => switch (motion) {
        'static' => 'ثابت',
        'animated' => 'متحرك',
        _ => 'ثابت أو متحرك',
      };

  String get extensionsLabel =>
      extensions.map((e) => e.toUpperCase()).join(' / ');
}), '');
    if (directory.isEmpty ||
        directory.startsWith('/') ||
        directory.contains('//')) {
      return false;
    }
    final safeSegment = RegExp(r'^[A-Za-z0-9][A-Za-z0-9._-]{0,79}

  bool allowsExtension(String value) =>
      extensions.contains(value.trim().toLowerCase());

  bool dimensionsMatch(int actualWidth, int actualHeight) {
    if (width == null || height == null) return true;
    return actualWidth == width && actualHeight == height;
  }

  String get dimensionsLabel =>
      width == null || height == null ? 'غير مثبتة بعد' : '$width×$height';

  String get transparencyLabel => switch (transparency) {
        'required' => 'شفافية مطلوبة',
        'forbidden' => 'بدون شفافية',
        _ => 'الشفافية اختيارية',
      };

  String get motionLabel => switch (motion) {
        'static' => 'ثابت',
        'animated' => 'متحرك',
        _ => 'ثابت أو متحرك',
      };

  String get extensionsLabel =>
      extensions.map((e) => e.toUpperCase()).join(' / ');
});
    final segments = directory.split('/');
    if (segments.any((segment) =>
        segment.isEmpty ||
        segment == '.' ||
        segment == '..' ||
        !safeSegment.hasMatch(segment))) {
      return false;
    }
    return directories.any((root) {
      final normalizedRoot = root.trim().replaceAll(RegExp(r'/+

  bool allowsExtension(String value) =>
      extensions.contains(value.trim().toLowerCase());

  bool dimensionsMatch(int actualWidth, int actualHeight) {
    if (width == null || height == null) return true;
    return actualWidth == width && actualHeight == height;
  }

  String get dimensionsLabel =>
      width == null || height == null ? 'غير مثبتة بعد' : '$width×$height';

  String get transparencyLabel => switch (transparency) {
        'required' => 'شفافية مطلوبة',
        'forbidden' => 'بدون شفافية',
        _ => 'الشفافية اختيارية',
      };

  String get motionLabel => switch (motion) {
        'static' => 'ثابت',
        'animated' => 'متحرك',
        _ => 'ثابت أو متحرك',
      };

  String get extensionsLabel =>
      extensions.map((e) => e.toUpperCase()).join(' / ');
}), '');
      return directory == normalizedRoot ||
          directory.startsWith('$normalizedRoot/');
    });
  }

  bool allowsExtension(String value) =>
      extensions.contains(value.trim().toLowerCase());

  bool dimensionsMatch(int actualWidth, int actualHeight) {
    if (width == null || height == null) return true;
    return actualWidth == width && actualHeight == height;
  }

  String get dimensionsLabel =>
      width == null || height == null ? 'غير مثبتة بعد' : '$width×$height';

  String get transparencyLabel => switch (transparency) {
        'required' => 'شفافية مطلوبة',
        'forbidden' => 'بدون شفافية',
        _ => 'الشفافية اختيارية',
      };

  String get motionLabel => switch (motion) {
        'static' => 'ثابت',
        'animated' => 'متحرك',
        _ => 'ثابت أو متحرك',
      };

  String get extensionsLabel =>
      extensions.map((e) => e.toUpperCase()).join(' / ');
}