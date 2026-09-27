import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/shared/services/user_storage_service.dart';

void main() {
  test('detectSupportedImageMime detects supported signatures', () {
    expect(
      detectSupportedImageMime(Uint8List.fromList([0xFF, 0xD8, 0xFF, 0x00])),
      'image/jpeg',
    );
    expect(
      detectSupportedImageMime(
        Uint8List.fromList([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
      ),
      'image/png',
    );
    expect(
      detectSupportedImageMime(
        Uint8List.fromList([
          0x52, 0x49, 0x46, 0x46,
          0x00, 0x00, 0x00, 0x00,
          0x57, 0x45, 0x42, 0x50,
        ]),
      ),
      'image/webp',
    );
  });

  test('detectSupportedImageMime rejects unsupported bytes', () {
    expect(
      () => detectSupportedImageMime(Uint8List.fromList([1, 2, 3, 4])),
      throwsStateError,
    );
  });
}
