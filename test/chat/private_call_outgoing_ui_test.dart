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

  test('outbound call uses same idempotent key and no duplicate engine', () {
    final ui = File(
      'lib/features/chat/widgets/private_call_outgoing_dialog.dart',
    ).readAsStringSync();
    expect(ui, contains("idempotencyKey: _key"));
    expect(ui, contains('_voice.enterPrivateCallMedia('));
    expect(ui, contains('await _client.mediaSession('));
    expect(ui, contains('await _client.renew('));
    expect(ui, contains('await _voice.exitPrivateCallMedia();'));
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
    expect(ui, contains('barrierDismissible: false') , isFalse);
    expect(ui, contains('onWillPop: () async { await _end(); return false; }'));
  });
}
