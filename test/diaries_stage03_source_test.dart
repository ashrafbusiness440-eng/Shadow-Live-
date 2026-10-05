import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('diaries tab replaces Coming Soon and guests can browse it', () {
    final shell = File(
      'lib/features/main/screens/main_shell_screen.dart',
    ).readAsStringSync();

    expect(shell.contains("import '../../diaries/screens/diaries_screen.dart';"), isTrue);
    expect(shell.contains("DiariesScreen("), isTrue);
    expect(shell.contains("title: 'يومياتي'"), isTrue);
    expect(shell.contains('_ComingSoonPage'), isFalse);
    expect(
      shell.contains(
        'if (_guest && (navIndex == 2 || navIndex == 3 || navIndex == 4))',
      ),
      isFalse,
    );
    expect(
      shell.contains('if (_guest && (navIndex == 2 || navIndex == 3))'),
      isTrue,
    );
  });

  test('diaries screen keeps Stage 03 composer and pagination guardrails', () {
    final screen = File(
      'lib/features/diaries/screens/diaries_screen.dart',
    ).readAsStringSync();

    expect(screen.contains('maxLength: 500'), isTrue);
    expect(screen.contains("scope: 'diary_image'"), isTrue);
    expect(screen.contains('files.take(2)'), isTrue);
    expect(screen.contains('listFollowing'), isTrue);
    expect(screen.contains("const Text('تحميل المزيد')"), isTrue);
    expect(screen.contains('UserStorageService'), isTrue);
    expect(screen.contains('commentsEnabled: _commentsEnabled'), isTrue);
  });

  test('following feed is bounded and Firestore IN is explicit', () {
    final diaries = File(
      'cloudflare-worker/src/diaries.js',
    ).readAsStringSync();
    final firestore = File(
      'cloudflare-worker/src/firestore.js',
    ).readAsStringSync();

    expect(diaries.contains('async function listFollowing('), isTrue);
    expect(diaries.contains('{ field: "followingUid", op: "in", value: ownerIds }'), isTrue);
    expect(diaries.contains('limit: limit + 1'), isTrue);
    expect(diaries.contains('.list('), isFalse);
    expect(firestore.contains('"in": "IN"'), isTrue);
  });
}
