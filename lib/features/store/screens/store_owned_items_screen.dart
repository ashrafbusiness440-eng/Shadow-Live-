import 'package:flutter/material.dart';

import '../../../core/assets/shadow_asset_registry.dart';
import '../services/store_owned_items_service.dart';

class StoreOwnedItemsScreen extends StatefulWidget {
  const StoreOwnedItemsScreen({super.key});

  @override
  State<StoreOwnedItemsScreen> createState() => _StoreOwnedItemsScreenState();
}

class _StoreOwnedItemsScreenState extends State<StoreOwnedItemsScreen> {
  final _service = StoreOwnedItemsService();
  StoreOwnedItemsResult? _result;
  String? _error;
  bool _loading = true;
  String? _changingId;

  static const _sources = <String, String>{
    'purchase': 'شراء',
    'admin_grant': 'منحة إدارية',
    'reward': 'مكافأة',
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
      setState(() { _result = result; _loading = false; });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = 'تعذّر تحميل مقتنيات المتجر. تأكد من اتصالك ثم أعد المحاولة.';
        _loading = false;
      });
    }
  }

  Future<void> _setEquipped(StoreOwnedItem item) async {
    if (_changingId != null) return;
    setState(() => _changingId = item.productId);
    try {
      await _service.setEquipped(item, equipped: !item.equipped);
      await _load();
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('تعذّر تغيير التجهيز. تأكد من صلاحية المقتنى ثم حاول مجددًا.'),
      ));
    } finally {
      if (mounted) setState(() => _changingId = null);
    }
  }

  String _date(int milliseconds) {
    final date = DateTime.fromMillisecondsSinceEpoch(milliseconds).toLocal();
    return '${date.day}/${date.month}/${date.year}';
  }

  Widget _image(StoreOwnedItem item) => FutureBuilder<Uri?>(
    future: ShadowAssetRegistry.remoteUrl(item.assetKey),
    builder: (context, snapshot) {
      final url = snapshot.data?.toString();
      if (url == null || url.isEmpty) {
        return const Icon(Icons.image_not_supported_outlined, size: 38);
      }
      return Image.network(url, fit: BoxFit.contain,
        errorBuilder: (_, __, ___) =>
          const Icon(Icons.image_not_supported_outlined, size: 38),
      );
    },
  );

  Widget _card(StoreOwnedItem item) {
    final label = switch (item.lifecycleState) {
      'active' => item.equipped ? 'مجهّز حاليًا' : 'صالح للاستخدام',
      'expired' => 'منتهي الصلاحية',
      'revoked' => 'ملغى',
      _ => 'غير متاح للاستخدام',
    };
    return Card(
      margin: const EdgeInsets.symmetric(vertical: 6),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(children: [
          SizedBox(width: 70,height: 75,child: _image(item)),
          const SizedBox(width: 12),
          Expanded(child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(item.nameAr.isEmpty ? 'منتج متجر' : item.nameAr,
                style: const TextStyle(fontWeight: FontWeight.bold)),
              const SizedBox(height: 4),
              Text('المصدر: ${_sources[item.source] ?? 'مقتنى'}'),
              Text('تاريخ الحصول: ${_date(item.acquiredAtMs)}'),
              Text(item.expiresAtMs == null
                  ? 'الصلاحية: دائم'
                  : 'تنتهي الصلاحية: ${_date(item.expiresAtMs!)}'),
              Text(label,
                style: TextStyle(
                  color: item.active ? Colors.green : Colors.orange,
                  fontWeight: FontWeight.w600)),
              if (item.active) Padding(
                padding: const EdgeInsets.only(top: 8),
                child: OutlinedButton.icon(
                  onPressed: _changingId != null ? null
                    : () => _setEquipped(item),
                  icon: _changingId == item.productId
                    ? const SizedBox(width: 16, height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2))
                    : Icon(item.equipped ? Icons.check_circle
                        : Icons.auto_awesome),
                  label: Text(item.equipped ? 'إلغاء التجهيز' : 'تجهيز'),
                ),
              ),
            ],
          )),
        ]),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final items = _result?.items ?? const <StoreOwnedItem>[];
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('مقتنياتي من المتجر'),
          actions: [
            IconButton(
              tooltip: 'تحديث المقتنيات',
              onPressed: _loading ? null : _load,
              icon: const Icon(Icons.refresh),
            ),
          ],
        ),
        body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
            ? Center(child: Padding(
                padding: const EdgeInsets.all(20),
                child: Column(mainAxisSize: MainAxisSize.min, children: [
                  Text(_error!, textAlign: TextAlign.center),
                  const SizedBox(height: 10),
                  FilledButton(
                    onPressed: _load,
                    child: const Text('إعادة المحاولة'),
                  ),
                ]),
              ))
            : items.isEmpty
              ? const Center(child: Padding(
                  padding: EdgeInsets.all(24),
                  child: Text(
                    'ليس لديك منتجات من المتجر بعد.\n'
                    'هذا القسم منفصل عن المكافآت ومقتنيات المستويات.',
                    textAlign: TextAlign.center),
                ))
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.all(12),children: [
                    for (final item in items) _card(item),
                    if (_result?.moreMayExist == true) const Padding(
                      padding: EdgeInsets.all(12),
                      child: Text('هذه أول 100 نتيجة فقط؛ عرض بقية السجل '
                        'سيُضاف مع التحميل التدريجي.',
                        textAlign: TextAlign.center),
                    ),
                    const Padding(
                      padding: EdgeInsets.all(12),
                      child: Text('يمكن تجهيز منتج واحد من كل فئة. '
                        'المقتنيات المنتهية أو الملغاة غير قابلة للتجهيز.',
                        textAlign: TextAlign.center),
                    ),
                  ]),
                ),
      ),
    );
  }
}
