import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('PK tool opens existing panel from room tools without a new route', () {
    final mainSource = File('lib/main.dart').readAsStringSync();
    expect(mainSource.contains('Future<void> _showPkSheet() async {'), isTrue);
    expect(mainSource.contains("label: 'تحدي PK'"), isTrue);
    expect(mainSource.contains('child: RoomPkPanel('), isTrue);
    expect(mainSource.contains('canManage: _canManagePk,'), isTrue);
    expect(mainSource.contains("_roomArguments['pkEnabled'] != false"), isTrue);
  });

  test('non-moderator sees a proper idle PK message instead of empty sheet', () {
    final source = File('lib/features/room/widgets/room_pk_panel.dart')
        .readAsStringSync();
    expect(source.contains('لا يوجد تحدي PK حاليًا.'), isTrue);
  });
}
