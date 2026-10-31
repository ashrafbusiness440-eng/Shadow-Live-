import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/voice/services/zego_login_identity.dart';

void main() {
  const authorized = 'u_0123456789abcdef0123456789abcdef01234567';

  test('plain ASCII nickname is preserved for ZEGO voice login', () {
    expect(zegoSdkLoginName('  SHADOW_183  ', authorized), 'SHADOW_183');
  });

  test('Arabic names, emoji and decorative nicknames use safe authorized identity', () {
    expect(zegoSdkLoginName('أشرف', authorized), authorized);
    expect(zegoSdkLoginName('SHADOW 👑', authorized), authorized);
    expect(zegoSdkLoginName('✦Shadow✦', authorized), authorized);
    expect(zegoSdkLoginName('', authorized), authorized);
    expect(zegoSdkLoginName(List<String>.filled(256, 'X').join(), authorized), authorized);
  });

  test('a forged or malformed transport identity cannot be passed to ZEGO', () {
    expect(() => zegoSdkLoginName('SHADOW', 'not safe uid'), throwsFormatException);
    expect(() => zegoSdkLoginName('SHADOW', ''), throwsFormatException);
    expect(
      () => zegoSdkLoginName('SHADOW', 'u_' + List<String>.filled(64, 'x').join()),
      throwsFormatException,
    );
  });

  test('only ZEGO numeric codes are exposed for diagnosis, never token or ID', () {
    expect(zegoLoginDiagnostic(1002009), 'zego_login_1002009');
    expect(zegoLoginDiagnostic(1002033), 'zego_login_1002033');
    expect(zegoLoginDiagnostic(1102016), 'zego_login_1102016');
    expect(zegoLoginDiagnostic(1002001), 'zego_login_1002001');
    expect(zegoLoginDiagnostic(1102018), 'zego_login_1102018');
    expect(zegoLoginDiagnostic(-5), 'zego_login_negative_5');
    expect(zegoLoginDiagnostic(0), 'zego_login_unknown');
    expect(
      zegoLoginDiagnostic(1002033, privateCall: true),
      'zego_call_login_1002033',
    );
  });

  test('public rooms and private calls use the same safe transport identity', () {
    final source = File(
      'lib/features/voice/services/zego_voice_service.dart',
    ).readAsStringSync();
    expect(source, contains('zegoSdkLoginName(displayName, session.userId)'));
    expect(source, contains('zegoSdkLoginName(displayName, media.userId)'));
    expect(source, contains('zegoLoginDiagnostic(result.errorCode)'));
    expect(source, contains('zegoLoginDiagnostic(result.errorCode, privateCall: true)'));
    expect(source, isNot(contains('ZegoUser(session.userId, displayName)')));
    expect(source, isNot(contains("'zego_login_failed',")));
    // Existing scoped voice-session tokens and ZEGO cleanup must remain.
    expect(source, contains('_tokenClient.createSession('));
    expect(source, contains('await ZegoExpressEngine.instance.logoutRoom(roomId)'));
  });
}
