import 'dart:io';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('Android push permission is explicit, with a single global owner', () {
    final source = File(
      'lib/features/chat/services/private_call_push_service.dart',
    ).readAsStringSync();
    expect(source, contains('static final instance = PrivateCallPushService._();'));
    expect(source, contains('bool get supported =>'));
    expect(source, contains('defaultTargetPlatform == TargetPlatform.android'));
    expect(source, contains("DefaultFirebaseOptions.androidMessagingConfigured"));
    expect(source, contains('Future<void> enableForCurrentUser() async'));
    expect(source, contains('_messaging.requestPermission('));
    expect(source, contains('privateCallPushOptIn'));
    expect(source, contains('Future<void> disableForCurrentUser() async'));
    expect(source, contains("'privateCallPushOptIn': false"));
    expect(source, contains("'privateCallPushOptIn': true"));
    expect(source, contains("'action': action, 'token': token,"));
    expect(source, contains("'platform': kIsWeb ? 'web' : 'android'"));
    expect(source, contains('_accountQueue = _accountQueue.then('));
    expect(source, contains('_messaging.deleteToken()'));
    expect(source, contains('onTokenRefresh.listen('));
    expect(source, isNot(contains('Timer.periodic(')));
  });

  test('notification data is a pointer, not trusted as authorization', () {
    final source = File(
      'lib/features/chat/services/private_call_push_service.dart',
    ).readAsStringSync();
    expect(source, contains('await signaling.get(actorUid: uid, callId: callId)'));
    expect(source, contains("state.status != 'ringing'"));
    expect(source, contains('PrivateCallIncomingDialog('));
    expect(source, contains("foreground: false"));
    expect(source, contains('onMessageOpenedApp.listen('));
    expect(source, contains('getInitialMessage()'));
    expect(source, contains('FirebaseAuth.instance.currentUser?.uid != uid'));
    expect(source, contains('if (_displayedCallId != null ||'));
  });

  test('system-wide incoming call channel and settings are wired', () {
    final main = File('lib/main.dart').readAsStringSync();
    final manifest = File(
      'android/app/src/main/AndroidManifest.xml',
    ).readAsStringSync();
    final page = File(
      'lib/screens/settings/private_call_privacy_settings_screen.dart',
    ).readAsStringSync();
    expect(main, contains('PrivateCallPushService.instance.start()'));
    expect(main, contains('if (!e2eTest && !e2eRoomTest)'));
    expect(manifest, contains('android.permission.POST_NOTIFICATIONS'));
    expect(manifest, contains('shadow_private_calls'));
    expect(page, contains('تنبيهات المكالمات على هذا الجهاز'));
    expect(page, contains('PrivateCallPushService.instance.supported'));
    expect(page, contains('enableForCurrentUser()'));
    expect(page, contains('disableForCurrentUser()'));
    expect(page, contains('تنبيهات الويب وPWA تحتاج إعداد VAPID'));
  });

  test('Android Firebase App ID remains gated until native registration', () {
    final config = File('lib/firebase_options.dart').readAsStringSync();
    final source = File(
      'lib/features/chat/services/private_call_push_service.dart',
    ).readAsStringSync();
    expect(config, contains("'SHADOW_FIREBASE_ANDROID_APP_ID'"));
    expect(config, contains("'SHADOW_FIREBASE_ANDROID_API_KEY'"));
    expect(config, contains('androidMessagingConfigured'));
    expect(config, contains('1:463485983128:web:88c4953fa80d566c7a73ed'));
    expect(source, contains('DefaultFirebaseOptions.androidMessagingConfigured'));
    final nativePattern = RegExp(r'^1:463485983128:android:[0-9a-fA-F]+$');
    expect(nativePattern.hasMatch('1:463485983128:web:88c4953fa80d566c7a73ed'), false);
    expect(nativePattern.hasMatch('1:463485983128:android:aabbccddeeff0011'), true);
    expect(nativePattern.hasMatch('1:999999:android:aabbccddeeff0011'), false);
  });

  test('server never sends on stale tokens after explicit opt-out', () {
    final src = File(
      'cloudflare-worker/src/private-call-push.js',
    ).readAsStringSync();
    expect(src, contains('account.data?.privateCallPushOptIn !== true'));
    expect(src, contains('PRIVATE_CALL_MEDIA_READY === "true"'));
    expect(src, contains('PRIVATE_CALL_PUSH_READY === "true"'));
    expect(src, contains('maxDevices = 4'));
  });
}
