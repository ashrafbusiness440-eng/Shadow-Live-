import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('normal profile identity path is not overridden by mysterious mode', () {
    final visualIdentity = File(
      'lib/features/profile/services/profile_visual_identity_service.dart',
    ).readAsStringSync();
    final publicProfile = File(
      'lib/features/profile/screens/public_profile_screen.dart',
    ).readAsStringSync();

    expect(visualIdentity.contains('mysteriousMode'), isFalse);
    expect(visualIdentity.contains('mysteriousId'), isFalse);
    expect(publicProfile.contains('mysteriousMode'), isFalse);
  });

  test('mysterious room supporter UI does not require a real uid', () {
    final widget = File(
      'lib/features/mysterious/widgets/mysterious_identity_widgets.dart',
    ).readAsStringSync();
    final room = File('lib/main.dart').readAsStringSync();

    expect(widget.contains('userId'), isFalse);
    expect(
      room.contains('supporter.mysteriousMode'),
      isTrue,
    );
    expect(
      room.contains('showMysteriousIdentitySheet('),
      isTrue,
    );
  });
}
