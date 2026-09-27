import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/room/services/room_rocket_service.dart';

void main() {
  test('RoomRocketEvent parses realtime payloads', () {
    final event = RoomRocketEvent.fromMap({
      'explosionId': 'exp-1',
      'roomId': 'room-1',
      'level': 2,
      'startsAtMs': 1000,
      'endsAtMs': 11000,
      'triggerUid': 'u1',
      'triggerDisplayName': 'Sender',
      'triggerProfileImageUrl': 'sender.webp',
      'contributorIds': ['u1', 'u2'],
      'top3': [
        {'uid': 'u1'},
        {'uid': 'u2'},
      ],
    });

    expect(event.id, 'exp-1');
    expect(event.roomId, 'room-1');
    expect(event.level, 2);
    expect(event.contributorIds, ['u1', 'u2']);
    expect(event.top3Ids, ['u1', 'u2']);
    expect(event.activeAt(5000), isTrue);
    expect(event.endedAt(11000), isTrue);
  });

  test('RoomRocketRequestException only retries transient conditions', () {
    expect(
      const RoomRocketRequestException(
        code: 'not_in_room',
        statusCode: 409,
        retryAfter: null,
      ).retryable,
      isTrue,
    );
    expect(
      const RoomRocketRequestException(
        code: 'reward_not_ready',
        statusCode: 409,
        retryAfter: Duration(seconds: 1),
      ).retryable,
      isTrue,
    );
    expect(
      const RoomRocketRequestException(
        code: 'firestore_quota_exhausted',
        statusCode: 503,
        retryAfter: Duration(seconds: 2),
      ).retryable,
      isTrue,
    );
    expect(
      const RoomRocketRequestException(
        code: 'not_eligible',
        statusCode: 409,
        retryAfter: null,
      ).retryable,
      isFalse,
    );
  });
}
