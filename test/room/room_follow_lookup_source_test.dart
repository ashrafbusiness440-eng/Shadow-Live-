import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('follow lookup reuses one bounded room realtime service', () {
    final source = File(
      'lib/features/room/services/room_realtime_query_service.dart',
    ).readAsStringSync();
    expect(source.contains('class RoomFollowLocation'), isTrue);
    expect(source.contains('Future<Map<String, RoomFollowLocation>> resolveRoomFollows('), isTrue);
    expect(source.contains("'action': 'resolveRoomFollows'"), isTrue);
    expect(source.contains('.take(8)'), isTrue);
    expect(source.contains("_auth.currentUser?.uid != userUid"), isTrue);
    expect(source.contains('Timer.periodic('), isFalse);
    expect(source.contains('.snapshots()'), isFalse);
    expect(source.contains('requiresPassword: data[\'requiresPassword\'] == true'),
        isTrue);
  });
}
