import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('U6-M1 appeals reuse report hub and verified admin identity', () {
    final hub = File('lib/admin/reports_hub_page.dart').readAsStringSync();
    final route = File('lib/admin/reports_hub_inbox_route.dart')
        .readAsStringSync();
    final page = File('lib/admin/account_action_appeals_control_page.dart')
        .readAsStringSync();
    expect(hub.contains('AccountActionAppealsControlPage'), isTrue);
    expect(hub.contains('enum ReportsHubSection { roomsAndMessages, people, diaries, system }'), isTrue);
    expect(route.contains("'account_action_appeal'"), isTrue);
    expect(route.contains('initialOperationId: widget.reportId'), isTrue);
    expect(page.contains("'listAccountActionAppeals'"), isTrue);
    expect(page.contains("'getAccountActionAppeal'"), isTrue);
    expect(page.contains("'reviewAccountActionAppeal'"), isTrue);
    expect(page.contains('reversalOperationId'), isTrue);
    expect(page.contains('لم يتم إثبات رفع هذه العقوبة'), isTrue);
    expect(page.contains('setInterval'), isFalse);
  });

  test('U6-M1 user appeal uses own operation ID and one bounded request', () {
    final notifications = File(
      'lib/features/notifications/screens/notifications_page.dart',
    ).readAsStringSync();
    final service = File(
      'lib/features/notifications/services/account_action_appeal_service.dart',
    ).readAsStringSync();
    final dialog = File(
      'lib/features/notifications/widgets/account_action_appeal_dialog.dart',
    ).readAsStringSync();
    final model = File(
      'lib/features/notifications/services/notification_service.dart',
    ).readAsStringSync();
    expect(notifications.contains('AccountActionAppealDialog.open(context, item)'), isTrue);
    expect(service.contains("'submitAccountActionAppeal'"), isTrue);
    expect(service.contains("'getOwnAccountActionAppeal'"), isTrue);
    expect(dialog.contains('الاعتراض على الإجراء الإداري'), isTrue);
    expect(dialog.contains('AccountActionAppealService'), isTrue);
    expect(model.contains("operationId: _nullable(data['operationId'])"), isTrue);
    expect(dialog.contains('Timer.periodic'), isFalse);
    expect(service.contains('snapshots('), isFalse);
  });
}
