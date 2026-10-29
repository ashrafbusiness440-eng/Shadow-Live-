// A bounded, read-only summary of Owner-authorized Store audit rows.
// This is NOT a sales/earnings report: audit rows can be partial, and only
// the first 50 projected entries returned by the existing endpoint are used.
class StoreOperationSampleSummary {
  final int inspected;
  final int purchases;
  final int renewals;
  final int grants;
  final int revocations;

  const StoreOperationSampleSummary({
    required this.inspected,
    required this.purchases,
    required this.renewals,
    required this.grants,
    required this.revocations,
  });

  factory StoreOperationSampleSummary.fromEntries(
      List<Map<String, dynamic>> entries) {
    var purchases = 0;
    var renewals = 0;
    var grants = 0;
    var revocations = 0;
    final sample = entries.take(50).toList(growable: false);
    for (final entry in sample) {
      switch (entry['action']) {
        case 'purchase':
          purchases++;
        case 'renew':
          renewals++;
        case 'grant':
          grants++;
        case 'revoke':
          revocations++;
      }
    }
    return StoreOperationSampleSummary(
      inspected: sample.length,
      purchases: purchases,
      renewals: renewals,
      grants: grants,
      revocations: revocations,
    );
  }
}
