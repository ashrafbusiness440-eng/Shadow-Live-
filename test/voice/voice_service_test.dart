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


  test('failed public ZEGO login attempts bounded logout before state reset', () {
    final source = File(
      'lib/features/voice/services/zego_voice_service.dart',
    ).readAsStringSync();
    final begin = source.indexOf('Future<void> joinRoom({');
    final end = source.indexOf('/// Private 1:1 audio', begin);
    expect(begin, greaterThanOrEqualTo(0));
    expect(end, greaterThan(begin));
    final join = source.substring(begin, end);

    // Token-fetch and engine-creation failures must not log out an SDK room
    // which was never attempted; SDK login failures must clean up.
    final loginMarker = join.indexOf('loginStarted = true;');
    final nativeLogin = join.indexOf(
      'final result = await ZegoExpressEngine.instance.loginRoom(',
    );
    final failureHandler = join.indexOf('} catch (error) {');
    final logout = join.indexOf(
      'await ZegoExpressEngine.instance.logoutRoom(roomId);',
      failureHandler,
    );
    final stateReset = join.indexOf('_roomId = null;', failureHandler);
    expect(join, contains('var loginStarted = false;'));
    expect(loginMarker, greaterThanOrEqualTo(0));
    expect(nativeLogin, greaterThan(loginMarker));
    expect(join, contains('if (loginStarted && _roomId == roomId) {'));
    expect(logout, greaterThan(failureHandler));
    expect(stateReset, greaterThan(logout));
    expect(join, contains("if (logoutFailure != null) {"));
    expect(join, contains("'zego_login_cleanup_failed'"));
  });

  test('failed private ZEGO login never hides a failed SDK logout', () {
    final source = File(
      'lib/features/voice/services/zego_voice_service.dart',
    ).readAsStringSync();
    final begin = source.indexOf('Future<void> joinPrivateCall({');
    final end = source.indexOf('bool get privateCallAudioActive', begin);
    expect(begin, greaterThanOrEqualTo(0));
    expect(end, greaterThan(begin));
    final join = source.substring(begin, end);
    final failureHandler = join.indexOf('} catch (error) {');
    final sdkLogout = join.indexOf(
      'await ZegoExpressEngine.instance.logoutRoom(failedCallRoomId);',
      failureHandler,
    );
    final localReset = join.indexOf('_roomId = null;', failureHandler);
    expect(join, contains('var loginStarted = false;'));
    expect(join, contains('failedCallRoomId == media.roomId'));
    expect(sdkLogout, greaterThan(failureHandler));
    expect(localReset, greaterThan(sdkLogout));
    expect(join, contains('logoutFailure = failure;'));
    expect(join, contains("if (logoutFailure != null) {"));
    expect(join, contains("'zego_call_login_cleanup_failed'"));
    // The old implementation suppressed a real failed logout.
    expect(join, isNot(contains('logoutRoom(_roomId);')));
  });

  test('ZEGO room cleanup always attempts logout after a stream stop failure', () {
    final source = File(
      'lib/features/voice/services/zego_voice_service.dart',
    ).readAsStringSync();
    final start = source.indexOf('Future<void> leaveRoom() async {');
    final end = source.indexOf('ZegoVoiceChangerPreset _zegoVoiceChangerPreset', start);
    expect(start, greaterThanOrEqualTo(0));
    expect(end, greaterThan(start));
    final cleanup = source.substring(start, end);

    // Close out the SDK session even if media or a particular speaker's
    // stop fails. A dangling room would block the next call or room.
    expect(cleanup, contains('final leavingRoomId = _roomId;'));
    expect(cleanup, contains('await stopLocalEffect();'));
    expect(cleanup, contains('await stopRoomMedia();'));
    expect(
      RegExp(
        r'for \(final streamId in List<String>\.from\(_playingStreams\)\) '
        r'\{\s*try \{\s*await ZegoExpressEngine\.instance'
        r'\.stopPlayingStream\(streamId\);\s*\} catch \(_\) \{\}',
      ).hasMatch(cleanup),
      isTrue,
    );
    expect(
      cleanup,
      contains('await ZegoExpressEngine.instance.logoutRoom(leavingRoomId);'),
    );
    expect(
      cleanup.indexOf('logoutRoom(leavingRoomId)'),
      greaterThan(cleanup.indexOf('stopPlayingStream(streamId)')),
    );
    expect(
      cleanup,
      contains('} finally {\n      try {\n'
          '        // Unlike optional stop failures'),
    );
    expect(cleanup, contains('_playingStreams.clear();'));
    expect(cleanup, contains('_publishingForRoomMedia = false;'));
  });

  test('room controller propagates failed ZEGO logout after resetting UI', () {
    final source = File(
      'lib/features/voice/services/voice_room_session_controller.dart',
    ).readAsStringSync();
    final begin = source.indexOf('Future<void> _leaveRoomSession() async {');
    final end = source.indexOf('Future<void> shutdown() async {', begin);
    expect(begin, greaterThanOrEqualTo(0));
    expect(end, greaterThan(begin));
    final leaving = source.substring(begin, end);
    final voiceExit = leaving.indexOf('await _voiceService.leaveRoom();');
    final caughtError = leaving.indexOf('voiceLogoutFailure = error;');
    final reset = leaving.indexOf('_active = false;', caughtError);
    final state = leaving.indexOf(
      "_error = voiceLogoutFailure == null ? null : 'voice_session_cleanup_failed';",
    );
    final notified = leaving.indexOf('notifyListeners();', reset);
    final propagationIndex = leaving.indexOf('Error.throwWithStackTrace(');
    expect(voiceExit, greaterThanOrEqualTo(0));
    expect(caughtError, greaterThan(voiceExit));
    expect(reset, greaterThan(caughtError));
    expect(state, greaterThan(reset));
    expect(propagationIndex, greaterThan(notified));
    expect(leaving, contains('VoiceConnectionState.failed;'));
    expect(leaving, isNot(contains('catch (_) {}\n    }\n    _active = false;')));

    // Auth changes and terminal callbacks are fire-and-forget. They must
    // observe leave errors without changing explicit handoff fail-closed.
    expect(source, contains('unawaited(_leaveAfterTerminalSignal());'));
    expect(source, contains('Future<void> _leaveAfterTerminalSignal() async {'));
  });

  test('shutdown attempts all voice resources after native logout failure', () {
    final source = File(
      'lib/features/voice/services/voice_room_session_controller.dart',
    ).readAsStringSync();
    final start = source.indexOf('Future<void> shutdown() async {');
    expect(start, greaterThanOrEqualTo(0));
    final shutdown = source.substring(start);
    final leave = shutdown.indexOf('await attempt(leave);');
    final cancel = shutdown.indexOf('_authSubscription?.cancel()');
    final engine = shutdown.indexOf('await attempt(_voiceService.dispose);');
    final presence = shutdown.indexOf('_presenceService.close();');
    final cleared = shutdown.indexOf('_serviceInitialized = false;');
    final error = shutdown.indexOf('Error.throwWithStackTrace(');
    expect(shutdown, contains('firstFailure ??= error;'));
    expect(shutdown, contains('firstFailureTrace ??= trace;'));
    expect(leave, greaterThanOrEqualTo(0));
    expect(cancel, greaterThan(leave));
    expect(engine, greaterThan(cancel));
    expect(presence, greaterThan(engine));
    expect(cleared, greaterThan(presence));
    expect(error, greaterThan(cleared));
    expect(shutdown, contains('await attempt(() async => await _roomBanSubscription?.cancel());'));
    expect(shutdown, contains('await attempt(() async => await _roomModerationSubscription?.cancel());'));
    expect(shutdown, contains('_effectSoundHttp.close();'));
  });

  test('web startup does not delete all application caches per reload', () {
    final html = File('web/index.html').readAsStringSync();
    expect(html, contains('flutter_bootstrap.js'));
    expect(html, isNot(contains('caches.delete(')));
    expect(html, isNot(contains('serviceWorker.getRegistrations()')));
  });
}
