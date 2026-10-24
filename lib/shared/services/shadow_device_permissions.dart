import 'package:flutter/foundation.dart';
import 'package:permission_handler/permission_handler.dart';

/// Runtime-only permissions. Android prompts are triggered by a direct user
/// action, never during startup, room discovery or receipt of a push event.
enum ShadowMicrophoneAccess { granted, denied, settingsRequired }

class ShadowDevicePermissions {
  const ShadowDevicePermissions._();

  static bool get isAndroid =>
      !kIsWeb && defaultTargetPlatform == TargetPlatform.android;

  static Future<ShadowMicrophoneAccess> ensureMicrophone() async {
    // Browsers request their own permission when microphone capture starts.
    // iOS is not yet a shipped Shadow Live target.
    if (!isAndroid) return ShadowMicrophoneAccess.granted;

    var status = await Permission.microphone.status;
    if (status.isGranted) return ShadowMicrophoneAccess.granted;
    if (status.isPermanentlyDenied || status.isRestricted) {
      return ShadowMicrophoneAccess.settingsRequired;
    }

    status = await Permission.microphone.request();
    if (status.isGranted) return ShadowMicrophoneAccess.granted;
    if (status.isPermanentlyDenied || status.isRestricted) {
      return ShadowMicrophoneAccess.settingsRequired;
    }
    return ShadowMicrophoneAccess.denied;
  }

  static Future<PermissionStatus?> microphoneStatus() async =>
      isAndroid ? Permission.microphone.status : null;

  static Future<PermissionStatus?> notificationStatus() async =>
      isAndroid ? Permission.notification.status : null;

  /// This OS permission alone does not enable FCM or incoming-call push.
  /// PrivateCallPushService still requires valid native Firebase config and
  /// an independent, explicitly opted-in account-level subscription.
  static Future<PermissionStatus?> requestNotificationPermission() async {
    if (!isAndroid) return null;
    final status = await Permission.notification.status;
    if (status.isGranted) return status;
    if (status.isPermanentlyDenied || status.isRestricted) return status;
    return Permission.notification.request();
  }

  static Future<bool> openSystemSettings() => openAppSettings();
}
