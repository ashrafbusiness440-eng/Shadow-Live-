import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('notifications clear account state and reject late page responses', () {
    final source = File(
      'lib/features/notifications/screens/notifications_page.dart',
    ).readAsStringSync();

    expect(source.contains('StreamSubscription<User?>? _authSubscription;'), isTrue);
    expect(
      source.contains('FirebaseAuth.instance.authStateChanges().listen((user)'),
      isTrue,
    );
    expect(source.contains('_items.clear();'), isTrue);
    expect(source.contains('_page = null;'), isTrue);
    expect(source.contains('final epoch = ++_requestEpoch;'), isTrue);
    expect(
      RegExp(r'epoch != _requestEpoch').allMatches(source).length,
      greaterThanOrEqualTo(4),
    );
    expect(
      RegExp(r'requestUid != FirebaseAuth.instance.currentUser\\?\\.uid')
          .allMatches(source)
          .length,
      greaterThanOrEqualTo(4),
    );
    expect(source.contains('_authSubscription?.cancel()'), isTrue);
    expect(source.contains('_pageOwnerUid != FirebaseAuth.instance.currentUser?.uid'), isTrue);

    // Auth observes only the route. No per-notification streams or poll loops.
    expect(source.contains('Timer.periodic('), isFalse);
    expect(source.contains('for (final'), isFalse);
  });
}
