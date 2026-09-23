import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import 'control_api_endpoints.dart';

import '../features/wallet/services/recharge_config_service.dart';
import '../utils/compact_number.dart';

class RechargePackagesControlPage extends StatefulWidget {
  const RechargePackagesControlPage({super.key});

  @override
  State<RechargePackagesControlPage> createState() =>
      _RechargePackagesControlPageState();
}

class _RechargePackagesControlPageState
    extends State<RechargePackagesControlPage> {
  bool loading = true;
  bool saving = false;
  String? error;
  List<RechargePackageConfig> packages = <RechargePackageConfig>[];

  Uri get apiUri => shadowEconomyEndpoint('recharge-config');

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<Map<String, dynamic>> post(Map<String, dynamic> payload) async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) throw StateError('يجب تسجيل الدخول.');
    final token = await user.getIdToken();
    if (token == null || token.isEmpty) {
      throw StateError('تعذر قراءة جلسة الإدارة.');
    }
    final response = await http
        .post(
          apiUri,
          headers: {
            'content-type': 'application/json',
            'authorization': 'Bearer ' + token,
          },
          body: jsonEncode(payload),
        )
        .timeout(const Duration(seconds: 25));
    final body = response.body.isEmpty
        ? <String, dynamic>{}
        : Map<String, dynamic>.from(jsonDecode(response.body) as Map);
    if (response.statusCode < 200 ||
        response.statusCode >= 300 ||
        body['ok'] != true) {
      throw StateError((body['code'] ?? 'request_failed').toString());
    }
    return body;
  }

  Future<void> load() async {
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final body = await post({'action': 'state'});
      final config = body['config'];
      final raw = config is Map ? config['packages'] : null;
      final loaded = raw is List
          ? raw
              .whereType<Map>()
              .map(
                (item) => RechargePackageConfig.fromMap(
                  Map<String, dynamic>.from(item),
                ),
              )
              .toList()
          : <RechargePackageConfig>[];
      loaded.sort((a, b) => a.sortOrder.compareTo(b.sortOrder));
      if (!mounted) return;
      setState(() {
        packages = loaded.isEmpty
            ? List<RechargePackageConfig>.from(
                RechargeConfigService.fallbackPackages,
              )
            : loaded;
        loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        packages = List<RechargePackageConfig>.from(
          RechargeConfigService.fallbackPackages,
        );
        loading = false;
        error = e.toString();
      });
    }
  }

  Future<void> save() async {
    if (packages.isEmpty) {
      message('يجب أن توجد باقة واحدة على الأقل.');
      return;
    }
    setState(() => saving = true);
    try {
      final payload = <Map<String, dynamic>>[
        for (var i = 0; i < packages.length; i++)
          {
            ...packages[i].toMap(),
            'sortOrder': i,
          },
      ];
      await post({'action': 'save', 'packages': payload});
      if (!mounted) return;
      setState(() => saving = false);
      message('تم حفظ باقات الشحن والـBonus بنجاح.');
      await load();
    } catch (e) {
      if (!mounted) return;
      setState(() => saving = false);
      message('تعذر الحفظ: ' + e.toString());
    }
  }

  void message(String value) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(value)));
  }

  Future<void> editPackage([int? index]) async {
    final current = index == null ? null : packages[index];
    final id = TextEditingController(text: current?.id ?? '');
    final productId =
        TextEditingController(text: current?.productId ?? '');
    final price = TextEditingController(
      text: current?.priceUsd.toStringAsFixed(2) ?? '',
    );
    final base = TextEditingController(
      text: current?.baseCoins.toString() ?? '',
    );
    final bonus = TextEditingController(
      text: current?.bonusCoins.toString() ?? '0',
    );
    final badge = TextEditingController(text: current?.badge ?? '');
    final image = TextEditingController(text: current?.imageAsset ?? '');
    var enabled = current?.enabled ?? true;

    final result = await showDialog<RechargePackageConfig>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, setLocal) => AlertDialog(
          title: Text(index == null ? 'إضافة باقة شحن' : 'تعديل باقة الشحن'),
          content: SizedBox(
            width: 520,
            child: SingleChildScrollView(
              child: Column(
                children: [
                  field(id, 'Package ID', 'coins_499'),
                  const SizedBox(height: 10),
                  field(productId, 'Google Play Product ID', 'shadow_coins_499'),
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      Expanded(
                        child: field(price, 'السعر USD', '4.99', numeric: true),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: field(base, 'Coins أساسية', '49900', numeric: true),
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  field(bonus, 'Bonus Coins', '10100', numeric: true),
                  const SizedBox(height: 10),
                  field(badge, 'Badge اختياري', 'الأكثر شعبية / أفضل قيمة'),
                  const SizedBox(height: 10),
                  field(image, 'Image Asset اختياري', 'assets/images/coins/...'),
                  SwitchListTile(
                    value: enabled,
                    onChanged: (value) => setLocal(() => enabled = value),
                    title: const Text('الباقة مفعلة'),
                    contentPadding: EdgeInsets.zero,
                  ),
                  const Text(
                    'العملات النهائية = Coins الأساسية + Bonus. '
                    'التطبيق يقرأ التعديل مباشرة بدون تحديث نسخة التطبيق.',
                    style: TextStyle(
                      fontSize: 12,
                      color: Color(0xFFAAA3B8),
                    ),
                  ),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text('إلغاء'),
            ),
            FilledButton(
              onPressed: () {
                final parsedPrice = double.tryParse(price.text.trim());
                final parsedBase = int.tryParse(base.text.trim());
                final parsedBonus = int.tryParse(bonus.text.trim());
                final cleanId = id.text.trim();
                final cleanProduct = productId.text.trim();
                if (!RegExp(r'^[a-z0-9_]{3,64}$').hasMatch(cleanId) ||
                    !RegExp(r'^[a-z0-9_.]{3,120}$')
                        .hasMatch(cleanProduct) ||
                    parsedPrice == null ||
                    parsedPrice <= 0 ||
                    parsedBase == null ||
                    parsedBase <= 0 ||
                    parsedBonus == null ||
                    parsedBonus < 0) {
                  message('راجع ID والسعر وعدد العملات والـBonus.');
                  return;
                }
                Navigator.pop(
                  dialogContext,
                  RechargePackageConfig(
                    id: cleanId,
                    productId: cleanProduct,
                    priceUsd: parsedPrice,
                    baseCoins: parsedBase,
                    bonusCoins: parsedBonus,
                    enabled: enabled,
                    badge: badge.text.trim(),
                    sortOrder: index ?? packages.length,
                    imageAsset: image.text.trim(),
                  ),
                );
              },
              child: const Text('اعتماد'),
            ),
          ],
        ),
      ),
    );

    id.dispose();
    productId.dispose();
    price.dispose();
    base.dispose();
    bonus.dispose();
    badge.dispose();
    image.dispose();

    if (result == null || !mounted) return;
    setState(() {
      if (index == null) {
        packages.add(result);
      } else {
        packages[index] = result;
      }
    });
  }

  Widget field(
    TextEditingController controller,
    String label,
    String hint, {
    bool numeric = false,
  }) {
    return TextField(
      controller: controller,
      keyboardType: numeric
          ? const TextInputType.numberWithOptions(decimal: true)
          : TextInputType.text,
      decoration: InputDecoration(
        labelText: label,
        hintText: hint,
        border: const OutlineInputBorder(),
      ),
    );
  }

  void move(int index, int delta) {
    final next = index + delta;
    if (next < 0 || next >= packages.length) return;
    setState(() {
      final item = packages.removeAt(index);
      packages.insert(next, item);
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('باقات الشحن والـBonus'),
        actions: [
          IconButton(
            onPressed: loading ? null : load,
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: loading ? null : () => editPackage(),
        icon: const Icon(Icons.add),
        label: const Text('إضافة باقة'),
      ),
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
              children: [
                const Card(
                  child: ListTile(
                    leading: Icon(
                      Icons.currency_exchange_rounded,
                      color: Color(0xFFD7B85A),
                    ),
                    title: Text(
                      'قاعدة الاقتصاد',
                      style: TextStyle(fontWeight: FontWeight.w900),
                    ),
                    subtitle: Text(
                      '1 USD = 10,000 Coins كأساس، والـBonus مستقل لكل باقة.',
                    ),
                  ),
                ),
                if (error != null)
                  Card(
                    child: ListTile(
                      leading: const Icon(
                        Icons.info_outline,
                        color: Colors.orangeAccent,
                      ),
                      title: const Text('تم تحميل القيم الافتراضية'),
                      subtitle: Text(error!),
                    ),
                  ),
                const SizedBox(height: 10),
                ...List.generate(packages.length, (index) {
                  final item = packages[index];
                  return Card(
                    child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: Row(
                        children: [
                          Switch(
                            value: item.enabled,
                            onChanged: (value) {
                              setState(() {
                                packages[index] = RechargePackageConfig(
                                  id: item.id,
                                  productId: item.productId,
                                  priceUsd: item.priceUsd,
                                  baseCoins: item.baseCoins,
                                  bonusCoins: item.bonusCoins,
                                  enabled: value,
                                  badge: item.badge,
                                  sortOrder: index,
                                  imageAsset: item.imageAsset,
                                );
                              });
                            },
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    Text(
                                      'USD ' + item.priceUsd.toStringAsFixed(2),
                                      style: const TextStyle(
                                        fontSize: 18,
                                        fontWeight: FontWeight.w900,
                                      ),
                                    ),
                                    const SizedBox(width: 8),
                                    if (item.badge.isNotEmpty)
                                      Chip(label: Text(item.badge)),
                                  ],
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  '🪙 ' +
                                      formatCompactAmount(item.totalCoins) +
                                      ' (' +
                                      formatCompactAmount(item.baseCoins) +
                                      ' + ' +
                                      formatCompactAmount(item.bonusCoins) +
                                      ' Bonus)',
                                ),
                                Text(
                                  'Product: ' + item.productId,
                                  style: const TextStyle(
                                    color: Color(0xFFAAA3B8),
                                    fontSize: 12,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          IconButton(
                            onPressed: index > 0 ? () => move(index, -1) : null,
                            icon: const Icon(Icons.arrow_upward_rounded),
                          ),
                          IconButton(
                            onPressed: index < packages.length - 1
                                ? () => move(index, 1)
                                : null,
                            icon: const Icon(Icons.arrow_downward_rounded),
                          ),
                          IconButton(
                            onPressed: () => editPackage(index),
                            icon: const Icon(Icons.edit_outlined),
                          ),
                          IconButton(
                            onPressed: packages.length <= 1
                                ? null
                                : () => setState(
                                      () => packages.removeAt(index),
                                    ),
                            icon: const Icon(
                              Icons.delete_outline_rounded,
                              color: Colors.redAccent,
                            ),
                          ),
                        ],
                      ),
                    ),
                  );
                }),
                const SizedBox(height: 14),
                FilledButton.icon(
                  onPressed: saving ? null : save,
                  icon: saving
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.save_rounded),
                  label: Text(saving ? 'جار الحفظ...' : 'حفظ جميع الباقات'),
                  style: FilledButton.styleFrom(
                    minimumSize: const Size.fromHeight(54),
                  ),
                ),
              ],
            ),
    );
  }
}
