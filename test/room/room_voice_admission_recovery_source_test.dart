import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  final screen = File('lib/main.dart').readAsStringSync();
  final controller =
      File('lib/features/voice/services/voice_room_session_controller.dart')
          .readAsStringSync();
  final visual = File('.github/scripts/e2e_voice_room.mjs').readAsStringSync();

  test('inactive audio admission cannot be misreported as a realtime ticket failure', () {
    final recover = screen.substring(
      screen.indexOf('Future<void> _recoverRoomConnection() async {'),
      screen.indexOf('Widget _buildVoiceAdmissionErrorBanner()',),
    );
    expect(recover, contains('if (!mounted || _roomRecoveryInFlight) return;'));
    expect(recover, contains('if (!_voiceSession.active) {'));
    expect(recover, contains('await _connectVoice();'));
    expect(recover.indexOf('await _connectVoice();'),
        lessThan(recover.indexOf('await _voiceSession.ensureRoomPresenceReady();')));
    expect(recover, contains('roomVoiceAdmissionDiagnostic'));
    expect(recover, contains('roomPresenceDiagnostic'));
    expect(recover, contains('ClipboardData(text: code)'));
    expect(recover, contains('if (mounted) setState(() => _roomRecoveryInFlight = false);'));
    expect(recover, isNot(contains('Timer.periodic')));
  });

  test('failed voice admission is visible with a single retry action', () {
    expect(screen, contains("Key('room-voice-admission-error')"));
    expect(screen, contains("Key('room-voice-admission-retry')"));
    expect(screen, contains('لم يكتمل دخول الصوت إلى الغرفة'));
    expect(screen, contains('onPressed: _roomRecoveryInFlight ? null'));
    expect(screen, contains('_buildVoiceAdmissionErrorBanner(),'));
    expect(screen, contains("onPressed: _roomRecoveryInFlight ? null"));
  });

  test('voice error is typed and sanitized; retries wait for previous leave', () {
    expect(controller, contains('String get roomVoiceAdmissionDiagnostic'));
    expect(controller, contains('error is VoiceException'));
    expect(controller, contains('error is StateError'));
    expect(controller, contains("_lastVoiceAdmissionCode = 'connecting';"));
    expect(controller, contains('_lastVoiceAdmissionCode = _safeVoiceAdmissionCode(error)'));
    expect(controller, contains('if (pendingLeave != null) await pendingLeave;'));
    expect(controller, contains("throw StateError('account_changed')"));
  });

  test('browser screenshots exercise failed admission on repeated app launches', () {
    expect(visual, contains("name: '10-voice-admission-failed'"));
    expect(visual, contains('room_stage_join_failed:'));
    expect(visual, contains('repeat <= 3'));
    expect(visual, contains('stage-admission-failed-repeat-'));
  });
}
