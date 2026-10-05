import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('Stage 06 mention search stays bounded and debounced', () {
    final backend = File(
      'cloudflare-worker/src/diaries.js',
    ).readAsStringSync();
    final service = File(
      'lib/features/diaries/services/diary_service.dart',
    ).readAsStringSync();
    final composer = File(
      'lib/features/diaries/screens/diaries_screen.dart',
    ).readAsStringSync();
    final comments = File(
      'lib/features/diaries/widgets/diary_comments_sheet.dart',
    ).readAsStringSync();
    final suggestions = File(
      'lib/features/diaries/widgets/diary_mention_suggestions.dart',
    ).readAsStringSync();

    expect(backend.contains('const MAX_MENTIONS = 8;'), isTrue);
    expect(backend.contains('action === "searchMentions"'), isTrue);
    expect(
      backend.contains(
        'filters: [{ field: "searchTokens", op: "array-contains", value: query }]',
      ),
      isTrue,
    );
    expect(backend.contains('limit: MAX_MENTIONS + 1'), isTrue);
    expect(backend.contains('.list('), isFalse);

    expect(service.contains("Future<List<DiaryMentionCandidate>> searchMentions"), isTrue);
    expect(composer.contains('Duration(milliseconds: 250)'), isTrue);
    expect(comments.contains('Duration(milliseconds: 250)'), isTrue);
    expect(suggestions.contains(r"'@${candidate.publicId} '"), isTrue);
    expect(composer.contains('FirebaseFirestore'), isFalse);
    expect(comments.contains('FirebaseFirestore'), isFalse);
  });

  test('Stage 06 social notifications and deep links are wired', () {
    final backend = File(
      'cloudflare-worker/src/diaries.js',
    ).readAsStringSync();
    final gifts = File(
      'cloudflare-worker/src/chat-safety-actions.js',
    ).readAsStringSync();
    final notifications = File(
      'lib/features/notifications/services/notification_service.dart',
    ).readAsStringSync();
    final page = File(
      'lib/features/notifications/screens/notifications_page.dart',
    ).readAsStringSync();
    final screen = File(
      'lib/features/diaries/screens/diaries_screen.dart',
    ).readAsStringSync();
    final service = File(
      'lib/features/diaries/services/diary_service.dart',
    ).readAsStringSync();

    expect(backend.contains('"diary_like_aggregate"'), isTrue);
    expect(backend.contains('"diary_comment"'), isTrue);
    expect(backend.contains('"diary_mention"'), isTrue);
    expect(gifts.contains('type: "diary_gift"'), isTrue);

    expect(notifications.contains("diaryId: _nullable(data['diaryId'])"), isTrue);
    expect(notifications.contains("commentId: _nullable(data['commentId'])"), isTrue);
    expect(page.contains("item.type == 'diary_comment'"), isTrue);
    expect(page.contains("item.type == 'diary_mention'"), isTrue);
    expect(page.contains("item.type == 'diary_gift'"), isTrue);
    expect(page.contains("item.type == 'diary_like_aggregate'"), isTrue);
    expect(page.contains('initialDiaryId: item.diaryId'), isTrue);
    expect(page.contains('openCommentsOnStart:'), isTrue);

    expect(service.contains("Future<DiaryItem> getDiary"), isTrue);
    expect(backend.contains('action === "getDiary"'), isTrue);
    expect(screen.contains('initialDiaryId'), isTrue);
  });
}
