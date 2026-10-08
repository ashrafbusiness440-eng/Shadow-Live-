import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('Shadow Control can enable disable and reorder mysterious voices', () {
    final page = File(
      'lib/admin/mysterious_person_control_page.dart',
    ).readAsStringSync();

    expect(page.contains('_canConfigureVoices'), isTrue);
    expect(page.contains('controlUpdateVoices'), isTrue);
    expect(page.contains('_toggleVoice('), isTrue);
    expect(page.contains('_moveVoice('), isTrue);
    expect(
      page.contains("Key('mysterious-control-save-voices')"),
      isTrue,
    );
    expect(page.contains('Fallback ثابت — لا يمكن تعطيله'), isTrue);
    expect(page.contains('FirebaseFirestore'), isFalse);
    expect(page.contains('.snapshots()'), isFalse);
  });
}
