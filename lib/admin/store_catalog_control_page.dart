import 'dart:convert';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;

import 'control_api_endpoints.dart';
import 'control_asset_manager_page.dart';
import 'control_firebase.dart';
import '../core/assets/shadow_asset_registry.dart';

const storeCategories = <String, String>{
  'frames': 'الإطارات',
  'entranceEffects': 'الدخوليات',
  'profileCards': 'البطاقات التعريفية',
  'voiceWaves': 'الموجات الصوتية',
  'chatBubbles': 'فقاعات الدردشة',
  'roomFrames': 'إطارات الغرفة',
  'backgrounds': 'الخلفيات',
  'nameEffects': 'تأثيرات الاسم',
};
const storeRarities = <String, String>{
  'normal': 'عادي', 'rare': 'نادر',
  'epic': 'ملحمي', 'legendary': 'أسطوري',
};
const storeDurations = <int, String>{
  0: 'دائم', 3: '3 أيام', 7: '7 أيام', 30: '30 يوماً',
};
const storeControlSections = <String>[
  'نظرة عامة', 'المنتجات', 'المشتريات', 'المنح',
  'مقتنيات المستخدمين', 'الإحصاءات', 'الإعدادات والصلاحيات',
];

const storeTemplates = <String, String>{
  'frames': 'frame.base.v1',
  'entranceEffects': 'entrance.base.v1',
  'profileCards': 'profile_card.base.v1',
  'voiceWaves': 'audio_wave.base.v1',
  'chatBubbles': 'chat_bubble.base.v1',
  'roomFrames': 'frame.base.v1',
  'backgrounds': 'room_background.base.v1',
  'nameEffects': 'name_effect.base.v1',
};

class StoreCatalogControlPage extends StatefulWidget {
  const StoreCatalogControlPage({super.key});

  @override
  State<StoreCatalogControlPage> createState() =>
      _StoreCatalogControlPageState();
}

class _StoreCatalogControlPageState extends State<StoreCatalogControlPage> {
  int activeSection = 0;
  bool loading = true;
  bool saving = false;
  bool editorOpen = false;
  bool dirty = false;
  // Keep an operation ID after an uncertain network failure so retrying
  // the same draft cannot submit a second catalog transaction.
  String? pendingSaveOperationId;
  String? error;
  String search = '';
  String categoryFilter = 'all';
  String visibilityFilter = 'all';
  int revision = 0;
  List<Map<String, dynamic>> items = [];

  @override
  void initState() {
    super.initState();
    _load(confirmDiscard: false);
  }

  Future<Map<String, dynamic>> _post(Map<String, dynamic> payload) async {
    final current = controlAuth.currentUser;
    if (current == null) throw StateError('unauthorized');
    final token = await current.getIdToken();
    if (token == null || token.isEmpty) throw StateError('unauthorized');
    final response = await http.post(
      shadowApiEndpoint('manage-store-catalog'),
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer $token',
      },
      body: jsonEncode(payload),
    ).timeout(const Duration(seconds: 30));
    final decoded = response.body.isEmpty
        ? <String, dynamic>{} : jsonDecode(response.body);
    if (decoded is! Map || decoded['ok'] != true ||
        response.statusCode < 200 || response.statusCode >= 300) {
      throw StateError(decoded is Map
          ? '${decoded['code'] ?? 'request_failed'}' : 'request_failed');
    }
    return Map<String, dynamic>.from(decoded);
  }

  String _friendly(Object failure) {
    final text = failure.toString();
    if (text.contains('store_catalog_conflict')) {
      return 'تغيّر المتجر من لوحة أخرى. راجع التعديلات قبل تحديث القائمة.';
    }
    if (text.contains('store_catalog_existing_id_missing')) {
      return 'ما فيك تحذف منتج قديم. اخفه بدل الحذف.';
    }
    if (text.contains('store_asset_not_published')) {
      return 'لا يمكن إظهار المنتج قبل نشر صورته في استوديو الأصول.';
    }
    if (text.contains('recent_auth_required')) {
      return 'سجّل دخولك مجدداً لتأكيد حفظ التعديلات.';
    }
    if (text.contains('forbidden')) return 'ما عندك صلاحية إدارة المتجر.';
    if (text.contains('invalid_store')) {
      return 'راجع بيانات المنتج والسعر ومدة الصلاحية.';
    }
    return 'تعذّر الاتصال أو حفظ البيانات. جرّب مجدداً.';
  }

  Future<void> _load({bool confirmDiscard = true}) async {
    if (loading && confirmDiscard) return;
    if (dirty && confirmDiscard) {
      final discard = await showDialog<bool>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: const Text('تعديلات غير محفوظة'),
          content: const Text('هل تريد تجاهل تعديلات المتجر وتحديث القائمة؟'),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('إلغاء'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(dialogContext, true),
              child: const Text('تحديث'),
            ),
          ],
        ),
      );
      if (discard != true || !mounted) return;
    }
    setState(() { loading = true; error = null; });
    try {
      final result = await _post({'action': 'state'});
      final raw = result['items'];
      if (raw is! List || result['revision'] is! int ||
          raw.length > 100 || raw.any((item) => item is! Map)) {
        throw StateError('invalid_store_catalog');
      }
      if (!mounted) return;
      setState(() {
        revision = result['revision'] as int;
        items = raw.map((item) => Map<String, dynamic>.from(item as Map))
            .toList();
        loading = false;
        dirty = false;
        pendingSaveOperationId = null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() { loading = false; error = _friendly(e); });
    }
  }

  String _nextId() {
    final occupied = items.map((item) => item['id'].toString()).toSet();
    for (var id = 200001; id <= 999999999; id++) {
      if (!occupied.contains('$id')) return '$id';
    }
    throw StateError('لا يوجد رقم متاح');
  }

  String _assetKey(String id) => 'store.item.$id.icon';

  Future<void> _openAsset(String id, String category) async {
    await Navigator.of(context).push(MaterialPageRoute<void>(
      builder: (_) => ControlAssetManagerPage(
        initialSearch: _assetKey(id),
        initialAssetKey: _assetKey(id),
        initialTemplateId: storeTemplates[category] ?? 'frame.base.v1',
        initialDirectory: 'assets/images/store',
        initialFileName: 'store_$id.webp',
      ),
    ));
    ShadowAssetRegistry.remoteUrl(_assetKey(id), refresh: true);
    if (mounted) setState(() {});
  }

  Future<void> _edit({Map<String, dynamic>? original}) async {
    if (saving || loading || editorOpen) return;
    if (original == null && items.length >= 100) {
      setState(() => error = 'وصل المتجر للحد الأعلى من المنتجات.');
      return;
    }
    final id = original?['id']?.toString() ?? _nextId();
    var selectedCategory = original?['category']?.toString() ?? 'frames';
    var selectedRarity = original?['rarity']?.toString() ?? 'normal';
    var selectedDuration = (original?['durationDays'] as num?)?.toInt() ?? 7;
    var minVipLevel = (original?['minVipLevel'] as num?)?.toInt() ?? 0;
    var enabled = original?['enabled'] == true;
    final name = TextEditingController(
      text: original?['nameAr']?.toString() ?? '',
    );
    final price = TextEditingController(
      text: original?['priceCoins']?.toString() ?? '1000',
    );
    final order = TextEditingController(
      text: original?['sortOrder']?.toString() ?? '${items.length + 1}',
    );
    final formKey = GlobalKey<FormState>();
    Map<String, dynamic> draftItem() => {
      'id': id,
      'nameAr': name.text.trim(),
      'category': selectedCategory,
      'priceCoins': int.parse(price.text),
      'durationDays': selectedDuration,
      'rarity': selectedRarity,
      'minVipLevel': minVipLevel,
      'enabled': enabled,
      'sortOrder': int.parse(order.text),
      'assetKey': _assetKey(id),
    };
    editorOpen = true;
    Map<String, dynamic>? result;
    try {
      result = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, update) => AlertDialog(
          title: Text(original == null ? 'إضافة منتج' : 'تعديل المنتج'),
          content: SizedBox(
            width: 440,
            child: SingleChildScrollView(
              child: Form(
                key: formKey,
                child: Column(mainAxisSize: MainAxisSize.min, children: [
                  TextFormField(
                    initialValue: id,
                    readOnly: true,
                    decoration: const InputDecoration(
                      labelText: 'رقم المنتج — تلقائي وثابت',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: name,
                    maxLength: 70,
                    decoration: const InputDecoration(
                      labelText: 'اسم المنتج بالعربي',
                      border: OutlineInputBorder(),
                    ),
                    validator: (value) => (value ?? '').trim().length < 2
                        ? 'اكتب اسم المنتج' : null,
                  ),
                  const SizedBox(height: 8),
                  TextFormField(
                    controller: price,
                    keyboardType: TextInputType.number,
                    inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                    decoration: const InputDecoration(
                      labelText: 'السعر بالكوينز',
                      border: OutlineInputBorder(),
                    ),
                    validator: (value) {
                      final n = int.tryParse(value ?? '');
                      return n == null || n < 0 || n > 2000000000
                          ? 'السعر غير صحيح' : null;
                    },
                  ),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<String>(
                    initialValue: selectedCategory,
                    isExpanded: true,
                    decoration: const InputDecoration(
                      labelText: 'الفئة', border: OutlineInputBorder(),
                    ),
                    items: storeCategories.entries.map((entry) =>
                      DropdownMenuItem(value: entry.key,
                        child: Text(entry.value))).toList(),
                    onChanged: (value) {
                      if (value != null) update(() => selectedCategory = value);
                    },
                  ),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<int>(
                    initialValue: selectedDuration,
                    decoration: const InputDecoration(
                      labelText: 'مدة المنتج', border: OutlineInputBorder(),
                    ),
                    items: storeDurations.entries.map((entry) =>
                      DropdownMenuItem(value: entry.key,
                        child: Text(entry.value))).toList(),
                    onChanged: (value) {
                      if (value != null) update(() => selectedDuration = value);
                    },
                  ),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<int>(
                    initialValue: minVipLevel,
                    decoration: const InputDecoration(
                      labelText: 'أهلية الشراء حسب VIP',
                      border: OutlineInputBorder(),
                    ),
                    items: List.generate(11, (level) =>
                      DropdownMenuItem(
                        value: level,
                        child: Text(level == 0 ? 'متاح للجميع' : 'VIP $level فما فوق'),
                      )),
                    onChanged: (value) {
                      if (value != null) update(() => minVipLevel = value);
                    },
                  ),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<String>(
                    initialValue: selectedRarity,
                    decoration: const InputDecoration(
                      labelText: 'الندرة', border: OutlineInputBorder(),
                    ),
                    items: storeRarities.entries.map((entry) =>
                      DropdownMenuItem(value: entry.key,
                        child: Text(entry.value))).toList(),
                    onChanged: (value) {
                      if (value != null) update(() => selectedRarity = value);
                    },
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    controller: order,
                    keyboardType: TextInputType.number,
                    inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                    decoration: const InputDecoration(
                      labelText: 'الترتيب', border: OutlineInputBorder(),
                    ),
                    validator: (value) {
                      final n = int.tryParse(value ?? '');
                      return n == null || n < 0 || n > 10000
                          ? 'الترتيب غير صحيح' : null;
                    },
                  ),
                  SwitchListTile(
                    title: const Text('إظهار المنتج'),
                    subtitle: Text(enabled
                      ? 'يتطلب الإظهار صورة منشورة في الاستوديو'
                      : 'مسودة محفوظة داخل الإدارة؛ الشراء غير مفعل'),
                    value: enabled,
                    onChanged: (value) => update(() => enabled = value),
                  ),
                  FutureBuilder<Uri?>(
                    future: ShadowAssetRegistry.remoteUrl(_assetKey(id)),
                    builder: (context, snapshot) => ListTile(
                      dense: true,
                      leading: Icon(snapshot.data == null
                          ? Icons.warning_amber_outlined
                          : Icons.verified_outlined),
                      title: Text(snapshot.connectionState == ConnectionState.waiting
                          ? 'جارٍ التحقق من الصورة المنشورة'
                          : snapshot.data == null
                              ? 'الصورة غير منشورة أو غير موجودة'
                              : 'صورة منشورة ومتاحة للمعاينة'),
                      subtitle: const Text('يمكن حفظ المسودة بدون صورة؛ النشر يتطلب صورة معتمدة.'),
                    ),
                  ),
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('صورة المنتج'),
                    subtitle: Text(_assetKey(id), textDirection: TextDirection.ltr),
                    trailing: const Icon(Icons.image_outlined),
                    onTap: () async {
                      await _openAsset(id, selectedCategory);
                      if (dialogContext.mounted) update(() {});
                    },
                  ),
                ]),
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text('إلغاء'),
            ),
            OutlinedButton.icon(
              onPressed: () {
                if (formKey.currentState?.validate() == true) {
                  _preview(draftItem());
                }
              },
              icon: const Icon(Icons.visibility_outlined),
              label: const Text('معاينة'),
            ),
            FilledButton(
              onPressed: () {
                if (formKey.currentState?.validate() != true) return;
                Navigator.pop(dialogContext, draftItem());
              },
              child: Text(enabled ? 'إضافة للقائمة' : 'حفظ كمسودة'),
            ),
          ],
        ),
      ),
    );
    } finally {
      editorOpen = false;
      name.dispose();
      price.dispose();
      order.dispose();
    }
    if (result == null || !mounted) return;
    final editedItem = result!;
    setState(() {
      if (original != null) {
        final existing = items.indexWhere(
          (item) => item['id'] == original['id']);
        if (existing >= 0) items[existing] = editedItem;
      } else {
        items.add(editedItem);
      }
      dirty = true;
      // A changed draft is a new operation. Previous retries must not save it.
      pendingSaveOperationId = null;
      error = null;
    });
  }

  Future<void> _save() async {
    if (loading || saving || !dirty) return;
    setState(() { saving = true; error = null; });
    // Reuse the same operation ID if the server committed but the reply was
    // lost. A changed draft or refreshed catalog clears this ID.
    pendingSaveOperationId ??= 'store_${DateTime.now().microsecondsSinceEpoch}_'
        '${Random.secure().nextInt(0x7fffffff)}';
    final operation = pendingSaveOperationId!;
    try {
      final result = await _post({
        'action': 'save', 'operationId': operation,
        'expectedRevision': revision, 'items': items,
      });
      if (result['revision'] is! int || result['items'] is! List) {
        throw StateError('invalid_store_catalog');
      }
      if (!mounted) return;
      setState(() {
        revision = result['revision'] as int;
        dirty = false;
        saving = false;
        pendingSaveOperationId = null;
        items = (result['items'] as List)
            .map((e) => Map<String, dynamic>.from(e as Map)).toList();
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تم حفظ كتالوج المتجر. الشراء غير مفعل.')),
      );
    } catch (e) {
      if (!mounted) return;
      setState(() { saving = false; error = _friendly(e); });
    }
  }

  Widget _image(String key) => FutureBuilder<Uri?>(
    future: ShadowAssetRegistry.remoteUrl(key),
    builder: (context, snapshot) {
      final uri = snapshot.data;
      if (uri == null) return const Icon(Icons.inventory_2_outlined, size: 38);
      return Image.network(
        uri.toString(), width: 64, height: 64, fit: BoxFit.contain,
        errorBuilder: (context, error, stackTrace) =>
            const Icon(Icons.image_not_supported_outlined),
      );
    },
  );

  Future<void> _preview(Map<String, dynamic> item) async {
    final key = item['assetKey'].toString();
    await showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('معاينة المنتج قبل النشر'),
        content: SizedBox(
          width: 350,
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            SizedBox(width: 92, height: 92, child: Center(child: _image(key))),
            const SizedBox(height: 12),
            Text(item['nameAr'].toString(),
              style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 8),
            Text("${storeCategories[item['category']] ?? ''} • "
                "${storeRarities[item['rarity']] ?? ''}"),
            Text("${item['priceCoins']} كوينز • "
                "${storeDurations[item['durationDays']] ?? ''}"),
            Text((item['minVipLevel'] as num? ?? 0) == 0
                ? 'متاح لجميع المستويات'
                : 'VIP ${item['minVipLevel']} فما فوق'),
            const SizedBox(height: 12),
            FutureBuilder<Uri?>(
              future: ShadowAssetRegistry.remoteUrl(key),
              builder: (context, snapshot) => Text(snapshot.data == null
                ? 'لا توجد صورة منشورة لهذا المنتج'
                : 'هذه الصورة المنشورة حالياً في الاستوديو'),
            ),
            const SizedBox(height: 8),
            Text(item['enabled'] == true ? 'جاهز للعرض بعد حفظ التعديلات'
                : 'مسودة — غير ظاهرة في المتجر'),
            const SizedBox(height: 8),
            const Text('المعاينة لا تنشر المنتج ولا تمنحه لأي مستخدم.'),
          ]),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('إغلاق'),
          ),
        ],
      ),
    );
  }

  Widget _navigation() => Wrap(
    spacing: 7, runSpacing: 6,
    children: [
      for (var index = 0; index < storeControlSections.length; index++)
        ChoiceChip(
          label: Text(storeControlSections[index]),
          selected: activeSection == index,
          onSelected: (_) => setState(() => activeSection = index),
        ),
    ],
  );

  Widget _sectionPanel() {
    if (activeSection == 0) {
      final visible = items.where((item) => item['enabled'] == true).length;
      return Column(children: [
        const Card(child: ListTile(
          leading: Icon(Icons.lock_outline),
          title: Text('المتجر قيد التجهيز'),
          subtitle: Text('الشراء والمنح غير مفعلين. الأرقام هنا للمنتجات فقط وليست مبيعات.'),
        )),
        Card(child: ListTile(
          leading: const Icon(Icons.inventory_2_outlined),
          title: Text('إجمالي المنتجات: ${items.length}'),
          subtitle: Text('ظاهرة: $visible • مسودات أو مخفية: ${items.length - visible}'),
          trailing: TextButton(
            onPressed: () => setState(() => activeSection = 1),
            child: const Text('إدارة المنتجات'),
          ),
        )),
        if (dirty) const Card(child: ListTile(
          leading: Icon(Icons.warning_amber_outlined),
          title: Text('توجد تعديلات لم تُحفظ بعد'),
          subtitle: Text('ارجع إلى المنتجات لحفظها أو مراجعتها.'),
        )),
      ]);
    }
    return Card(child: ListTile(
      leading: const Icon(Icons.lock_outline),
      title: Text(storeControlSections[activeSection]),
      subtitle: const Text(
        'هذا القسم محجوز للدفعات القادمة ولم يُفعّل بعد. '
        'لا توجد مشتريات أو منح أو أرقام مبيعات تجريبية. '
        'ستتم إضافة الصلاحيات وحراسة الخادم قبل تشغيل أي وظيفة حساسة.'),
    ));
  }

  @override
  Widget build(BuildContext context) {
    final filtered = items.where((item) {
      final text = '${item['nameAr']} ${item['id']}'.toLowerCase();
      if (!text.contains(search.toLowerCase().trim())) return false;
      if (categoryFilter != 'all' && item['category'] != categoryFilter) return false;
      if (visibilityFilter == 'shown' && item['enabled'] != true) return false;
      if (visibilityFilter == 'hidden' && item['enabled'] != false) return false;
      return true;
    }).toList()..sort((a, b) {
      final byOrder = ((a['sortOrder'] as num?) ?? 0)
          .compareTo((b['sortOrder'] as num?) ?? 0);
      if (byOrder != 0) return byOrder;
      return a['id'].toString().compareTo(b['id'].toString());
    });

    return Scaffold(
      appBar: AppBar(title: const Text('إدارة المتجر')),
      body: activeSection != 1
          ? ListView(padding: const EdgeInsets.all(16), children: [
              _navigation(),
              const SizedBox(height: 12),
              if (loading) const LinearProgressIndicator(),
              if (error != null) Text(error!),
              _sectionPanel(),
            ])
          : ListView(padding: const EdgeInsets.all(16), children: [
        _navigation(),
        const SizedBox(height: 12),
        const Card(child: ListTile(
          leading: Icon(Icons.lock_outline),
          title: Text('تجهيز منتجات المتجر'),
          subtitle: Text('تقدر تضيف المنتجات وتعدل السعر والصور والفئات. شراء المنتجات بالكوينز غير مفعل في هذه المرحلة.'),
        )),
        if (dirty) const Padding(
          padding: EdgeInsets.all(8),
          child: Text('عندك تعديلات غير محفوظة',
            style: TextStyle(color: Colors.amber)),
        ),
        if (error != null) Card(child: Padding(
          padding: const EdgeInsets.all(12),
          child: Text(error!, style: const TextStyle(color: Colors.orangeAccent)),
        )),
        Wrap(spacing: 8, runSpacing: 8, children: [
          FilledButton.icon(
            onPressed: loading || saving ? null : () => _edit(),
            icon: const Icon(Icons.add),
            label: const Text('إضافة منتج'),
          ),
          FilledButton.tonalIcon(
            onPressed: loading || saving || !dirty ? null : _save,
            icon: const Icon(Icons.save_outlined),
            label: const Text('حفظ التعديلات'),
          ),
          OutlinedButton.icon(
            onPressed: loading || saving ? null : () => _load(),
            icon: const Icon(Icons.refresh),
            label: const Text('تحديث'),
          ),
        ]),
        const SizedBox(height: 12),
        TextField(
          onChanged: (v) => setState(() => search = v),
          decoration: const InputDecoration(
            labelText: 'ابحث باسم المنتج أو رقمه',
            prefixIcon: Icon(Icons.search), border: OutlineInputBorder(),
          ),
        ),
        const SizedBox(height: 10),
        Wrap(spacing: 10, runSpacing: 8, children: [
          DropdownButton<String>(
            value: categoryFilter,
            items: [
              const DropdownMenuItem(value: 'all', child: Text('جميع الفئات')),
              ...storeCategories.entries.map((e) =>
                DropdownMenuItem(value: e.key, child: Text(e.value))),
            ],
            onChanged: (v) {
              if (v != null) setState(() => categoryFilter = v);
            },
          ),
          DropdownButton<String>(
            value: visibilityFilter,
            items: const [
              DropdownMenuItem(value: 'all', child: Text('الكل')),
              DropdownMenuItem(value: 'shown', child: Text('ظاهرة')),
              DropdownMenuItem(value: 'hidden', child: Text('مخفية')),
            ],
            onChanged: (v) {
              if (v != null) setState(() => visibilityFilter = v);
            },
          ),
        ]),
        const SizedBox(height: 8),
        if (loading || saving) const LinearProgressIndicator(),
        Text('${filtered.length} منتج • إجمالي ${items.length}'),
        if (!loading && filtered.isEmpty)
          const Card(child: ListTile(
            leading: Icon(Icons.inventory_2_outlined),
            title: Text('لا توجد منتجات تطابق البحث'),
          )),
        for (final item in filtered) Card(
          child: ListTile(
            leading: SizedBox(
              width: 64, height: 64,
              child: _image(item['assetKey'].toString()),
            ),
            title: Text(item['nameAr'].toString()),
            subtitle: Text(
              'رقم ${item['id']} • ${storeCategories[item['category']] ?? item['category']}\n'
              '${item['priceCoins']} كوينز • ${storeDurations[item['durationDays']] ?? ''} • '
              '${item['enabled'] == true ? 'ظاهرة' : 'مسودة / مخفية'}',
            ),
            isThreeLine: true,
            trailing: Wrap(mainAxisSize: MainAxisSize.min, children: [
              IconButton(
                tooltip: 'معاينة المنتج',
                icon: const Icon(Icons.visibility_outlined),
                onPressed: () => _preview(item),
              ),
              IconButton(
                tooltip: 'تعديل المنتج',
                icon: const Icon(Icons.edit_outlined),
                onPressed: loading || saving ? null : () => _edit(original: item),
              ),
            ]),
            onTap: loading || saving ? null : () => _edit(original: item),
          ),
        ),
      ]),
    );
  }
}
