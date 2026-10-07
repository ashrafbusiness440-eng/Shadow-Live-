import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('room supporters never open real profile for mysterious identity', () {
    final main = File('lib/main.dart').readAsStringSync();
    final model = File(
      'lib/features/room/services/room_insights_service.dart',
    ).readAsStringSync();
    final widget = File(
      'lib/features/mysterious/widgets/mysterious_identity_widgets.dart',
    ).readAsStringSync();

    expect(model.contains('mysteriousMode'), isTrue);
    expect(model.contains('mysteriousId'), isTrue);

    expect(main.contains('supporter.mysteriousMode'), isTrue);
    expect(main.contains('showMysteriousIdentitySheet('), isTrue);
    expect(main.contains('MysteriousIdentityAvatar'), isTrue);
    expect(widget.contains('userId'), isFalse);
    expect(widget.contains('FirebaseFirestore'), isFalse);
    expect(widget.contains('الشخص الغامض'), isTrue);
  });
}
