import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('Live PWA push depends on VAPID and a scoped browser bridge', () {
    final service = File(
      'lib/features/chat/services/private_call_push_service.dart',
    ).readAsStringSync();
    final bridge = File(
      'lib/features/chat/services/private_call_web_push_web.dart',
    ).readAsStringSync();
    final page = File('scripts/app_index.html').readAsStringSync();
    final worker = File('web/firebase-messaging-sw.js').readAsStringSync();
    expect(service, contains('SHADOW_FIREBASE_WEB_VAPID_KEY'));
    expect(service, contains('_webVapidKey.isNotEmpty && web_push.supported'));
    expect(service, contains("if (kIsWeb) {"));
    expect(service, contains("web_push.getToken(_webVapidKey)"));
    expect(service, contains("web_push.consumeInitialCallId()"));
    expect(service, contains("web_push.deleteToken()"));
    expect(service, contains("await web_push.subscribe((data) {"));
    expect(service, contains("'platform': kIsWeb ? 'web' : 'android'"));
    expect(service, contains('await signaling.get(actorUid: uid, callId: callId)'));
    expect(service, contains('state.status != \'ringing\''));
    expect(bridge, contains("dart:js_interop"));
    expect(bridge, contains("shadowPrivateCallWebPush.getToken"));
    expect(page, contains('src="private_call_web_push.js"'));
    expect(worker, contains('notificationclick'));
    expect(worker, contains('private_call_incoming'));
    expect(worker, isNot(contains('showNotification(')));
  });

  test('control PWA remains isolated and Web permission is explicit', () {
    final js = File('web/private_call_web_push.js').readAsStringSync();
    final workflow = File(
      '.github/workflows/deploy-shadow-control-pages.yml',
    ).readAsStringSync();
    expect(js, contains('Notification.requestPermission()'));
    expect(js, contains('serviceWorkerRegistration: registration'));
    expect(js, contains('firebase-cloud-messaging-push-scope/'));
    expect(js, contains('push_vapid_not_configured'));
    expect(workflow, contains('rm -f site/control/firebase-messaging-sw.js'));
    expect(workflow, contains('SHADOW_FIREBASE_WEB_VAPID_KEY'));
    expect(workflow, contains('/Shadow-Live-/live/'));
    expect(workflow, contains('/Shadow-Live-/control/'));
  });
}
