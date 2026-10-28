/// Read-only statistics calculated from the authorized Store catalog snapshot.
/// These are catalog counts, never sales, orders, revenue or wallet totals.
class StoreCatalogStatistics {
  final int total;
  final int hidden;
  final int availableNow;
  final int scheduled;
  final int expired;
  final int vipExclusive;
  final int wealthExclusive;
  final int permanent;
  final int temporary;
  final Map<String, int> byCategory;
  final Map<String, int> availableByCategory;

  const StoreCatalogStatistics({
    required this.total,
    required this.hidden,
    required this.availableNow,
    required this.scheduled,
    required this.expired,
    required this.vipExclusive,
    required this.wealthExclusive,
    required this.permanent,
    required this.temporary,
    required this.byCategory,
    required this.availableByCategory,
  });

  factory StoreCatalogStatistics.fromCatalog(
    List<Map<String, dynamic>> items, {
    required int nowMs,
  }) {
    if (nowMs < 0) {
      throw ArgumentError.value(nowMs, 'nowMs', 'Must be nonnegative');
    }
    var hidden = 0;
    var available = 0;
    var scheduled = 0;
    var expired = 0;
    var vip = 0;
    var wealth = 0;
    var permanent = 0;
    var temporary = 0;
    final categoryCounts = <String, int>{};
    final availableCounts = <String, int>{};
    for (final item in items) {
      final category = item['category']?.toString() ?? '';
      categoryCounts[category] = (categoryCounts[category] ?? 0) + 1;
      if ((item['minVipLevel'] as num? ?? 0) > 0) vip++;
      if ((item['minWealthLevel'] as num? ?? 0) > 0) wealth++;
      if (item['durationDays'] == 0) {
        permanent++;
      } else {
        temporary++;
      }
      if (item['enabled'] != true) {
        hidden++;
        continue;
      }
      final start = item['visibleFromMs'] as int?;
      final end = item['visibleUntilMs'] as int?;
      if (start != null && start > nowMs) {
        scheduled++;
      } else if (end != null && end <= nowMs) {
        expired++;
      } else {
        available++;
        availableCounts[category] = (availableCounts[category] ?? 0) + 1;
      }
    }
    return StoreCatalogStatistics(
      total: items.length,
      hidden: hidden,
      availableNow: available,
      scheduled: scheduled,
      expired: expired,
      vipExclusive: vip,
      wealthExclusive: wealth,
      permanent: permanent,
      temporary: temporary,
      byCategory: Map.unmodifiable(categoryCounts),
      availableByCategory: Map.unmodifiable(availableCounts),
    );
  }
}
