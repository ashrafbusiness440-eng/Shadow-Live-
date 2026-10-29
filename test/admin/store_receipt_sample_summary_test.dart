import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/admin/store_receipt_sample_summary.dart';

void main() {
  test('579D counts statuses in a user-scoped receipt sample without double flags',
      () {
    final sample = StoreReceiptSampleSummary.fromEntries([
      {'deliveryStatus': 'delivered', 'refundStatus': 'none'},
      {'deliveryStatus': 'pending', 'refundStatus': 'requested'},
      {'deliveryStatus': 'failed', 'refundStatus': 'refunded'},
      {'deliveryStatus': 'delivered', 'refundStatus': 'rejected'},
      {'deliveryStatus': 'unknown', 'refundStatus': 'unknown'},
      {'deliveryStatus': 'delivered', 'refundStatus': 'refunded'},
    ]);
    expect(sample.inspected, 6);
    expect(sample.delivered, 3);
    expect(sample.pending, 1);
    expect(sample.failed, 1);
    expect(sample.unknownDelivery, 1);
    expect(sample.refundRequested, 1);
    expect(sample.refunded, 2);
    expect(sample.refundRejected, 1);
    expect(sample.unknownRefund, 1);
    expect(sample.reviewFlagged, 4);
  });

  test('579D never reports more than 50 receipts or infers total sales', () {
    final summary = StoreReceiptSampleSummary.fromEntries(
      List.generate(75, (i) => <String, dynamic>{
        'deliveryStatus': i < 50 ? 'delivered' : 'pending',
        'refundStatus': 'none',
        'priceCoins': 1000000,
      }),
    );
    expect(summary.inspected, 50);
    expect(summary.delivered, 50);
    expect(summary.pending, 0);
    expect(summary.reviewFlagged, 0);
  });

  test('579D unknown and incomplete states fail visible, not into delivered', () {
    final summary = StoreReceiptSampleSummary.fromEntries([
      <String, dynamic>{},
      {'deliveryStatus': 'delivered'},
      {'deliveryStatus': 'failed', 'refundStatus': 'rejected'},
    ]);
    expect(summary.inspected, 3);
    expect(summary.delivered, 1);
    expect(summary.unknownDelivery, 1);
    expect(summary.unknownRefund, 2);
    expect(summary.reviewFlagged, 3);
  });
}
