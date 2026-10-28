import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/admin/store_catalog_statistics.dart';

void main() {
  Map<String, dynamic> product(
    String id, {
    String category = 'frames',
    bool enabled = true,
    int? from,
    int? until,
    int vip = 0,
    int wealth = 0,
    int days = 0,
  }) => {
    'id': id,
    'category': category,
    'enabled': enabled,
    'visibleFromMs': from,
    'visibleUntilMs': until,
    'minVipLevel': vip,
    'minWealthLevel': wealth,
    'durationDays': days,
  };

  test('calculates distinct shown hidden scheduled and expired statuses', () {
    const now = 30000;
    final items = [
      product('200001'),
      product('200002', enabled: false, from: 40000),
      product('200003', from: 31000),
      product('200004', until: 30000),
      product('200005', category: 'backgrounds',
          from: 20000, until: 30001),
      product('200006', enabled: false, until: 20000),
    ];
    final stats = StoreCatalogStatistics.fromCatalog(items, nowMs: now);
    expect(stats.total, 6);
    expect(stats.availableNow, 2);
    expect(stats.hidden, 2);
    expect(stats.scheduled, 1);
    expect(stats.expired, 1);
    expect(stats.availableNow + stats.hidden + stats.scheduled +
        stats.expired, stats.total);
    expect(stats.byCategory, {'frames': 5, 'backgrounds': 1});
    expect(stats.availableByCategory, {'frames': 1, 'backgrounds': 1});
  });

  test('counts VIP and wealth separately and never assumes purchases', () {
    final stats = StoreCatalogStatistics.fromCatalog([
      product('200001', vip: 3, wealth: 12, days: 7),
      product('200002', vip: 0, wealth: 4),
      product('200003', enabled: false, vip: 1, days: 30),
    ], nowMs: 1000);
    expect(stats.vipExclusive, 2);
    expect(stats.wealthExclusive, 2);
    expect(stats.permanent, 1);
    expect(stats.temporary, 2);
    expect(stats.total, 3);
    expect(stats.availableNow, 2);
  });

  test('boundary timestamps match server: from inclusive, until exclusive', () {
    final result = StoreCatalogStatistics.fromCatalog([
      product('200001', from: 1000),
      product('200002', until: 1000),
    ], nowMs: 1000);
    expect(result.availableNow, 1);
    expect(result.expired, 1);
    expect(result.scheduled, 0);
  });

  test('empty catalog returns zero counts', () {
    final stats = StoreCatalogStatistics.fromCatalog([], nowMs: 0);
    expect(stats.total, 0);
    expect(stats.availableNow, 0);
    expect(stats.hidden, 0);
    expect(stats.byCategory, isEmpty);
  });

  test('invalid current time fails closed', () {
    expect(() => StoreCatalogStatistics.fromCatalog([], nowMs: -1),
      throwsArgumentError);
  });
}
