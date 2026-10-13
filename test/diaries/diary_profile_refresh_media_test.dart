import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('profile refresh requests bounded recovery but initial loads do not', () {
    final screen = File('lib/features/diaries/screens/diaries_screen.dart')
        .readAsStringSync();
    final service = File('lib/features/diaries/services/diary_service.dart')
        .readAsStringSync();
    expect(screen.contains('bool recoverMissing = false'), isTrue);
    expect(screen.contains('recoverMissing: reset && recoverMissing'), isTrue);
    expect(screen.contains(
      'onRefresh: () => _load(reset: true, recoverMissing: _profileMode)',
    ), isTrue);
    expect(screen.contains(
      'onPressed: _loading ? null : () => _load(reset: true, recoverMissing: _profileMode)',
    ), isTrue);
    expect(service.contains("if (recoverMissing) 'recoverMissing': true"), isTrue);
    expect(screen.contains('Timer.periodic'), isFalse);
  });

  test('diary content photos are separate from profile avatar sources', () {
    final screen = File('lib/features/diaries/screens/diaries_screen.dart')
        .readAsStringSync();
    final service = File('lib/features/diaries/services/diary_service.dart')
        .readAsStringSync();
    expect(screen.contains('images.first.publicUrl'), isTrue);
    expect(screen.contains('images[i].publicUrl'), isTrue);
    expect(service.contains("data['publicUrl']"), isTrue);
    expect(service.contains("data['profileImageUrl']"), isTrue);
  });
}
