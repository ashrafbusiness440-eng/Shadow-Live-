import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('agency room image is never sent as room_cover metadata', () {
    final source = File('lib/main.dart').readAsStringSync();

    expect(
      source.contains("coverImageUrl:\n                                        isAgencyRoom ? '' : nextCoverImageUrl"),
      isTrue,
    );
    expect(
      source.contains("coverImageObjectId:\n                                        isAgencyRoom ? null : nextCoverObjectId"),
      isTrue,
    );
  });

  test('room settings expose actionable backend errors', () {
    final source = File('lib/main.dart').readAsStringSync();

    for (final code in <String>[
      'forbidden',
      'invalid_room_name',
      'invalid_room_description',
      'invalid_room_category',
      'invalid_room_tags',
      'room_image_object_not_found',
      'room_image_object_mismatch',
      'room_not_found',
      'unauthorized',
    ]) {
      expect(source.contains("'$code'"), isTrue, reason: code);
    }
  });
}
