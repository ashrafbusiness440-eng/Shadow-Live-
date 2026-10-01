import 'package:flutter/material.dart';

import '../services/agency_package_service.dart';

class AgencyPackageInventoryPage extends StatefulWidget {
  const AgencyPackageInventoryPage({super.key});

  @override
  State<AgencyPackageInventoryPage> createState() =>
      _AgencyPackageInventoryPageState();
}

class _AgencyPackageInventoryPageState
    extends State<AgencyPackageInventoryPage> {
  final AgencyPackageService _service = AgencyPackageService();
  List<AgencyPackageGrant> _packages = const [];
  bool _loading = true;
  bool _busy = false;
  String? _error;

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

  String _key() => 'agency_package_distribute_' +
      DateTime.now().microsecondsSinceEpoch.toString();

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final packages = await _service.loadMyPackages();
      if (!mounted) return;
      setState(() {
        _packages = packages;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error.toString();
        _loading = false;
      });
    }
  }

  Future<void> _distribute(
    AgencyPackageGrant package,
    AgencyPackageLine item,
  ) async {
    if (_busy || package.expired || (item.quantityRemaining ?? 0) <= 0) {
      return;
    }
    final id = TextEditingController();
    final accepted = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('توزيع عنصر'),
        content: TextField(
          controller: id,
          autofocus: true,
          keyboardType: TextInputType.number,
          maxLength: 8,
          decoration: const InputDecoration(
            labelText: 'Public ID للمستلم',
            hintText: 'داخل أو خارج الوكالة',
            border: OutlineInputBorder(),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('إلغاء'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('توزيع'),
          ),
        ],
      ),
    );
    final targetId = id.text.trim();
    id.dispose();
    if (accepted != true || !RegExp(r'^\d{3,8}$').hasMatch(targetId)) {
      return;
    }

    setState(() => _busy = true);
    try {
      final remaining = await _service.distribute(
        grantId: package.grantId,
        lineId: item.lineId,
        targetPublicId: targetId,
        idempotencyKey: _key(),
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'تم التوزيع. المتبقي من هذا العنصر: ' + remaining.toString(),
          ),
        ),
      );
      await _load();
    } catch (error) {
      if (!mounted) return;
      final code = error.toString().replaceFirst('Bad state: ', '');
      final message = code.contains('package_expired')
          ? 'انتهت صلاحية هذا الباكيج.'
          : code.contains('package_item_out_of_stock')
              ? 'نفدت كمية هذا العنصر.'
              : code.contains('agency_owner_required')
                  ? 'التوزيع متاح لمالك الوكالة فقط.'
                  : code.contains('target_user_not_found')
                      ? 'Public ID غير موجود.'
                      : 'تعذر التوزيع: ' + code;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(message)),
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _expiryLabel(int value) {
    if (value <= 0) return '—';
    final date = DateTime.fromMillisecondsSinceEpoch(value).toLocal();
    String two(int n) => n.toString().padLeft(2, '0');
    return date.year.toString() +
        '-' +
        two(date.month) +
        '-' +
        two(date.day) +
        ' ' +
        two(date.hour) +
        ':' +
        two(date.minute);
  }

  @override
  Widget build(BuildContext context) => Directionality(
        textDirection: TextDirection.rtl,
        child: Scaffold(
          appBar: AppBar(
            title: const Text('حقيبة الوكالة'),
            actions: [
              IconButton(
                onPressed: _busy ? null : _load,
                icon: const Icon(Icons.refresh),
              ),
            ],
          ),
          body: _loading
              ? const Center(child: CircularProgressIndicator())
              : _error != null
                  ? Center(
                      child: FilledButton.icon(
                        onPressed: _load,
                        icon: const Icon(Icons.refresh),
                        label: const Text('إعادة المحاولة'),
                      ),
                    )
                  : _packages.isEmpty
                      ? const Center(
                          child: Text('لا يوجد باكيج وكالة حاليًا.'),
                        )
                      : ListView(
                          padding: const EdgeInsets.all(14),
                          children: [
                            const Card(
                              child: ListTile(
                                leading: Icon(Icons.inventory_2_outlined),
                                title: Text('مخزون الوكالة'),
                                subtitle: Text(
                                  'التوزيع متاح للمالك فقط. انتهاء الباكيج يحذف حق توزيع الكميات المتبقية، ولا يلغي العناصر التي وُزعت سابقًا.',
                                ),
                              ),
                            ),
                            const SizedBox(height: 8),
                            for (final package in _packages)
                              Card(
                                child: Padding(
                                  padding: const EdgeInsets.all(12),
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.stretch,
                                    children: [
                                      Row(
                                        children: [
                                          Expanded(
                                            child: Text(
                                              package.templateName,
                                              style: const TextStyle(
                                                fontSize: 17,
                                                fontWeight: FontWeight.w900,
                                              ),
                                            ),
                                          ),
                                          Text(
                                            package.expired ? 'منتهي' : 'نشط',
                                            style: TextStyle(
                                              fontWeight: FontWeight.w800,
                                              color: package.expired
                                                  ? Colors.redAccent
                                                  : Colors.greenAccent,
                                            ),
                                          ),
                                        ],
                                      ),
                                      Text(
                                        'ينتهي: ' +
                                            _expiryLabel(package.expiresAtMs),
                                      ),
                                      const Divider(),
                                      for (final item in package.items)
                                        ListTile(
                                          contentPadding: EdgeInsets.zero,
                                          leading: item.imageUrl == null
                                              ? const CircleAvatar(
                                                  child: Icon(
                                                    Icons.auto_awesome,
                                                  ),
                                                )
                                              : CircleAvatar(
                                                  backgroundImage:
                                                      NetworkImage(
                                                    item.imageUrl!,
                                                  ),
                                                ),
                                          title: Text(
                                            item.nameAr.isEmpty
                                                ? item.assetKey
                                                : item.nameAr,
                                          ),
                                          subtitle: Text(
                                            'مدة المستلم: ' +
                                                item
                                                    .entitlementDurationHours
                                                    .toString() +
                                                ' ساعة • المتبقي: ' +
                                                (item.quantityRemaining ?? 0)
                                                    .toString(),
                                          ),
                                          trailing: FilledButton(
                                            onPressed: package.expired ||
                                                    _busy ||
                                                    (item.quantityRemaining ??
                                                            0) <=
                                                        0
                                                ? null
                                                : () => _distribute(
                                                      package,
                                                      item,
                                                    ),
                                            child: const Text('توزيع'),
                                          ),
                                        ),
                                    ],
                                  ),
                                ),
                              ),
                          ],
                        ),
        ),
      );
}
