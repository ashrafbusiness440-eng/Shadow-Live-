// Bounded, read-only state summary from one authorized user's receipt list.
// Only the existing 50 projected records are considered: this is NOT an
// all-time sales, revenue, Coins settlement or financial ledger report.
class StoreReceiptSampleSummary {
  final int inspected;
  final int delivered;
  final int pending;
  final int failed;
  final int unknownDelivery;
  final int refundRequested;
  final int refunded;
  final int refundRejected;
  final int unknownRefund;
  final int reviewFlagged;

  const StoreReceiptSampleSummary({
    required this.inspected,
    required this.delivered,
    required this.pending,
    required this.failed,
    required this.unknownDelivery,
    required this.refundRequested,
    required this.refunded,
    required this.refundRejected,
    required this.unknownRefund,
    required this.reviewFlagged,
  });

  factory StoreReceiptSampleSummary.fromEntries(
      List<Map<String, dynamic>> entries) {
    var delivered = 0;
    var pending = 0;
    var failed = 0;
    var unknownDelivery = 0;
    var refundRequested = 0;
    var refunded = 0;
    var refundRejected = 0;
    var unknownRefund = 0;
    var reviewFlagged = 0;
    final sample = entries.take(50).toList(growable: false);
    for (final receipt in sample) {
      final delivery = receipt['deliveryStatus'];
      final refund = receipt['refundStatus'];
      switch (delivery) {
        case 'delivered':
          delivered++;
        case 'pending':
          pending++;
        case 'failed':
          failed++;
        default:
          unknownDelivery++;
      }
      switch (refund) {
        case 'none':
          break;
        case 'requested':
          refundRequested++;
        case 'refunded':
          refunded++;
        case 'rejected':
          refundRejected++;
        default:
          unknownRefund++;
      }
      // One review flag per receipt even when multiple states need
      // attention. A flag is NOT evidence of an incorrect Coins balance.
      if (delivery != 'delivered' ||
          refund == 'requested' || refund == 'refunded' ||
          (refund != 'none' && refund != 'rejected')) {
        reviewFlagged++;
      }
    }
    return StoreReceiptSampleSummary(
      inspected: sample.length,
      delivered: delivered,
      pending: pending,
      failed: failed,
      unknownDelivery: unknownDelivery,
      refundRequested: refundRequested,
      refunded: refunded,
      refundRejected: refundRejected,
      unknownRefund: unknownRefund,
      reviewFlagged: reviewFlagged,
    );
  }
}
