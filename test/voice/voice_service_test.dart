import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:voice_chat_room/features/voice/services/voice_service.dart';
import 'package:voice_chat_room/features/voice/services/voice_token_client.dart';
import 'package:voice_chat_room/features/voice/services/zego_voice_service.dart';

void main() {
  test('ZegoVoiceService stays behind provider-neutral VoiceService', () async {
    final VoiceService service = ZegoVoiceService(
      tokenClient: VoiceTokenClient(
        idTokenProvider: () async => 'test-token',
        client: MockClient((_) async => http.Response('{}', 500)),
      ),
    );
    expect(service, isA<VoiceService>());
    await service.dispose();
  });

  test('voice token client parses authenticated backend session', () async {
    final client = VoiceTokenClient(
      baseUrl: 'https://example.test/api',
      idTokenProvider: () async => 'firebase-id-token',
      client: MockClient((request) async {
        expect(request.headers['authorization'], 'Bearer firebase-id-token');
        expect(jsonDecode(request.body)['roomId'], 'room_123');
        return http.Response(
          jsonEncode({
            'ok': true,
            'appId': 123456,
            'token': '04token',
            'userId': 'u_abc',
            'roomId': 'room_123',
            'expiresAt': 2000000000,
          }),
          200,
          headers: {'content-type': 'application/json'},
        );
      }),
    );

    final session = await client.createSession('room_123');
    expect(session.appId, 123456);
    expect(session.userId, 'u_abc');
    expect(session.roomId, 'room_123');
    expect(session.token, '04token');
    client.close();
  });

  test('existing ZEGO streams wait for completed room login', () {
    final source = File(
      'lib/features/voice/services/zego_voice_service.dart',
    ).readAsStringSync();
    // Initial stream callbacks are allowed to arrive before loginRoom ends.
    // Playback must queue there rather than attempt a premature SDK call.
    expect(source, contains('unawaited(_startRemoteAudio(roomID, stream.streamID));'));
    expect(source, contains('unawaited(_resumeRemoteAudio(roomId));'));
    expect(source, contains('await _resumeRemoteAudio(_roomId!);'));
    final loginSuccess = source.indexOf('_joined = true;');
    final initialResume = source.indexOf('unawaited(_resumeRemoteAudio(roomId));');
    expect(initialResume, greaterThan(loginSuccess));
  });

  test('web startup does not delete all application caches per reload', () {
    final html = File('web/index.html').readAsStringSync();
    expect(html, contains('flutter_bootstrap.js'));
    expect(html, isNot(contains('caches.delete(')));
    expect(html, isNot(contains('serviceWorker.getRegistrations()')));
  });
}
