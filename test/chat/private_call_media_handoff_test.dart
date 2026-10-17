import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:voice_chat_room/features/chat/services/private_call_signaling_client.dart';

const callId = 'abcdef0123456789abcdef0123456789';

Map<String, dynamic> validMedia() => {
  'ok': true,
  'callId': callId,
  'status': 'active',
  'appId': 55555,
  'roomId': 'private_call_$callId',
  'userId': 'u_${'a' * 40}',
  'streamId': 'private_call_${callId}_u_${'a' * 40}',
  'token': '04abcdefghijklmnopqrstuvwxyz1234567890',
  'expiresAt': DateTime.now().millisecondsSinceEpoch ~/ 1000 + 300,
};

void main() {
  test('only an active scoped credential with matching call room and user stream is accepted', () {
    final media = PrivateCallMediaCredentials.fromJson(validMedia(), callId);
    expect(media.roomId, 'private_call_$callId');
    expect(media.streamId, '${media.roomId}_${media.userId}');
    expect(media.expiresAt.isAfter(DateTime.now()), true);
    for (final bad in <Map<String, dynamic>>[
      {...validMedia(), 'roomId': 'ordinary_room'},
      {...validMedia(), 'streamId': 'other-user-stream'},
      {...validMedia(), 'status': 'ringing'},
      {...validMedia(), 'callId': 'not-the-call-id'},
      {...validMedia(), 'expiresAt': 1},
      {...validMedia(), 'token': ''},
    ]) {
      expect(
        () => PrivateCallMediaCredentials.fromJson(bad, callId),
        throwsA(isA<PrivateCallSignalingException>()),
      );
    }
  });

  test('mediaSession asks only existing authenticated Worker route for exact call', () async {
    var count = 0;
    final client = PrivateCallSignalingClient(
      currentUid: () => 'alice',
      isAnonymous: () => false,
      idTokenProvider: () async => 'id-token',
      baseUrl: 'https://example.test/api',
      client: MockClient((req) async {
        count++;
        expect(req.url.path, '/api/private-call-signaling');
        expect(req.headers['authorization'], 'Bearer id-token');
        final body = jsonDecode(req.body) as Map<String, dynamic>;
        expect(body['action'], 'mediaSession');
        expect(body['callId'], callId);
        return http.Response(jsonEncode(validMedia()), 200);
      }),
    );
    final result = await client.mediaSession(actorUid: 'alice', callId: callId);
    expect(result.callId, callId);
    expect(count, 1);
    client.dispose();
  });

  test('call media cannot be activated on an anonymous user or switched account', () async {
    var attempted = 0;
    final client = PrivateCallSignalingClient(
      currentUid: () => 'bob',
      isAnonymous: () => true,
      idTokenProvider: () async => 'id-token',
      client: MockClient((req) async {
        attempted++;
        return http.Response(jsonEncode(validMedia()), 200);
      }),
    );
    await expectLater(
      client.mediaSession(actorUid: 'bob', callId: callId),
      throwsA(isA<PrivateCallSignalingException>().having(
        (e) => e.code, 'code', 'registered_account_required',
      )),
    );
    expect(attempted, 0);
    client.dispose();
  });

  test('handoff reuses voice-room engine and cannot mix room/call audio', () {
    final controller = File(
      'lib/features/voice/services/voice_room_session_controller.dart',
    ).readAsStringSync();
    final zego = File(
      'lib/features/voice/services/zego_voice_service.dart',
    ).readAsStringSync();
    expect(controller, contains('await leave();'));
    expect(controller, contains('await engine.joinPrivateCall('));
    expect(controller, contains("throw StateError('voice_room_join_in_progress')"));
    expect(controller, contains("throw StateError('private_call_audio_active')"));
    expect(controller, contains('if (_active || _joining || _privateCallMediaActive)'));
    expect(zego, contains('await _ensureEngine(media.appId);'));
    expect(zego, contains('media.streamId'));
    expect(zego, contains('await unmuteMic();'));
    expect(zego, contains('await setPlaybackEnabled(true);'));
    expect(zego, contains("_callSignalingClient.mediaSession("));
    expect(zego, contains('media.roomId != roomId'));
    expect(zego, contains('await ZegoExpressEngine.instance.logoutRoom(_roomId);'));
  });
}
