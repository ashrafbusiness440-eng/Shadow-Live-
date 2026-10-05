import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('Stage 04 interactions stay on the diary API', () {
    final service = File(
      'lib/features/diaries/services/diary_service.dart',
    ).readAsStringSync();
    final screen = File(
      'lib/features/diaries/screens/diaries_screen.dart',
    ).readAsStringSync();
    final comments = File(
      'lib/features/diaries/widgets/diary_comments_sheet.dart',
    ).readAsStringSync();

    for (final action in <String>[
      'toggleLike',
      'listComments',
      'createComment',
      'deleteComment',
      'recordView',
    ]) {
      expect(service.contains("'$action'"), isTrue, reason: action);
    }
    expect(screen.contains('_service.toggleLike'), isTrue);
    expect(screen.contains('DiaryCommentsSheet'), isTrue);
    expect(screen.contains('_service.recordView'), isTrue);
    expect(comments.contains('FirebaseFirestore'), isFalse);
    expect(comments.contains('maxLength: 200'), isTrue);
  });

  test('backend keeps interaction writes bounded and mirrored', () {
    final source = File(
      'cloudflare-worker/src/diaries.js',
    ).readAsStringSync();
    final rules = File('firestore.rules').readAsStringSync();

    expect(source.contains('VIEW_DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000'), isTrue);
    expect(source.contains('async function toggleLike('), isTrue);
    expect(source.contains('async function createComment('), isTrue);
    expect(source.contains('async function deleteComment('), isTrue);
    expect(source.contains('async function recordView('), isTrue);
    expect(source.contains('users/${ownerUid}/diaries/${diaryId}'), isTrue);
    expect(source.contains('diaries/${diaryId}/comments/${commentId}'), isTrue);
    expect(source.contains('.list('), isFalse);
    expect(
      rules.contains('match /comments/{commentId}'),
      isTrue,
    );
  });

  test('guest can only read comments and record deduped views', () {
    final source = File(
      'cloudflare-worker/src/diaries.js',
    ).readAsStringSync();

    final listComments = source.indexOf('if (action === "listComments")');
    final recordView = source.indexOf('if (action === "recordView")');
    final guestGuard = source.indexOf('if (auth.guest) {');
    final toggleLike = source.indexOf('if (action === "toggleLike")');

    expect(listComments, greaterThanOrEqualTo(0));
    expect(recordView, greaterThanOrEqualTo(0));
    expect(guestGuard, greaterThan(listComments));
    expect(guestGuard, greaterThan(recordView));
    expect(toggleLike, greaterThan(guestGuard));
  });
}
