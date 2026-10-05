import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('public profile exposes a reusable diaries tab', () {
    final profile = File(
      'lib/features/profile/screens/public_profile_screen.dart',
    ).readAsStringSync();
    final diaries = File(
      'lib/features/diaries/screens/diaries_screen.dart',
    ).readAsStringSync();

    expect(profile.contains('TabController(length: 4'), isTrue);
    expect(profile.contains("Tab(text: 'يومياتي')"), isTrue);
    expect(profile.contains('profileUserId: widget.userId'), isTrue);
    expect(profile.contains('embedded: true'), isTrue);

    expect(diaries.contains('final String? profileUserId;'), isTrue);
    expect(diaries.contains('final bool embedded;'), isTrue);
    expect(diaries.contains('await _service.listUser('), isTrue);
    expect(diaries.contains("if (!_profileMode) _composer()"), isTrue);
    expect(diaries.contains("if (!_profileMode) _feedSelector()"), isTrue);
  });

  test('public profile feed stays bounded and reuses listUser backend', () {
    final service = File(
      'lib/features/diaries/services/diary_service.dart',
    ).readAsStringSync();
    final backend = File(
      'cloudflare-worker/src/diaries.js',
    ).readAsStringSync();

    expect(service.contains("Future<DiaryPage> listUser("), isTrue);
    expect(service.contains("'action': action"), isTrue);
    expect(service.contains("'userId': normalizedUserId"), isTrue);
    expect(service.contains("'limit': limit"), isTrue);

    expect(backend.contains('async function listUser(db, body)'), isTrue);
    expect(
      backend.contains(r'const collectionPath = `users/${userId}/diaries`;'),
      isTrue,
    );
    expect(backend.contains('limit: limit + 1'), isTrue);
    expect(backend.contains('if (action === "listUser")'), isTrue);
  });

  test('guest can browse but all profile interactions use login CTA', () {
    final profile = File(
      'lib/features/profile/screens/public_profile_screen.dart',
    ).readAsStringSync();
    final diaries = File(
      'lib/features/diaries/screens/diaries_screen.dart',
    ).readAsStringSync();
    final backend = File(
      'cloudflare-worker/src/diaries.js',
    ).readAsStringSync();

    expect(profile.contains('bool get _guest'), isTrue);
    expect(profile.contains("context.read<AuthBloc>().add(SignOutRequested())"), isTrue);
    expect(profile.contains('if (_guest)'), isTrue);

    expect(diaries.contains("title: const Text('تسجيل الدخول')"), isTrue);
    expect(diaries.contains("context.read<AuthBloc>().add(SignOutRequested())"), isTrue);
    expect(diaries.contains('if (_guest || !_signedIn)'), isTrue);

    final listUserIndex = backend.indexOf('if (action === "listUser")');
    final guestGuardIndex = backend.indexOf('if (auth.guest)');
    expect(listUserIndex, greaterThanOrEqualTo(0));
    expect(guestGuardIndex, greaterThan(listUserIndex));
  });

  test('profile mode does not duplicate diary cards or backend endpoints', () {
    final diaries = File(
      'lib/features/diaries/screens/diaries_screen.dart',
    ).readAsStringSync();
    final tree = Directory('lib/features/diaries/widgets')
        .listSync()
        .whereType<File>()
        .map((file) => file.path)
        .toList();

    expect(diaries.contains('Widget _diaryCard(DiaryItem item)'), isTrue);
    expect(diaries.contains('_profileItems = _merge('), isTrue);
    expect(
      tree.any((path) => path.endsWith('public_profile_diary_card.dart')),
      isFalse,
    );
  });
}
