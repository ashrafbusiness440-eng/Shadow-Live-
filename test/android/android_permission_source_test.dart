import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  final manifest =
      File('android/app/src/main/AndroidManifest.xml').readAsStringSync();
  final room = File('lib/main.dart').readAsStringSync();
  final settings =
      File('lib/screens/settings/settings_screen.dart').readAsStringSync();
  final permissionsPage =
      File('lib/screens/settings/device_permissions_screen.dart')
          .readAsStringSync();
  final permissionService =
      File('lib/shared/services/shadow_device_permissions.dart')
          .readAsStringSync();
  final recorder =
      File('lib/features/chat/services/private_voice_recorder.dart')
          .readAsStringSync();

  test('Android only declares approved microphone and notification permissions',
      () {
    expect(manifest, contains('android.permission.RECORD_AUDIO'));
    expect(manifest, contains('android.permission.POST_NOTIFICATIONS'));
    expect(manifest, isNot(contains('SYSTEM_ALERT_WINDOW')));
  });

  test('room asks before occupying the mic and before unmuting', () {
    final helper = room.indexOf(
      'Future<bool> _ensureRoomMicrophonePermission(',
    );
    final seat = room.indexOf(
      'if (!await _ensureRoomMicrophonePermission(roomId, uid)) return;',
    );
    final taken = room.indexOf(
      'final taken = await _runSeatAction(',
      seat,
    );
    final unmuteGate = room.indexOf(
      '!await _ensureRoomMicrophonePermission(roomId, uid))',
      taken,
    );
    final unmute = room.indexOf(
      'await _voiceSession.setMicMuted(false);',
      unmuteGate,
    );
    expect(helper, greaterThanOrEqualTo(0));
    expect(seat, greaterThan(helper));
    expect(taken, greaterThan(seat));
    expect(unmuteGate, greaterThan(taken));
    expect(unmute, greaterThan(unmuteGate));
    expect(room, contains('FirebaseAuth.instance.currentUser?.uid != uid'));
    expect(room, contains('_voiceSession.roomId != roomId'));
  });

  test('voice notes share one explicit runtime microphone permission guard', () {
    expect(recorder, contains('ShadowDevicePermissions.ensureMicrophone()'));
    expect(recorder, contains('ShadowMicrophoneAccess.granted'));
    expect(recorder, contains('microphone_permission_required'));
  });

  test('notifications are prompted only by a user action in Settings', () {
    expect(permissionService, contains('Permission.notification.request()'));
    expect(permissionService, contains('Permission.microphone.request()'));
    expect(permissionService, contains('!kIsWeb && defaultTargetPlatform == TargetPlatform.android'));
    expect(settings, contains('const DevicePermissionsScreen()'));
    expect(permissionsPage, contains('request: _requestNotifications,'));
    expect(permissionsPage, contains('request: _requestMicrophone,'));
    expect(permissionsPage, contains('DefaultFirebaseOptions.androidMessagingConfigured'));
    expect(permissionsPage, contains('ShadowDevicePermissions.openSystemSettings()'));
    final initStart = permissionsPage.indexOf('void initState()');
    final initEnd = permissionsPage.indexOf('Future<void> _refresh()', initStart);
    expect(permissionsPage.substring(initStart, initEnd),
        isNot(contains('_requestMicrophone()')));
    expect(permissionsPage.substring(initStart, initEnd),
        isNot(contains('_requestNotifications()')));
  });
}
