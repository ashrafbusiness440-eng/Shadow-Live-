import 'dart:io';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('direct gift owner is pinned at sheet entry and never silently switches accounts', () {
    final source = File('lib/features/gift/widgets/direct_gift_sheet.dart').readAsStringSync();
    expect(source, contains("late final String _ownerUid = FirebaseAuth.instance.currentUser?.uid ?? '';"));
    expect(source, contains('FirebaseAuth.instance.currentUser?.uid == _ownerUid'));
    expect(source, contains("throw StateError('gift_account_changed')"));
    expect(source, contains('canSend: _isOriginalAccount'));
    expect(source, contains('final sender = FirebaseAuth.instance.currentUser;'));
    expect(source, contains('token = await sender?.getIdToken();'));
    expect(source, contains('Future<void> _ensureConversation('));
    expect(source, contains('await _ensureConversation(conversationId);'));
    expect(source, contains("final fingerprint = [\n      _uid,"));
    final reqStart = source.indexOf('Future<GiftPickerSendResult> _send(');
    final reqEnd = source.indexOf('Widget build(', reqStart);
    final send = source.substring(reqStart, reqEnd);
    expect('_requireOriginalAccount();'.allMatches(send).length, greaterThanOrEqualTo(6));
    final afterNetwork = send.indexOf('    // A completed request belongs to the original account only.');
    final beforeReceipt = send.indexOf('    // Success, including a server-side duplicate response');
    expect(afterNetwork, greaterThan(0));
    expect(beforeReceipt, greaterThan(afterNetwork));
    expect(send.indexOf('_requireOriginalAccount();', afterNetwork),
      lessThan(beforeReceipt));
    expect(source, isNot(contains('Timer.periodic')));
  });

  test('account switch warns that the prior gift may have committed', () {
    final picker = File('lib/features/gift/widgets/unified_gift_picker_sheet.dart').readAsStringSync();
    expect(picker, contains("'gift_account_changed'"));
    expect(picker, contains('تحقّق من سجل الهدايا والرصيد'));
    expect(picker, contains('if (confirmed == null || !mounted) return;'));
  });
}
