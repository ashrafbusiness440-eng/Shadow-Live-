import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('mysterious control uses central permissions and backend-only mutations', () {
    final page = File(
      'lib/admin/mysterious_person_control_page.dart',
    ).readAsStringSync();
    final main = File('lib/main_control.dart').readAsStringSync();
    final access = File(
      'lib/admin/user_access_control_card.dart',
    ).readAsStringSync();
    final backend = File(
      'cloudflare-worker/src/manage-user-access.js',
    ).readAsStringSync();

    expect(page.contains("shadowApiEndpoint('manage-mysterious-person')"), isTrue);
    expect(page.contains('controlGrant'), isTrue);
    expect(page.contains('controlRevoke'), isTrue);
    expect(page.contains('controlReveal'), isTrue);
    expect(page.contains('controlUpdatePrices'), isTrue);
    expect(page.contains('FirebaseFirestore'), isFalse);
    expect(page.contains('.snapshots()'), isFalse);

    expect(main.contains("ControlItem('الشخص الغامض'"), isTrue);
    expect(main.contains('MysteriousPersonControlPage'), isTrue);
    expect(access.contains("'manageMysteriousPerson'"), isTrue);
    expect(access.contains("'revealMysteriousIdentity'"), isTrue);
    expect(backend.contains('"manageMysteriousPerson"'), isTrue);
    expect(backend.contains('"revealMysteriousIdentity"'), isTrue);
  });
}
