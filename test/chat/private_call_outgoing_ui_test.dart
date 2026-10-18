import 'dart:io';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('outbound calls are hidden unless explicitly enabled by control', () {
    final chat = File('lib/features/chat/screens/private_chat_screen.dart')
        .readAsStringSync();
    expect(chat, contains('bool _privateCallsEnabled = false;'));
    expect(chat, contains("setting.data()?['privateCallsEnabled'] == true"));
    expect(chat, contains('if (_privateCallsEnabled &&'));
    expect(chat, contains('!_safetyStatus.blocked'));
    expect(chat, contains('FirebaseAuth.instance.currentUser?.isAnonymous == false'));
    expect(chat, contains("tooltip: 'اتصال صوتي خاص'"));
  });

  test('outgoing hangup still finishes server call after ZEGO exit failure', () {
    final ui = File(
      'lib/features/chat/widgets/private_call_outgoing_dialog.dart',
    ).readAsStringSync();
    final start = ui.indexOf('Future<void> _end() async {');
    final end = ui.indexOf('void dispose()', start);
    expect(start, greaterThanOrEqualTo(0));
    expect(end, greaterThan(start));
    final hangup = ui.substring(start, end);
    final localExit = hangup.indexOf('await _voice.exitPrivateCallMedia();');
    final captured = hangup.indexOf('_localAudioCleanupFailed = true;');
    final serverFinish = hangup.indexOf('await _client.finish(');
    final warning = hangup.indexOf('if (_localAudioCleanupFailed) {');
    expect(captured, greaterThan(localExit));
    expect(serverFinish, greaterThan(captured));
    expect(warning, greaterThan(serverFinish));
    expect(ui, contains('bool _localAudioCleanupFailed = false;'));
    expect(hangup, contains('تعذر تأكيد توقف الصوت'));
    expect(hangup, contains('await starting.timeout(const Duration(seconds: 17));'));
  });

  test('outbound call uses same idempotent key and no duplicate engine', () {
    final ui = File(
      'lib/features/chat/widgets/private_call_outgoing_dialog.dart',
    ).readAsStringSync();
    expect(ui, contains("idempotencyKey: _key"));
    expect(ui, contains('_voice.enterPrivateCallMedia('));
    expect(ui, contains('await _client.mediaSession('));
    expect(ui, contains('await _client.renew('));
    expect(ui, contains('await _voice.exitPrivateCallMedia();'));
    expect(ui, contains('void _launchStart() {'));
    expect(ui, contains('_startInFlight = pending;'));
    expect(ui, contains('onPressed: _busy ? null : _launchStart'));
    expect(ui, contains('_joiningMedia = true;'));
    expect(ui, contains('if (!_closing) unawaited(_check());'));
    expect(ui, contains('const Duration(seconds: 3)'));
    expect(ui, contains('const Duration(seconds: 12)'));
    expect(ui, contains('_timer?.cancel();'));
    expect(ui, isNot(contains('ZegoExpressEngine.createEngine')));
  });

  test('call screen preserves Arabic cancel, error and retry interactions', () {
    final ui = File(
      'lib/features/chat/widgets/private_call_outgoing_dialog.dart',
    ).readAsStringSync();
    expect(ui, contains('جارٍ الاتصال وانتظار الرد'));
    expect(ui, contains('تعذر إجراء المكالمة'));
    expect(ui, contains('إنهاء المكالمة'));
    expect(ui, contains('إعادة المحاولة'));
    expect(ui.contains('barrierDismissible: false'), isFalse);
    expect(ui, contains('onWillPop: () async { await _end(); return false; }'));
  });
}
