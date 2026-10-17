import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('personal call privacy uses existing signed-in users record only', () {
    final src = File(
      'lib/screens/settings/private_call_privacy_settings_screen.dart',
    ).readAsStringSync();
    expect(src, contains("collection('users')"));
    expect(src, contains(".doc(uid)"));
    expect(src, contains("'allowPrivateCalls': allow"));
    expect(src, contains("'doNotDisturbCalls': dnd"));
    expect(src, contains("user.uid == _openedByUid"));
    expect(src, contains("!user.isAnonymous"));
    expect(src, contains("_loadFailed || !_dirty || !_activeAccount"));
    expect(src, contains("final allow = _allowCalls;"));
    expect(src, contains("_dirty = _allowCalls != allow || _doNotDisturb != dnd;"));
    expect(src, isNot(contains(".snapshots()")));
    expect(src, isNot(contains("Timer.periodic")));
  });

  test('user-facing menu exposes both privacy choices in Arabic', () {
    final ui = File(
      'lib/screens/settings/private_call_privacy_settings_screen.dart',
    ).readAsStringSync();
    final menu = File('lib/screens/settings/settings_screen.dart')
        .readAsStringSync();
    expect(menu, contains("'خصوصية المكالمات'"));
    expect(menu, contains("const PrivateCallPrivacySettingsScreen()"));
    expect(ui, contains("'السماح بالمكالمات الخاصة'"));
    expect(ui, contains("'عدم الإزعاج للمكالمات'"));
    expect(ui, contains("'حفظ الإعدادات'"));
    expect(ui, contains("هذه الإعدادات لا تفعّل خدمة المكالمات قبل إطلاقها."));
  });

  test('existing Worker validates both self-chosen privacy controls', () {
    final backend = File('cloudflare-worker/src/private-voice-eligibility.js')
        .readAsStringSync();
    final rules = File('firestore.rules').readAsStringSync();
    expect(backend, contains('actor.data?.allowPrivateCalls === false'));
    expect(backend, contains('other.data?.allowPrivateCalls === false'));
    expect(backend, contains('other.data?.doNotDisturbCalls === true'));
    expect(backend, contains('sentBlock.exists || receivedBlock.exists'));
    expect(backend, contains('mutual_follow_required'));
    expect(rules, contains('request.auth.uid == userId'));
    expect(rules, contains('protectedUserFieldsUnchanged()'));
  });
}
