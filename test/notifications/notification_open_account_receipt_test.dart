import 'dart:io';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('notification opening does not depend on successful read receipt', () {
    final page = File('lib/features/notifications/screens/notifications_page.dart')
        .readAsStringSync();
    final start = page.indexOf('Future<void> _open(AppNotification item) async');
    final end = page.indexOf('Future<void> _openImageModeration(', start);
    final open = page.substring(start, end);
    expect(open, contains('var acknowledged = false;'));
    expect(open, contains('try {\n        await _service.markRead(item.id);'));
    expect(open, contains('} catch (_) {\n        // Leave the badge unread'));
    expect(open, contains('if (acknowledged && index >= 0)'));
    expect(open, contains('if (!activeOwner()) return;'));
    expect(open, contains('await AccountActionAppealDialog.open(context, item);'));
    expect(open, contains('PrivateCallIncomingDialog('));
    expect(open, isNot(contains('Timer.periodic')));
  });

  test('a read acknowledgement cannot route a previous account notification', () {
    final page = File('lib/features/notifications/screens/notifications_page.dart')
        .readAsStringSync();
    final open = page.substring(
      page.indexOf('Future<void> _open(AppNotification item) async'),
      page.indexOf('Future<void> _openImageModeration('),
    );
    expect(open, contains('final ownerUid = _pageOwnerUid;'));
    expect(open, contains('final accountEpoch = _requestEpoch;'));
    expect(open, contains('ownerUid == _pageOwnerUid'));
    expect(open, contains('accountEpoch == _requestEpoch'));
    expect('if (!activeOwner()) return;'.allMatches(open).length,
      greaterThanOrEqualTo(3));

    final service = File('lib/features/notifications/services/notification_service.dart')
        .readAsStringSync();
    expect(service, contains('final uid = _auth.currentUser?.uid;'));
    expect(service, contains('notificationId.contains'));
    expect(service, contains("if (_auth.currentUser?.uid != uid) throw StateError('account_changed');"));
  });
}
