import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/room/services/room_realtime_query_service.dart';

void main() {
  test('verified live counts preserve real zero and restrict requested rooms', () {
    final counts = verifiedRoomPresenceCounts(
      {'room1': 0, 'room2': 12, 'hidden': 50},
      ['room1', 'room2'],
    );
    expect(counts, {'room1': 0, 'room2': 12});
    expect(counts.containsKey('hidden'), isFalse);
  });

  test('unknown, negative and non-numeric results are not rendered as zero', () {
    final counts = verifiedRoomPresenceCounts(
      {'ok': 3, 'bad': '0', 'negative': -1, 'null': null},
      ['ok', 'bad', 'negative', 'null', 'missing'],
    );
    expect(counts, {'ok': 3});
    expect(counts.containsKey('missing'), isFalse);
    expect(verifiedRoomPresenceCounts(null, ['ok']), isEmpty);
    expect(verifiedRoomPresenceCounts([], ['ok']), isEmpty);
  });
}
