import 'dart:io';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final control=File('lib/main_control.dart').readAsStringSync();
  final begin=control.indexOf('Widget buildModeratorBackfillCard()');
  final end=control.indexOf('Future<void> loadOwnerAbsoluteRoomAccess()',begin);
  final ui=control.substring(begin,end);

  test('Control offers an Arabic owner-only incremental migration UI', () {
    expect(control, contains('if(ownerAbsoluteAvailable&&ownerAbsoluteRoomAccess)'));
    expect(ui, contains('إصلاح قوائم المشرفين القدامى'));
    expect(ui, contains("Key('room-moderator-index-preview')"));
    expect(ui, contains("Key('room-moderator-index-confirm')"));
    expect(ui, contains('تأكيد مزامنة هذه الدفعة'));
    expect(ui, contains('فحص أول 10 غرف'));
  });

  test('preview and write are separate confirmed pages and never auto-run', () {
    final service=control.substring(
      control.indexOf('Future<Map<String,dynamic>> postModeratorBackfill('),
      control.indexOf('Widget buildModeratorBackfillCard()'),
    );
    expect(service, contains("'action':'roomModeratorIndexBackfillPage'"));
    expect(service, contains("'confirm':confirm"));
    expect(service, contains("'limit':10"));
    expect(service, contains("if(moderatorBackfillCursor!=null) 'cursor':moderatorBackfillCursor"));
    expect(service, contains('if(confirm&&moderatorBackfillPreview==null)return;'));
    expect(service, contains("moderatorBackfillCursor=result['nextCursor']?.toString();"));
    expect(service, isNot(contains('Timer.periodic')));
    expect(service, isNot(contains('setInterval')));
    expect(control, isNot(contains('unawaited(processModeratorBackfill')));
  });
}
