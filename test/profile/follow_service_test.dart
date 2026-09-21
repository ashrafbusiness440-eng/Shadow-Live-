import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/profile/services/follow_service.dart';

void main() {
  test('follow relation id is deterministic and directional', () {
    expect(FollowService.relationId('alice', 'bob'), 'alice__bob');
    expect(FollowService.relationId('bob', 'alice'), 'bob__alice');
    expect(
      FollowService.relationId('alice', 'bob'),
      isNot(FollowService.relationId('bob', 'alice')),
    );
  });
}
