import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/auth/services/auth_login_config.dart';

void main() {
  test('auth login config defaults keep only approved launch providers on', () {
    const config = AuthLoginConfig.defaults;
    expect(config.email, isTrue);
    expect(config.google, isTrue);
    expect(config.guest, isTrue);
    expect(config.phone, isFalse);
    expect(config.facebook, isFalse);
    expect(config.apple, isFalse);
    expect(config.optionalAccountLinking, isFalse);
  });

  test('auth login config maps provider toggles and optional linking', () {
    final config = AuthLoginConfig.fromMap({
      'providers': {
        'email': false,
        'google': true,
        'guest': false,
        'phone': true,
        'facebook': true,
        'apple': false,
      },
      'optionalAccountLinking': true,
    });

    expect(config.providerEnabled('email'), isFalse);
    expect(config.providerEnabled('phone'), isTrue);
    expect(config.providerEnabled('facebook'), isTrue);
    expect(config.optionalAccountLinking, isTrue);
  });
}
