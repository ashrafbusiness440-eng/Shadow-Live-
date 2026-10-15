import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  final screen = File('lib/features/diaries/screens/diaries_screen.dart')
      .readAsStringSync();

  test('diary has a compact entry before the original expanded editor', () {
    expect(screen.contains("bool _composerExpanded = false;"), isTrue);
    expect(screen.contains("if (!_composerExpanded) {"), isTrue);
    expect(screen.contains("ValueKey('diary-compact-composer')"), isTrue);
    expect(screen.contains("ValueKey('diary-expanded-composer')"), isTrue);
    expect(screen.indexOf("ValueKey('diary-compact-composer')"),
        lessThan(screen.indexOf("ValueKey('diary-expanded-composer')")));
    expect(screen.contains("ValueKey('diary-open-composer')"), isTrue);
    expect(screen.contains("ValueKey('diary-open-photos')"), isTrue);
    expect(screen.contains("ValueKey('diary-collapse-composer')"), isTrue);
  });

  test('closing expanded diary composer keeps drafts and images', () {
    expect(screen.contains(
      "onPressed: _publishing\n                    ? null\n"
      "                    : () => setState(() => _composerExpanded = false),"
    ), isTrue);
    expect(screen.contains("tooltip: 'إغلاق المحرر مع حفظ المسودة'"), isTrue);
    expect(screen.contains("_text.clear();"), isTrue);
    expect(screen.contains("_pickedImages = const <_PickedDiaryImage>[];"),
        isTrue);
    expect(screen.contains("_composerExpanded = false;"), isTrue);
    expect(screen.contains("await _pickImages();"), isTrue);
    expect(screen.contains("onPressed: _publishing ? null : _publish"),
        isTrue);
  });

  test('composer retains all existing publishing protections', () {
    expect(screen.contains("if (_guest || !_signedIn)"), isTrue);
    expect(screen.contains("maxLength: 500"), isTrue);
    expect(screen.contains('final slots = 2 - _approvedImageObjectIds.length;'), isTrue);
    expect(screen.contains('files.take(slots)'), isTrue);
    expect(screen.contains("scope: 'diary_image'"), isTrue);
    expect(screen.contains("commentsEnabled: _commentsEnabled"), isTrue);
    expect(screen.contains("DiaryMentionSuggestions("), isTrue);
    expect(screen.contains("if (!_profileMode) _composer()"), isTrue);
  });
}
