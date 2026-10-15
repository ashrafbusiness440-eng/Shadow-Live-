import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/shared/services/user_storage_service.dart';

void main() {
  test('confirmed R2 object metadata is the chat-image message metadata', () {
    final confirmed = UserStorageUploadResult.fromJson({
      'objectId': 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'scope': 'chat_image',
      'targetId': 'conversation_1',
      'mimeType': 'image/jpeg',
      'sizeBytes': 500000,
    });
    expect(confirmed.mimeType, 'image/jpeg');
    expect(confirmed.sizeBytes, 500000);

    final screen = File('lib/features/chat/screens/private_chat_screen.dart')
        .readAsStringSync();
    expect(screen.contains("'mimeType': upload.mimeType,"), isTrue);
    expect(screen.contains("'sizeBytes': upload.sizeBytes,"), isTrue);
    expect(screen.contains("'mimeType': mime,\n        'sizeBytes': bytes.length,"), isFalse);

    // Moderation-pending uploads must preserve their own verified metadata.
    expect(screen.contains("'mimeType': pending.mimeType,"), isTrue);
    expect(screen.contains("'sizeBytes': pending.sizeBytes,"), isTrue);
    expect(
      screen.contains("error.message == 'image_too_large_after_compression'"),
      isTrue,
    );
  });
}
