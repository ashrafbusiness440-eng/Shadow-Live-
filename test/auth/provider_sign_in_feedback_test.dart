import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/auth/services/provider_sign_in_feedback.dart';

void main() {
  FirebaseAuthException authError(String code, [String? message]) =>
      FirebaseAuthException(code: code, message: message);

  test('missing OAuth initial state has actionable Arabic recovery', () {
    final message = providerSignInErrorMessage(
      'Google',
      authError('internal-error',
          'Unable to process request due to missing initial state. '
          'The sessionStorage may be inaccessible.'),
    );
    expect(message, contains('جلسة تسجيل الدخول'));
    expect(message, contains('Chrome'));
    expect(message.contains('Exception:'), isFalse);
  });

  test('popup blocked and domain problems do not become raw errors', () {
    final blocked = providerSignInErrorMessage(
      'Facebook', authError('popup-blocked'),
    );
    final domain = providerSignInErrorMessage(
      'Google', authError('unauthorized-domain'),
    );
    expect(blocked, contains('النوافذ المنبثقة'));
    expect(domain, contains('الإدارة'));
  });

  test('network failure and unknown errors use readable guidance', () {
    final offline = providerSignInErrorMessage(
      'Apple', authError('network-request-failed'),
    );
    final unexpected = providerSignInErrorMessage(
      'Google', authError('internal-error', 'Raw internal exception'),
    );
    expect(offline, contains('الإنترنت'));
    expect(unexpected, contains('تعذّر تسجيل الدخول بواسطة Google'));
    expect(unexpected.contains('Raw internal exception'), isFalse);
  });
}
