import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/shared/services/user_storage_service.dart';

void main() {
  test('U6-L4/C pending moderation retains final compressed upload metadata', () {
    const receipt = UserStoragePendingModeration(
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'needs_review',
      mimeType: 'image/webp',
      sizeBytes: 78532,
    );
    expect(receipt.objectId, hasLength(32));
    expect(receipt.status, 'needs_review');
    expect(receipt.mimeType, 'image/webp');
    expect(receipt.sizeBytes, 78532);
  });

  test('U6-L4/C chat placeholder includes Firestore image rule requirements', () {
    final source = File('lib/features/chat/screens/private_chat_screen.dart')
        .readAsStringSync();
    final upload = File('lib/shared/services/user_storage_service.dart')
        .readAsStringSync();
    final rules = File('firestore.rules').readAsStringSync();

    expect(source, contains("'storageObjectId': pending.objectId"));
    expect(source, contains("'mimeType': pending.mimeType"));
    expect(source, contains("'sizeBytes': pending.sizeBytes"));
    expect(source, contains("'moderationStatus': 'pending'"));
    expect(upload, contains('mimeType: uploadMimeType'));
    expect(upload, contains('sizeBytes: uploadBytes.length'));
    expect(rules, contains('request.resource.data.mimeType is string'));
    expect(rules, contains('request.resource.data.sizeBytes is int'));
    expect(rules, contains('request.resource.data.sizeBytes <= 3145728'));
    expect(rules, contains('allow update, delete: if false'));
  });
}
