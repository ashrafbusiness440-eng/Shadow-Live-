import 'package:flutter/material.dart';

import '../../../core/assets/shadow_asset_registry.dart';
import '../services/public_store_catalog_service.dart';
import 'store_owned_items_screen.dart';

class PublicStoreCatalogScreen extends StatefulWidget {
  const PublicStoreCatalogScreen({super.key});

  @override
  State<PublicStoreCatalogScreen> createState() =>
      _PublicStoreCatalogScreenState();
}

class _PublicStoreCatalogScreenState extends State<PublicStoreCatalogScreen> {
  final _service = PublicStoreCatalogService();
  PublicStoreCatalog? _catalog;
  bool _loading = true;
  String? _error;
  String _search = '';
  String _category = 'all';

  static const _rarities = <String, String>{
    'normal': 'عادي',
    'rare': 'نادر',
    'epic': 'ملحمي',
    'legendary': 'أسطوري',
  };

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _service.close();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final result = await _service.load();
      if (!mounted) return;
      setState(() { _catalog = result; _loading = false; });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = 'تعذّر تحميل المنتجات حالياً. حاول مرة أخرى.';
      });
    }
  }

  String _duration(int days) => switch (days) {
    0 => 'دائم',
    3 => '3 أيام',
    7 => '7 أيام',
    30 => '30 يوماً',
    _ => '$days يوم',
  };

  Widget _image(PublicStoreItem item) => FutureBuilder<Uri?>(
    future: ShadowAssetRegistry.remoteUrl(item.assetKey),
    builder: (_, snapshot) {
      final url = snapshot.data?.toString();
      if (url == null || url.isEmpty) {
        return const Center(child: Icon(Icons.image_not_supported_outlined,
          size: 52, color: Colors.white38));
      }
      return Image.network(url, fit: BoxFit.contain,
        errorBuilder: (_, __, ___) => const Center(
          child: Icon(Icons.image_not_supported_outlined,
            size: 52, color: Colors.white38)));
    },
  );

  void _details(PublicStoreItem item, String category) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF1C1A26),
      builder: (sheetContext) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            SizedBox(height: 150, child: _image(item)),
            const SizedBox(height: 12),
            Text(item.nameAr, style: Theme.of(sheetContext)
                .textTheme.titleLarge?.copyWith(color: Colors.white)),
            const SizedBox(height: 8),
            Text('$category • ${_rarities[item.rarity] ?? item.rarity}',
              style: const TextStyle(color: Colors.white70)),
            Text('${item.priceCoins} كوينز • ${_duration(item.durationDays)}',
              style: const TextStyle(color: Color(0xFFFFD54F))),
            if (item.minVipLevel > 0) Text(
              'يتطلب مستوى VIP ${item.minVipLevel} فما فوق',
              style: const TextStyle(color: Colors.white70)),
            if (item.minWealthLevel > 0) Text(
              'يتطلب مستوى ثروة ${item.minWealthLevel} فما فوق',
              style: const TextStyle(color: Colors.white70)),
            const SizedBox(height: 20),
            const FilledButton(
              onPressed: null,
              child: Text('الشراء قريباً'),
            ),
            const SizedBox(height: 8),
            const Text('لا يمكن الشراء أو خصم كوينز حالياً.',
              style: TextStyle(color: Colors.white54)),
          ]),
        ),
      ),
    );
  }

  Widget _card(PublicStoreItem item, String category) => Card(
    color: const Color(0xFF211C30),
    clipBehavior: Clip.antiAlias,
    child: InkWell(
      onTap: () => _details(item, category),
      child: Padding(
        padding: const EdgeInsets.all(10),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Expanded(child: _image(item)),
          const SizedBox(height: 8),
          Text(item.nameAr, maxLines: 1, overflow: TextOverflow.ellipsis,
            textAlign: TextAlign.center,
            style: const TextStyle(color: Colors.white,
              fontWeight: FontWeight.w700)),
          Text(category, maxLines: 1, overflow: TextOverflow.ellipsis,
            textAlign: TextAlign.center,
            style: const TextStyle(color: Colors.white54, fontSize: 12)),
          Text('${item.priceCoins} كوينز',
            textAlign: TextAlign.center,
            style: const TextStyle(color: Color(0xFFFFD54F))),
          Text(item.minVipLevel > 0 ? 'VIP ${item.minVipLevel}+'
                : item.minWealthLevel > 0 ? 'ثروة ${item.minWealthLevel}+'
                : 'الشراء قريباً',
            textAlign: TextAlign.center,
            style: const TextStyle(color: Colors.white54, fontSize: 12)),
        ]),
      ),
    ),
  );

  @override
  Widget build(BuildContext context) {
    final catalog = _catalog;
    final categories = catalog?.categories ?? const <String, String>{};
    final filtered = (catalog?.items ?? const <PublicStoreItem>[])
        .where((item) =>
          (_category == 'all' || item.category == _category) &&
          ('${item.nameAr} ${item.id}').toLowerCase()
            .contains(_search.trim().toLowerCase()))
        .toList(growable: false);
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: const Color(0xFF11101A),
        appBar: AppBar(
          backgroundColor: const Color(0xFF11101A),
          foregroundColor: Colors.white,
          title: const Text('المتجر'),
          actions: [
            IconButton(
              tooltip: 'مقتنياتي من المتجر',
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => const StoreOwnedItemsScreen(),
                ),
              ),
              icon: const Icon(Icons.inventory_2_outlined),
            ),
            IconButton(
              tooltip: 'تحديث المنتجات',
              onPressed: _loading ? null : _load,
              icon: const Icon(Icons.refresh),
            ),
          ],
        ),
        body: Column(children: [
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Text('تصفّح المنتجات الآن — الشراء بالكوينز قريباً',
              style: TextStyle(color: Colors.white70)),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: TextField(
              onChanged: (value) => setState(() => _search = value),
              style: const TextStyle(color: Colors.white),
              decoration: const InputDecoration(
                hintText: 'ابحث عن منتج',
                prefixIcon: Icon(Icons.search),
                border: OutlineInputBorder(),
              ),
            ),
          ),
          if (catalog != null) SizedBox(
            height: 52,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 12),
              children: [
                Padding(padding: const EdgeInsets.symmetric(horizontal: 4),
                  child: ChoiceChip(label: const Text('الكل'),
                    selected: _category == 'all',
                    onSelected: (_) => setState(() => _category = 'all'))),
                for (final entry in categories.entries)
                  Padding(padding: const EdgeInsets.symmetric(horizontal: 4),
                    child: ChoiceChip(label: Text(entry.value),
                      selected: _category == entry.key,
                      onSelected: (_) => setState(() => _category = entry.key))),
              ],
            ),
          ),
          if (_loading) const Expanded(child: Center(
            child: CircularProgressIndicator()))
          else if (_error != null) Expanded(child: Center(
            child: Text(_error!, style: const TextStyle(color: Colors.white70))))
          else if (filtered.isEmpty) const Expanded(child: Center(
            child: Text('لا توجد منتجات معروضة في هذا القسم حالياً',
              style: TextStyle(color: Colors.white70))))
          else Expanded(child: LayoutBuilder(
            builder: (context, constraints) {
              final columns = constraints.maxWidth >= 850 ? 5 :
                constraints.maxWidth >= 650 ? 4 :
                constraints.maxWidth >= 450 ? 3 : 2;
              return GridView.builder(
                padding: const EdgeInsets.all(12),
                gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                  crossAxisCount: columns,
                  crossAxisSpacing: 10, mainAxisSpacing: 10,
                  childAspectRatio: .77,
                ),
                itemCount: filtered.length,
                itemBuilder: (_, index) {
                  final item = filtered[index];
                  return _card(item, categories[item.category] ?? item.category);
                },
              );
            },
          )),
        ]),
      ),
    );
  }
}
