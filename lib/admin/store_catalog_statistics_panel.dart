import 'package:flutter/material.dart';

import 'store_catalog_statistics.dart';

/// A catalog inventory summary, not financial reporting.
class StoreCatalogStatisticsPanel extends StatelessWidget {
  final List<Map<String, dynamic>> items;
  final Map<String, String> categories;
  final bool hasUnpublishedEdits;

  const StoreCatalogStatisticsPanel({
    super.key,
    required this.items,
    required this.categories,
    required this.hasUnpublishedEdits,
  });

  Widget _count(String title, int count, IconData icon) => SizedBox(
    width: 168,
    child: Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, size: 22),
            const SizedBox(height: 8),
            Text('$count', style: const TextStyle(
              fontSize: 25, fontWeight: FontWeight.bold,
            )),
            const SizedBox(height: 2),
            Text(title),
          ],
        ),
      ),
    ),
  );

  @override
  Widget build(BuildContext context) {
    final stats = StoreCatalogStatistics.fromCatalog(
      items, nowMs: DateTime.now().millisecondsSinceEpoch,
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Card(
          child: ListTile(
            leading: Icon(Icons.bar_chart_outlined),
            title: Text('إحصائيات المنتجات'),
            subtitle: Text(
              'هذه الأرقام محسوبة من قائمة منتجات المتجر المحمّلة '
              'ولا تمثل مبيعات أو أرباحاً أو طلبات شراء. '
              'الشراء والمنح غير مفعلين.',
            ),
          ),
        ),
        if (hasUnpublishedEdits)
          const Card(
            child: ListTile(
              leading: Icon(Icons.warning_amber_outlined),
              title: Text('أرقام المعاينة تشمل تعديلات غير محفوظة'),
              subtitle: Text(
                'لحساب الإحصائيات على آخر نسخة محفوظة، احفظ المنتجات '
                'أو أعد تحميل القائمة أولاً.',
              ),
            ),
          ),
        const SizedBox(height: 8),
        Wrap(
          spacing: 6,
          runSpacing: 6,
          children: [
            _count('إجمالي المنتجات', stats.total, Icons.inventory_2_outlined),
            _count('متاحة الآن', stats.availableNow, Icons.visibility_outlined),
            _count('مخفية أو مسودات', stats.hidden, Icons.visibility_off_outlined),
            _count('مجدولة لاحقاً', stats.scheduled, Icons.schedule_outlined),
            _count('انتهى وقت عرضها', stats.expired, Icons.event_busy_outlined),
            _count('حصرية VIP', stats.vipExclusive, Icons.workspace_premium_outlined),
            _count('حصرية الثروة', stats.wealthExclusive, Icons.diamond_outlined),
            _count('دائمة', stats.permanent, Icons.all_inclusive_outlined),
            _count('مؤقتة', stats.temporary, Icons.hourglass_bottom_outlined),
          ],
        ),
        const SizedBox(height: 16),
        Text('المنتجات حسب الفئة',
          style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        if (stats.total == 0)
          const Card(child: ListTile(
            title: Text('لا توجد منتجات محفوظة لعرض إحصائياتها.'),
          )),
        for (final category in categories.entries)
          if ((stats.byCategory[category.key] ?? 0) > 0)
            Card(child: ListTile(
              title: Text(category.value),
              subtitle: Text(
                'متاحة حالياً: ${stats.availableByCategory[category.key] ?? 0}',
              ),
              trailing: Text(
                '${stats.byCategory[category.key]}',
                style: Theme.of(context).textTheme.titleMedium,
              ),
            )),
        const SizedBox(height: 8),
        const Text(
          'إحصائيات الكتالوج فقط. لا يوجد عدّاد مبيعات أو أكثر المنتجات '
          'شراءً قبل تفعيل سجل شراء حقيقي وآمن.',
        ),
      ],
    );
  }
}
