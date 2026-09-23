import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import 'control_api_endpoints.dart';

import '../features/gift/services/gift_catalog_service.dart';
import '../utils/compact_number.dart';

class GiftCatalogControlPage extends StatefulWidget {
  const GiftCatalogControlPage({super.key});

  @override
  State<GiftCatalogControlPage> createState() =>
      _GiftCatalogControlPageState();
}

class _GiftCatalogControlPageState extends State<GiftCatalogControlPage> {
  bool loading = true;
  bool saving = false;
  String? error;
  List<GiftCatalogItem> gifts = <GiftCatalogItem>[];

  Uri get apiUri => shadowEconomyEndpoint('gift-catalog');

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
    final decoded = response.body.isEmpty
        ? <String, dynamic>{}
        : Map<String, dynamic>.from(jsonDecode(response.body) as Map);
    if (response.statusCode < 200 ||
        response.statusCode >= 300 ||
        decoded['ok'] != true) {
      throw StateError((decoded['code'] ?? 'request_failed').toString());
    }
    return decoded;
  }

  Future<void> load() async {
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final body = await post({'action': 'state'});
      final config = body['config'];
      final raw = config is Map ? config['gifts'] : null;
      final loaded = raw is List
          ? raw
              .whereType<Map>()
              .map(
                (item) => GiftCatalogItem.fromMap(
                  Map<String, dynamic>.from(item),
                ),
              )
              .toList()
          : <GiftCatalogItem>[];
      loaded.sort((a, b) => a.sortOrder.compareTo(b.sortOrder));
      if (!mounted) return;
      setState(() {
        gifts = loaded.isEmpty
            ? List<GiftCatalogItem>.from(GiftCatalogService.fallbackGifts)
            : loaded;
        loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        gifts = List<GiftCatalogItem>.from(GiftCatalogService.fallbackGifts);
        loading = false;
        error = e.toString();
      });
    }
  }

  Future<void> save() async {
    if (gifts.isEmpty) {
      message('يجب أن توجد هدية واحدة على الأقل.');
      return;
    }
    setState(() => saving = true);
    try {
      final payload = <Map<String, dynamic>>[
        for (var i = 0; i < gifts.length; i++)
          {
            ...gifts[i].toMap(),
            'sortOrder': i,
          },
      ];
      await post({'action': 'save', 'gifts': payload});
      if (!mounted) return;
      setState(() => saving = false);
      message('تم حفظ Gift Catalog بنجاح.');
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

  Future<void> editGift([int? index]) async {
    final current = index == null ? null : gifts[index];
    final id = TextEditingController(text: current?.id ?? '');
    final nameAr = TextEditingController(text: current?.nameAr ?? '');
    final price = TextEditingController(
      text: current?.priceCoins.toString() ?? '',
    );
    final assetKey = TextEditingController(
      text: current?.assetKey ?? 'gifts.placeholder.default',
    );
    final placeholder = TextEditingController(
      text: current?.localPlaceholder ??
          'assets/images/gifts/gift_placeholder.webp',
    );
    var enabled = current?.enabled ?? true;
    var featured = current?.featured ?? false;
    var category = current?.category ?? 'general';

    final result = await showDialog<GiftCatalogItem>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, setLocal) => AlertDialog(
          title: Text(index == null ? 'إضافة هدية' : 'تعديل الهدية'),
          content: SizedBox(
            width: 540,
            child: SingleChildScrollView(
              child: Column(
                children: [
                  field(id, 'Gift ID', 'rose'),
                  const SizedBox(height: 10),
                  field(nameAr, 'اسم الهدية بالعربي', 'وردة'),
                  const SizedBox(height: 10),
                  field(price, 'السعر Coins', '100', numeric: true),
                  const SizedBox(height: 10),
                  DropdownButtonFormField<String>(
                    value: category,
                    decoration: const InputDecoration(
                      labelText: 'الفئة',
                      border: OutlineInputBorder(),
                    ),
                    items: GiftCatalogService.categories
                        .map(
                          (value) => DropdownMenuItem(
                            value: value,
                            child: Text(value),
                          ),
                        )
                        .toList(),
                    onChanged: (value) {
                      if (value != null) setLocal(() => category = value);
                    },
                  ),
                  const SizedBox(height: 10),
                  field(
                    assetKey,
                    'Asset Key',
                    'gifts.placeholder.default',
                  ),
                  const SizedBox(height: 10),
                  field(
                    placeholder,
                    'Local Placeholder',
                    'assets/images/gifts/gift_placeholder.webp',
                  ),
                  SwitchListTile(
                    value: enabled,
                    onChanged: (value) => setLocal(() => enabled = value),
                    title: const Text('الهدية مفعلة'),
                    contentPadding: EdgeInsets.zero,
                  ),
                  SwitchListTile(
                    value: featured,
                    onChanged: (value) => setLocal(() => featured = value),
                    title: const Text('هدية مميزة Featured'),
                    contentPadding: EdgeInsets.zero,
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
                final cleanId = id.text.trim();
                final cleanName = nameAr.text.trim();
                final parsedPrice = int.tryParse(price.text.trim());
                final cleanAsset = assetKey.text.trim();
                final cleanPlaceholder = placeholder.text.trim();
                if (!RegExp(r'^[a-z0-9_]{2,64}$').hasMatch(cleanId) ||
                    cleanName.isEmpty ||
                    parsedPrice == null ||
                    parsedPrice <= 0 ||
                    !RegExp(r'^[a-z0-9][a-z0-9._-]{2,119}$')
                        .hasMatch(cleanAsset) ||
                    !cleanPlaceholder.startsWith('assets/images/gifts/')) {
                  message('راجع Gift ID والاسم والسعر ومسار الصورة.');
                  return;
                }
                Navigator.pop(
                  dialogContext,
                  GiftCatalogItem(
                    id: cleanId,
                    nameAr: cleanName,
                    priceCoins: parsedPrice,
                    category: category,
                    enabled: enabled,
                    featured: featured,
                    sortOrder: index ?? gifts.length,
                    assetKey: cleanAsset,
                    localPlaceholder: cleanPlaceholder,
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
    nameAr.dispose();
    price.dispose();
    assetKey.dispose();
    placeholder.dispose();

    if (result == null || !mounted) return;
    setState(() {
      if (index == null) {
        gifts.add(result);
      } else {
        gifts[index] = result;
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
      keyboardType: numeric ? TextInputType.number : TextInputType.text,
      decoration: InputDecoration(
        labelText: label,
        hintText: hint,
        border: const OutlineInputBorder(),
      ),
    );
  }

  void move(int index, int delta) {
    final next = index + delta;
    if (next < 0 || next >= gifts.length) return;
    setState(() {
      final item = gifts.removeAt(index);
      gifts.insert(next, item);
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Gift Catalog'),
        actions: [
          IconButton(
            onPressed: loading ? null : load,
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: loading ? null : () => editGift(),
        icon: const Icon(Icons.add),
        label: const Text('إضافة هدية'),
      ),
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 96),
              children: [
                const Card(
                  child: ListTile(
                    leading: Icon(
                      Icons.card_giftcard_rounded,
                      color: Color(0xFFD7B85A),
                    ),
                    title: Text(
                      'كتالوج الهدايا الديناميكي',
                      style: TextStyle(fontWeight: FontWeight.w900),
                    ),
                    subtitle: Text(
                      'يمكن تعديل الاسم والسعر والفئة والصورة والترتيب بدون تحديث التطبيق.',
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
                ...List.generate(gifts.length, (index) {
                  final item = gifts[index];
                  return Card(
                    child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Switch(
                                value: item.enabled,
                                onChanged: (value) {
                                  setState(() {
                                    gifts[index] = GiftCatalogItem(
                                      id: item.id,
                                      nameAr: item.nameAr,
                                      priceCoins: item.priceCoins,
                                      category: item.category,
                                      enabled: value,
                                      featured: item.featured,
                                      sortOrder: index,
                                      assetKey: item.assetKey,
                                      localPlaceholder: item.localPlaceholder,
                                    );
                                  });
                                },
                              ),
                              const SizedBox(width: 8),
                              const CircleAvatar(
                                backgroundColor: Color(0xFF261A45),
                                child: Icon(
                                  Icons.card_giftcard_rounded,
                                  color: Color(0xFFFFD54A),
                                ),
                              ),
                              const SizedBox(width: 10),
                              Expanded(
                                child: Text(
                                  item.nameAr,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    fontSize: 17,
                                    fontWeight: FontWeight.w900,
                                  ),
                                ),
                              ),
                              if (item.featured)
                                const Flexible(child: Chip(label: Text('Featured'))),
                            ],
                          ),
                          const SizedBox(height: 4),
                          Text(
                            '🪙 ' +
                                formatCompactAmount(item.priceCoins) +
                                ' • ' +
                                item.category,
                          ),
                          Directionality(
                            textDirection: TextDirection.ltr,
                            child: Text(
                              'Asset: ' + item.assetKey,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: Color(0xFFAAA3B8),
                                fontSize: 12,
                              ),
                            ),
                          ),
                          const SizedBox(height: 6),
                          Wrap(
                            spacing: 2,
                            runSpacing: 2,
                            children: [
                              IconButton(
                                onPressed: index > 0 ? () => move(index, -1) : null,
                                icon: const Icon(Icons.arrow_upward_rounded),
                              ),
                              IconButton(
                                onPressed: index < gifts.length - 1
                                    ? () => move(index, 1)
                                    : null,
                                icon: const Icon(Icons.arrow_downward_rounded),
                              ),
                              IconButton(
                                onPressed: () => editGift(index),
                                icon: const Icon(Icons.edit_outlined),
                              ),
                              IconButton(
                                onPressed: gifts.length <= 1
                                    ? null
                                    : () => setState(() => gifts.removeAt(index)),
                                icon: const Icon(
                                  Icons.delete_outline_rounded,
                                  color: Colors.redAccent,
                                ),
                              ),
                            ],
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
                  label: Text(saving ? 'جار الحفظ...' : 'حفظ Gift Catalog'),
                  style: FilledButton.styleFrom(
                    minimumSize: const Size.fromHeight(54),
                  ),
                ),
              ],
            ),
    );
  }
}
