import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('Arabic Control saves one pricing policy through the authenticated route', () {
    final ui = File('lib/admin/private_voice_control_page.dart').readAsStringSync();
    expect(ui, contains('shadowApiEndpoint(\'private-voice-control\')'));
    expect(ui, contains("'privateCallPricingMode': _callPricingMode"));
    expect(ui, contains("'privateCallPriceCoins': price"));
    expect(ui, contains("DropdownMenuItem(value: 'free'"));
    expect(ui, contains("DropdownMenuItem(value: 'paid'"));
    expect(ui, contains('مدفوع — تحضير فقط'));
    expect(ui, contains('محاسبة آمنة'));
    expect(ui, contains('_operationKey = op;'));
    expect(ui, isNot(contains('wallet-actions')));
  });

  test('Worker rejects paid call start even when a caller bypasses Control', () {
    final policy = File('cloudflare-worker/src/private-voice-eligibility.js')
        .readAsStringSync();
    final admin = File('cloudflare-worker/src/private-voice-control.js')
        .readAsStringSync();
    expect(policy, contains('settings.data?.privateCallPricingMode === "paid"'));
    expect(policy, contains('private_call_billing_not_ready'));
    expect(admin, contains('paidCallsLaunchReady: false'));
    expect(admin, contains('input.privateCallsEnabled === true'));
    expect(admin, contains('Number.isSafeInteger(price)'));
    expect(admin, contains('admin_audit_logs/private_voice_'));
  });
}
