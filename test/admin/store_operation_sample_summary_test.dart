import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/admin/store_operation_sample_summary.dart';

void main() {
  test('579C counts only projected Store audit actions within a 50-row sample',
      () {
    final sample = StoreOperationSampleSummary.fromEntries([
      {'action': 'purchase', 'priceCoins': 25000},
      {'action': 'renew', 'priceCoins': 25000},
      {'action': 'grant'},
      {'action': 'revoke'},
      {'action': 'other'},
    ]);
    expect(sample.inspected, 5);
    expect(sample.purchases, 1);
    expect(sample.renewals, 1);
    expect(sample.grants, 1);
    expect(sample.revocations, 1);
  });

  test('579C never turns unbounded history into a false all-time total', () {
    final summary = StoreOperationSampleSummary.fromEntries(
      List.generate(75, (_) => <String, dynamic>{'action': 'purchase'}),
    );
    expect(summary.inspected, 50);
    expect(summary.purchases, 50);
    expect(summary.renewals, 0);
  });
}
