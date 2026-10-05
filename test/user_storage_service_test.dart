import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;
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

  test('UGC preprocessing keeps small valid images unchanged', () async {
    final source = img.Image(width: 64, height: 64);
    img.fill(source, color: img.ColorRgb8(30, 60, 90));
    final bytes = img.encodePng(source);

    final prepared = await prepareUserImageForUpload(
      scope: 'diary_image',
      bytes: bytes,
      mimeType: 'image/png',
    );

    expect(prepared.wasProcessed, isFalse);
    expect(prepared.mimeType, 'image/png');
    expect(prepared.bytes, orderedEquals(bytes));
  });

  test('UGC preprocessing resizes large dimensions and emits bounded WebP', () async {
    final source = img.Image(width: 2200, height: 1100);
    img.fill(source, color: img.ColorRgb8(120, 80, 180));
    final bytes = img.encodeJpg(source, quality: 95);

    final prepared = await prepareUserImageForUpload(
      scope: 'diary_image',
      bytes: bytes,
      mimeType: 'image/jpeg',
    );

    expect(prepared.wasProcessed, isTrue);
    expect(prepared.mimeType, 'image/webp');
    expect(prepared.bytes.length, lessThanOrEqualTo(userImageGlobalMaxBytes));

    final decoded = img.decodeImage(prepared.bytes);
    expect(decoded, isNotNull);
    final longest = decoded!.width > decoded.height
        ? decoded.width
        : decoded.height;
    expect(longest, lessThanOrEqualTo(userImageMaxLongestSide));
  });

  test('non-UGC scopes are not re-encoded by the upload preprocessor', () async {
    final bytes = Uint8List.fromList(<int>[1, 2, 3, 4]);
    final prepared = await prepareUserImageForUpload(
      scope: 'system_asset',
      bytes: bytes,
      mimeType: 'application/octet-stream',
    );

    expect(prepared.wasProcessed, isFalse);
    expect(prepared.bytes, orderedEquals(bytes));
  });
}
