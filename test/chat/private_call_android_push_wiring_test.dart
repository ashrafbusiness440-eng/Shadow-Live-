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
    expect(source, contains("DefaultFirebaseOptions.android.appId.contains(':android:')"));
    expect(source, contains('Future<void> enableForCurrentUser() async'));
    expect(source, contains('_messaging.requestPermission('));
    expect(source, contains('privateCallPushOptIn'));
    expect(source, contains('Future<void> disableForCurrentUser() async'));
    expect(source, contains("'privateCallPushOptIn': false"));
    expect(source, contains("'privateCallPushOptIn': true"));
    expect(source, contains("'action': action, 'token': token, 'platform': 'android'"));
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
    expect(page, contains('تنبيهات الويب وPWA تحتاج إعدادًا إضافيًا'));
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
