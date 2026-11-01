import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  final presence = File(
    'lib/features/room/services/room_presence_service.dart',
  ).readAsStringSync();
  final session = File(
    'lib/features/voice/services/voice_room_session_controller.dart',
  ).readAsStringSync();
  final screen = File('lib/main.dart').readAsStringSync();
  final browserSmoke = File(
    'cloudflare-worker/scripts/room-gift-e2e.mjs',
  ).readAsStringSync();

  test('realtime diagnostic distinguishes ticket, socket and ready without sensitive data', () {
    final connect = presence.substring(
      presence.indexOf('Future<void> _connect('),
      presence.indexOf('Future<void> join(String roomId, {String? roomPassword})'),
    );
    expect(connect, contains("var failureStage = 'ticket';"));
    expect(connect, contains("failureStage = 'socket';"));
    expect(connect, contains("failureStage = 'ready';"));
    expect(connect, contains('_lastFailureStage = failureStage;'));
    expect(presence, contains("String get connectionDiagnostic"));
    expect(presence, contains("unexpected_failure"));
    expect(presence, contains("RegExp(r'^[a-z][a-z0-9_]{0,63}\$')"));
    expect(session, contains('roomPresenceDiagnostic => _presenceService.connectionDiagnostic'));
  });

  test('manual recovery exposes one copyable diagnostic but no token or room URL', () {
    final start = screen.indexOf("tooltip: 'إعادة اتصال الموجودين'");
    final end = screen.indexOf("const SizedBox(width: 8),", start);
    expect(start, greaterThanOrEqualTo(0));
    final recovery = screen.substring(start, end);
    expect(recovery, contains('_recoverRoomConnection()'));
    expect(recovery, contains('_roomRecoveryInFlight ? null'));
    final unifiedStart = screen.indexOf('Future<void> _recoverRoomConnection() async {');
    final unifiedEnd = screen.indexOf('Widget _buildVoiceAdmissionErrorBanner()', unifiedStart);
    final unified = screen.substring(unifiedStart, unifiedEnd);
    expect(unified, contains('ensureRoomPresenceReady()'));
    expect(unified, contains('_voiceSession.roomPresenceDiagnostic'));
    expect(unified, contains('roomVoiceAdmissionDiagnostic'));
    expect(unified, contains("label: 'نسخ الرمز'"));
    expect(unified, contains('ClipboardData(text: code)'));
    expect(recovery, isNot(contains('getIdToken')));
    expect(recovery, isNot(contains('socketPath')));
  });

  test('production browser probe uses isolated live room fixture and no extra polling', () {
    expect(browserSmoke, contains('async function verifyBrowserRoomRealtime('));
    expect(browserSmoke, contains('await verifyBrowserRoomRealtime(roomId,senderToken);'));
    expect(browserSmoke, contains('await page.goto("https://ashrafbusiness440-eng.github.io/Shadow-Live-/"'));
    expect(browserSmoke, contains('parsed.type==="server.ready"'));
    expect(browserSmoke, contains('await browser.close()'));
    expect(browserSmoke, isNot(contains('setInterval(')));
  });
}
