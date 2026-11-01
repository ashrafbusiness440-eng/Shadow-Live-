import 'dart:io';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('settings uses compact collapsible RTL sections', () {
    final source = File('lib/screens/settings/settings_screen.dart').readAsStringSync();
    for (final title in ['حسابي', 'الحساب والأمان', 'الخصوصية والظهور', 'التفضيلات', 'الدعم والمعلومات']) {
      expect(source.contains("_section('$title'"), isTrue, reason: title);
    }
    expect(source.contains('ExpansionTile('), isTrue);
    expect(source.contains("Text('الإعدادات'"), isTrue);
    expect(source.contains("Text('SHADOW LIVE'"), isFalse);
    expect(source.contains('minVerticalPadding:4'), isTrue);
    expect(source.contains('TextDirection.rtl'), isTrue);
  });

  test('settings retains live routing and honest account deletion request', () {
    final source = File('lib/screens/settings/settings_screen.dart').readAsStringSync();
    for (final feature in [
      'AppRoutes.editProfile',
      'AppRoutes.myAgency',
      'DevicePermissionsScreen()',
      'PrivateCallPrivacySettingsScreen()',
      'VipPrivacySettingsScreen()',
      'AccountDeletionRequestScreen()',
      'showShadowConfirmation(',
      'const VipScreen()',
    ]) {
      expect(source.contains(feature), isTrue, reason: feature);
    }
    expect(source.contains('إرسال طلب للمراجعة، وليس حذفاً فورياً'), isTrue);
    // The approved reset is an admin request with a one-time server grant.
    // The retired OTP screen must not be reachable until that flow exists.
    expect(source.contains('DiamondPasswordResetScreen'), isFalse);
    expect(source.contains('تغيير كلمة سر الألماس'), isFalse);

    expect(source.contains('_soon('), isFalse);
  });
}
