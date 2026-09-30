import 'dart:math';

import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/shared/services/firebase_service.dart';

void main() {
  test('new users receive an 8-digit public ID by default', () {
    final random = Random(42);
    for (var i = 0; i < 200; i += 1) {
      final id = generateDefaultUserPublicId(random);
      expect(id, matches(RegExp(r'^\d{8}$')));
      final value = int.parse(id);
      expect(value, inInclusiveRange(10000000, 99999999));
    }
  });
}
