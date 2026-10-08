import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('gift UI maps diary and account failures explicitly', () {
    final source = File(
      'lib/features/gift/widgets/unified_gift_picker_sheet.dart',
    ).readAsStringSync();

    for (final code in <String>[
      'sender_not_found',
      'receiver_not_found',
      'diary_not_found',
      'conversation_not_found',
      'invalid_diary_receiver',
      'invalid_request',
      'unauthorized',
      'transaction_failed',
    ]) {
      expect(source.contains("'$code'"), isTrue, reason: code);
    }
  });
}
