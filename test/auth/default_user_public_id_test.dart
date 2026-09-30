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

  test('repairs only short automatic IDs while setup is incomplete', () {
    expect(
      needsInitialUserPublicIdRepair({
        'publicId': '661831',
        'setupComplete': false,
      }),
      isTrue,
    );
    expect(
      needsInitialUserPublicIdRepair({
        'publicId': '123',
        'setupComplete': false,
      }),
      isTrue,
    );
    expect(
      needsInitialUserPublicIdRepair({
        'publicId': '12345678',
        'setupComplete': false,
      }),
      isFalse,
    );
    expect(
      needsInitialUserPublicIdRepair({
        'publicId': '661831',
        'setupComplete': true,
      }),
      isFalse,
    );
    expect(
      needsInitialUserPublicIdRepair({
        'publicId': '661831',
        'setupComplete': false,
        'publicIdUpdatedBy': 'owner_uid',
      }),
      isFalse,
    );
  });
}
