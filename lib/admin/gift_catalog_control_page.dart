import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import 'control_api_endpoints.dart';
import 'control_firebase.dart';

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
    final user = controlAuth.currentUser;
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
      message('تم حفظ كتالوج الهدايا بنجاح.');
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

  Future<void> grantBagGift() async {
    if (gifts.isEmpty) {
      message('لا توجد هدايا متاحة للمنح.');
      return;
    }

    final userId = TextEditingController();
    final quantity = TextEditingController(text: '1');
    var giftId = gifts.first.id;
    var source = 'admin';

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, setLocal) => AlertDialog(
          title: const Text('منح هدية إلى الحقيبة'),
          content: SizedBox(
            width: 480,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  field(
                    userId,
                    'ID المستخدم',
                    'أدخل ID المستخدم',
                  ),
                  const SizedBox(height: 10),
                  DropdownButtonFormField<String>(
                    value: giftId,
                    decoration: const InputDecoration(
                      labelText: 'الهدية',
                      border: OutlineInputBorder(),
                    ),
                    items: gifts
                        .where((item) => item.enabled)
                        .map(
                          (item) => DropdownMenuItem<String>(
                            value: item.id,
                            child: Text(
                              item.nameAr +
                                  ' • ' +
                                  formatCompactAmount(item.priceCoins) +
                                  ' كوين',
                            ),
                          ),
                        )
                        .toList(),
                    onChanged: (value) {
                      if (value != null) setLocal(() => giftId = value);
                    },
                  ),
                  const SizedBox(height: 10),
                  field(
                    quantity,
                    'الكمية',
                    '1 إلى 9999',
                    numeric: true,
                  ),
                  const SizedBox(height: 10),
                  DropdownButtonFormField<String>(
                    value: source,
                    decoration: const InputDecoration(
                      labelText: 'مصدر الهدية',
                      border: OutlineInputBorder(),
                    ),
                    items: const [
                      DropdownMenuItem(
                        value: 'admin',
                        child: Text('من الإدارة'),
                      ),
                      DropdownMenuItem(
                        value: 'event',
                        child: Text('من فعالية'),
                      ),
                      DropdownMenuItem(
                        value: 'free',
                        child: Text('هدية مجانية'),
                      ),
                    ],
                    onChanged: (value) {
                      if (value != null) setLocal(() => source = value);
                    },
                  ),
                  const SizedBox(height: 10),
                  const Text(
                    'الهدية الممنوحة تدخل الحقيبة ولا تخصم كوينز عند استخدامها، ولا تُحتسب ضمن الثروة أو التارغت أو أرباح الوكالة.',
                    style: TextStyle(color: Color(0xFF8D8797)),
                  ),
                ],
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('إلغاء'),
            ),
            FilledButton.icon(
              onPressed: () => Navigator.pop(dialogContext, true),
              icon: const Icon(Icons.card_giftcard_rounded),
              label: const Text('منح للحقيبة'),
            ),
          ],
        ),
      ),
    );

    if (confirmed != true) {
      userId.dispose();
      quantity.dispose();
      return;
    }

    final targetUserId = userId.text.trim();
    final parsedQuantity = int.tryParse(quantity.text.trim()) ?? 0;
    userId.dispose();
    quantity.dispose();

    if (targetUserId.isEmpty || parsedQuantity < 1 || parsedQuantity > 9999) {
      message('تأكد من ID المستخدم والكمية من 1 إلى 9999.');
      return;
    }

    setState(() => saving = true);
    try {
      await post({
        'action': 'grantBagGift',
        'targetUserId': targetUserId,
        'giftId': giftId,
        'quantity': parsedQuantity,
        'source': source,
      });
      if (!mounted) return;
      setState(() => saving = false);
      message(
        'تم منح ' +
            formatCompactAmount(parsedQuantity) +
            ' من الهدية إلى حقيبة المستخدم.',
      );
    } catch (e) {
      if (!mounted) return;
      setState(() => saving = false);
      message('تعذر منح الهدية: ' + e.toString());
    }
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
    var minVipLevel = current?.effectiveMinVipLevel ?? 0;
    var isAnimated = current?.isAnimated ?? false;
    var effectMode = current?.effectMode ?? 'none';
    final effectAssetKey = TextEditingController(
      text: current?.effectiveEffectAssetKey ??
          current?.assetKey ??
          'gifts.placeholder.default',
    );
    final effectSoundAssetKey = TextEditingController(
      text: current?.effectSoundAssetKey ?? '',
    );
    final effectMinQuantity = TextEditingController(
      text: (current?.effectMinQuantity ?? 0).toString(),
    );
    final effectDurationMs = TextEditingController(
      text: (current?.effectDurationMs ?? 2200).toString(),
    );
    final effectSize = TextEditingController(
      text: (current?.effectSize ?? 0).toString(),
    );
    final premiumBannerMinQuantity = TextEditingController(
      text: (current?.premiumBannerMinQuantity ?? 0).toString(),
    );
    final affinityBasePoints = TextEditingController(
      text: (current?.affinityBasePoints ?? 0).toString(),
    );

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
                  field(id, 'معرّف الهدية', 'rose'),
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
                            child: Text(
                              GiftCatalogService.categoryLabel(value),
                            ),
                          ),
                        )
                        .toList(),
                    onChanged: (value) {
                      if (value != null) {
                        setLocal(() {
                          category = value;
                          if (category == 'vip' && minVipLevel == 0) {
                            minVipLevel = 4;
                          }
                        });
                      }
                    },
                  ),
                  const SizedBox(height: 10),
                  DropdownButtonFormField<int>(
                    value: minVipLevel,
                    decoration: const InputDecoration(
                      labelText: 'الحد الأدنى VIP',
                      border: OutlineInputBorder(),
                    ),
                    items: const <DropdownMenuItem<int>>[
                      DropdownMenuItem(value: 0, child: Text('متاحة للجميع')),
                      DropdownMenuItem(value: 4, child: Text('VIP4+')),
                      DropdownMenuItem(value: 5, child: Text('VIP5+')),
                      DropdownMenuItem(value: 6, child: Text('VIP6+')),
                      DropdownMenuItem(value: 7, child: Text('VIP7+')),
                      DropdownMenuItem(value: 8, child: Text('VIP8+')),
                      DropdownMenuItem(value: 9, child: Text('VIP9+')),
                      DropdownMenuItem(value: 10, child: Text('VIP10')),
                    ],
                    onChanged: (value) {
                      if (value != null) setLocal(() => minVipLevel = value);
                    },
                  ),
                  const SizedBox(height: 10),
                  field(
                    assetKey,
                    'مفتاح الأصل',
                    'gifts.placeholder.default',
                  ),
                  const SizedBox(height: 10),
                  field(
                    placeholder,
                    'الصورة الاحتياطية',
                    'assets/images/gifts/gift_placeholder.webp',
                  ),
                  const SizedBox(height: 10),
                  SwitchListTile(
                    value: isAnimated,
                    onChanged: (value) =>
                        setLocal(() => isAnimated = value),
                    title: const Text('الأصل متحرك'),
                    contentPadding: EdgeInsets.zero,
                  ),
                  const SizedBox(height: 4),
                  DropdownButtonFormField<String>(
                    value: effectMode,
                    decoration: const InputDecoration(
                      labelText: 'نوع مؤثر الغرفة',
                      border: OutlineInputBorder(),
                    ),
                    items: const [
                      DropdownMenuItem(
                        value: 'none',
                        child: Text('بدون مؤثر'),
                      ),
                      DropdownMenuItem(
                        value: 'seat',
                        child: Text('خفيف على المايك'),
                      ),
                      DropdownMenuItem(
                        value: 'cinematic',
                        child: Text('سينمائي فوق الغرفة'),
                      ),
                    ],
                    onChanged: (value) {
                      if (value != null) {
                        setLocal(() => effectMode = value);
                      }
                    },
                  ),
                  const SizedBox(height: 10),
                  field(
                    effectAssetKey,
                    'مفتاح أصل المؤثر',
                    'gifts.effect.example',
                  ),
                  const SizedBox(height: 10),
                  field(
                    effectSoundAssetKey,
                    'مفتاح صوت المؤثر — اختياري',
                    'gifts.example.sound',
                  ),
                  const SizedBox(height: 10),
                  field(
                    effectMinQuantity,
                    'أقل كمية لتشغيل المؤثر (0 = بدون مؤثر)',
                    '7',
                    numeric: true,
                  ),
                  const SizedBox(height: 10),
                  field(
                    effectDurationMs,
                    'مدة المؤثر بالمللي ثانية',
                    '2200',
                    numeric: true,
                  ),
                  const SizedBox(height: 10),
                  field(
                    effectSize,
                    'حجم المؤثر (0 = تلقائي، 40–420)',
                    '0',
                    numeric: true,
                  ),
                  const SizedBox(height: 10),
                  field(
                    premiumBannerMinQuantity,
                    'أقل كمية للشريط الفاخر (0 = معطل)',
                    '0',
                    numeric: true,
                  ),
                  if (category == 'cp' || category == 'friends') ...[
                    const SizedBox(height: 10),
                    field(
                      affinityBasePoints,
                      'نقاط العلاقة الأساسية — عدد زوجي',
                      '100',
                      numeric: true,
                    ),
                  ],
                  SwitchListTile(
                    value: enabled,
                    onChanged: (value) => setLocal(() => enabled = value),
                    title: const Text('الهدية مفعلة'),
                    contentPadding: EdgeInsets.zero,
                  ),
                  SwitchListTile(
                    value: featured,
                    onChanged: (value) => setLocal(() => featured = value),
                    title: const Text('هدية مميزة أعلى الواجهة'),
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
                final cleanEffectAssetKey = effectAssetKey.text.trim();
                final cleanEffectSoundAssetKey =
                    effectSoundAssetKey.text.trim();
                final parsedEffectMin =
                    int.tryParse(effectMinQuantity.text.trim()) ?? 0;
                final parsedEffectDuration =
                    int.tryParse(effectDurationMs.text.trim()) ?? 2200;
                final parsedEffectSize =
                    int.tryParse(effectSize.text.trim()) ?? 0;
                final parsedPremiumBannerMin =
                    int.tryParse(premiumBannerMinQuantity.text.trim()) ?? 0;
                final parsedAffinity =
                    int.tryParse(affinityBasePoints.text.trim()) ?? 0;
                final relationshipGift =
                    category == 'cp' || category == 'friends';
                if (!RegExp(r'^[a-z0-9_]{2,64}$').hasMatch(cleanId) ||
                    cleanName.isEmpty ||
                    parsedPrice == null ||
                    parsedPrice <= 0 ||
                    !RegExp(r'^[a-z0-9][a-z0-9._-]{2,119}$')
                        .hasMatch(cleanAsset) ||
                    !cleanPlaceholder.startsWith('assets/images/gifts/') ||
                    !RegExp(r'^[a-z0-9][A-Za-z0-9._-]{2,119}$')
                        .hasMatch(cleanEffectAssetKey) ||
                    (cleanEffectSoundAssetKey.isNotEmpty &&
                        !RegExp(r'^[a-z0-9][A-Za-z0-9._-]{2,119}$')
                            .hasMatch(cleanEffectSoundAssetKey)) ||
                    parsedEffectMin < 0 ||
                    parsedEffectMin > 777 ||
                    (effectMode == 'none' && parsedEffectMin != 0) ||
                    (effectMode != 'none' && parsedEffectMin < 1) ||
                    parsedEffectDuration < 300 ||
                    parsedEffectDuration > 12000 ||
                    parsedEffectSize < 0 ||
                    parsedEffectSize > 420 ||
                    (parsedEffectSize > 0 && parsedEffectSize < 40) ||
                    parsedPremiumBannerMin < 0 ||
                    parsedPremiumBannerMin > 777 ||
                    (relationshipGift &&
                        (parsedAffinity < 2 || parsedAffinity.isOdd)) ||
                    (!relationshipGift && parsedAffinity != 0)) {
                  message('راجع بيانات الهدية والمؤثر ونقاط العلاقة.');
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
                    minVipLevel: minVipLevel,
                    isAnimated: isAnimated,
                    effectMode: effectMode,
                    effectAssetKey: cleanEffectAssetKey,
                    effectSoundAssetKey: cleanEffectSoundAssetKey,
                    effectMinQuantity: parsedEffectMin,
                    effectDurationMs: parsedEffectDuration,
                    effectSize: parsedEffectSize,
                    premiumBannerMinQuantity: parsedPremiumBannerMin,
                    affinityBasePoints: parsedAffinity,
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
    effectAssetKey.dispose();
    effectSoundAssetKey.dispose();
    effectMinQuantity.dispose();
    effectDurationMs.dispose();
    effectSize.dispose();
    premiumBannerMinQuantity.dispose();
    affinityBasePoints.dispose();

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
        title: const Text('كتالوج الهدايا'),
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
                Card(
                  child: ListTile(
                    leading: const Icon(
                      Icons.shopping_bag_rounded,
                      color: Color(0xFFFFD54A),
                    ),
                    title: const Text(
                      'منح هدية إلى حقيبة مستخدم',
                      style: TextStyle(fontWeight: FontWeight.w900),
                    ),
                    subtitle: const Text(
                      'للإدارة والفعاليات والهدايا المجانية — بدون خصم كوينز من المستلم.',
                    ),
                    trailing: FilledButton(
                      onPressed: saving ? null : grantBagGift,
                      child: const Text('منح'),
                    ),
                    onTap: saving ? null : grantBagGift,
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
                                      minVipLevel: item.minVipLevel,
                                      isAnimated: item.isAnimated,
                                      effectMode: item.effectMode,
                                      effectAssetKey: item.effectAssetKey,
                                      effectSoundAssetKey:
                                          item.effectSoundAssetKey,
                                      effectMinQuantity: item.effectMinQuantity,
                                      effectDurationMs: item.effectDurationMs,
                                      effectSize: item.effectSize,
                                      premiumBannerMinQuantity:
                                          item.premiumBannerMinQuantity,
                                      affinityBasePoints:
                                          item.affinityBasePoints,
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
                                const Flexible(child: Chip(label: Text('مميزة'))),
                            ],
                          ),
                          const SizedBox(height: 4),
                          Text(
                            '🪙 ' +
                                formatCompactAmount(item.priceCoins) +
                                ' • ' +
                                GiftCatalogService.categoryLabel(
                                  item.category,
                                ) +
                                (item.effectiveMinVipLevel > 0
                                    ? ' • VIP' +
                                        item.effectiveMinVipLevel.toString() +
                                        '+'
                                    : ''),
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
                  label: Text(saving ? 'جار الحفظ...' : 'حفظ كتالوج الهدايا'),
                  style: FilledButton.styleFrom(
                    minimumSize: const Size.fromHeight(54),
                  ),
                ),
              ],
            ),
    );
  }
}
