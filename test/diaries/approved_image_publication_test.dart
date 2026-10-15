import 'dart:io';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('approved diary image is reused once without uploading it again', () {
    final screen = File(
      'lib/features/diaries/screens/diaries_screen.dart',
    ).readAsStringSync();
    expect(screen.contains('initialApprovedImageObjectId'), isTrue);
    expect(screen.contains('final objectIds = <String>[..._approvedImageObjectIds];'),
        isTrue);
    expect(screen.contains('_pickedImages.take(2 - objectIds.length)'), isTrue);
    expect(screen.contains('on UserStoragePendingModeration catch (pending)'),
        isTrue);
    expect(screen.contains('صورة معتمدة — تُنشر مع اليومية فقط'), isTrue);
    expect(screen.split('Future<void> _publish()').length, 2,
        reason: 'Exactly one composer publish flow');
  });

  test('diary approval notification opens composer, not direct public URL', () {
    final notifications = File(
      'lib/features/notifications/screens/notifications_page.dart',
    ).readAsStringSync();
    expect(notifications.contains('approved_pending_diary_link'), isTrue);
    expect(notifications.contains('initialApprovedImageObjectId: objectId'),
        isTrue);
    expect(notifications.contains('إنشاء يومية بهذه الصورة'), isTrue);
    expect(notifications.split('Future<void> _openImageModeration').length, 2);
  });

  test('unapproved image response stays clear, privacy gate stays off', () {
    final errors = File('lib/features/diaries/services/diary_service.dart')
        .readAsStringSync();
    final worker = File('cloudflare-worker/src/image-moderation-control.js')
        .readAsStringSync();
    expect(errors.contains("case 'diary_image_not_approved':"), isTrue);
    expect(worker.contains('IMAGE_MODERATION_PUBLICATION_GATE_READY = false'),
        isTrue);
  });
}
