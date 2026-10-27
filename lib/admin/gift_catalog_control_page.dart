import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import 'control_api_endpoints.dart';
import 'control_asset_manager_page.dart';
import 'control_firebase.dart';
import '../core/assets/shadow_asset_registry.dart';

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
  bool loadFailed = false;
  bool editing = false;
  bool grantDialogOpen = false;
  bool hasUnsavedChanges = false;
  bool categoryUnsaved = false;
  bool categoryEditorOpen = false;
  List<Map<String, dynamic>> categoryDefinitions = [];
  int catalogRevision = 0;
  int visibleLimit = 20;
  int selectedSection = 0;
  String query = '';
  String categoryFilter = 'all';
  String visibilityFilter = 'all';
  String orderFilter = 'catalog';
  String? error;
  List<GiftCatalogItem> gifts = <GiftCatalogItem>[];
  List<GiftCatalogItem> drafts = <GiftCatalogItem>[];
  GiftCatalogItem? pendingDraft;

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

  String friendlyError(Object failure) {
    final code = failure.toString();
    if (code.contains('duplicate_gift_id')) {
      return 'رقم الهدية مستخدم من قبل. اختر رقمًا مختلفًا.';
    }
    if (code.contains('invalid_gift_price')) {
      return 'سعر الهدية غير صحيح. أدخل قيمة كوينز صحيحة.';
    }
    if (code.contains('invalid_gift_contexts')) {
      return 'اختر مكانًا واحدًا على الأقل لظهور الهدية.';
    }
    if (code.contains('invalid_gift_schedule')) {
      return 'تأكد أن موعد نهاية الهدية بعد بداية ظهورها.';
    }
    if (code.contains('gift_draft_already_published')) {
      return 'رقم الهدية مستخدم في الهدايا المنشورة. اختر رقماً آخر.';
    }
    if (code.contains('gift_draft_not_found')) {
      return 'المسودة غير موجودة. حدّث الصفحة وأعد المحاولة.';
    }
    if (code.contains('gift_draft_limit')) {
      return 'وصلت للعدد الأقصى من المسودات. انشر مسودة أو احذف إحداها.';
    }
    if (code.contains('gift_catalog_conflict')) {
      return 'تم تعديل الهدايا من لوحة أخرى. احتفظنا بتعديلاتك هنا؛ لا تحفظ قبل مراجعة أحدث البيانات.';
    }
    if (code.contains('gift_catalog_existing_id_missing')) {
      return 'لا يمكن حذف هدية قديمة أو تغيير رقمها. يمكنك إخفاؤها بدلًا من ذلك.';
    }
    if (code.contains('gift_catalog_restricted_category')) {
      return 'لا يمكن نقل هدايا الامتياز أو العلاقات إلى فئة أخرى بهذه الطريقة.';
    }
    if (code.contains('gift_catalog_not_initialized')) {
      return 'احفظ كتالوج الهدايا الأساسي أولًا، ثم عد إلى إدارة الفئات.';
    }
    if (code.contains('gift_category_missing')) {
      return 'لا يمكن إزالة الفئات الأساسية أو فئة مستخدمة. أخفها بدلًا من حذفها.';
    }
    if (code.contains('invalid_gift_categories') ||
        code.contains('invalid_gift_category_')) {
      return 'راجع أسماء الفئات ورموزها وصورها ثم حاول الحفظ.';
    }
    if (code.contains('invalid_catalog_revision')) {
      return 'تعذر التحقق من نسخة الهدايا. أعد تحميل القائمة قبل الحفظ.';
    }
    if (code.contains('forbidden')) return 'لا توجد صلاحية لإدارة الهدايا.';
    return 'تعذر إتمام العملية. تحقق من البيانات والاتصال ثم حاول مجددًا.';
  }

  Future<void> refreshCatalog() async {
    if (saving || editing) return;
    if (hasUnsavedChanges || categoryUnsaved || pendingDraft != null) {
      final accept = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('إعادة تحميل الهدايا؟'),
          content: const Text('لديك تغييرات لم تحفظها. ستفقدها عند إعادة التحميل.'),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('إلغاء')),
            FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('إعادة التحميل')),
          ],
        ),
      );
      if (accept != true || !mounted) return;
    }
    await load();
  }

  Future<void> load() async {
    setState(() {
      loading = true;
      error = null;
      loadFailed = false;
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
      final rawDrafts = config is Map ? config['drafts'] : null;
      final loadedDrafts = rawDrafts is List
          ? rawDrafts.whereType<Map>().map((item) =>
              GiftCatalogItem.fromMap(Map<String, dynamic>.from(item))).toList()
          : <GiftCatalogItem>[];
      final rawCategories = config is Map ? config['categoryDefinitions'] : null;
      final loadedCategories = rawCategories is List
          ? rawCategories.whereType<Map>().map((item) =>
              Map<String, dynamic>.from(item)).toList()
          : <Map<String, dynamic>>[
              for (final id in GiftCatalogService.categories)
                {'id': id, 'nameAr': GiftCatalogService.categoryLabel(id),
                 'assetKey': '', 'enabled': true},
            ];
      final revision = config is Map && config['revision'] is num
          ? (config['revision'] as num).toInt() : 0;
      if (!mounted) return;
      setState(() {
        drafts = loadedDrafts;
        pendingDraft = null;
        gifts = loaded.isEmpty
            ? List<GiftCatalogItem>.from(GiftCatalogService.fallbackGifts)
            : loaded;
        loading = false;
        loadFailed = false;
        hasUnsavedChanges = false;
        categoryUnsaved = false;
        categoryDefinitions = loadedCategories;
        catalogRevision = revision;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        gifts = List<GiftCatalogItem>.from(GiftCatalogService.fallbackGifts);
        loading = false;
        error = friendlyError(e);
        loadFailed = true;
      });
    }
  }

  Future<void> save() async {
    if (saving || loading || categoryUnsaved) {
      if (categoryUnsaved) message('احفظ تغييرات الفئات أو ألغها أولًا.');
      return;
    }
    if (loadFailed) {
      message('تعذر تحميل الهدايا المحفوظة. أعد المحاولة قبل الحفظ لحماية بياناتك.');
      return;
    }
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
      await post({'action': 'save', 'gifts': payload, 'expectedRevision': catalogRevision});
      if (!mounted) return;
      setState(() => saving = false);
      message('تم حفظ كتالوج الهدايا بنجاح.');
      await load();
    } catch (e) {
      if (!mounted) return;
      setState(() => saving = false);
      message(friendlyError(e));
    }
  }

  bool get canManageDrafts =>
      !saving && !loading && !loadFailed && !editing &&
      !hasUnsavedChanges && !categoryUnsaved;

  Future<void> storeDraft(GiftCatalogItem gift) async {
    if (!canManageDrafts) {
      message('احفظ التغييرات الحالية قبل العمل على المسودات.');
      return;
    }
    setState(() => saving = true);
    try {
      await post({
        'action': 'saveDraft',
        'gift': gift.toMap(),
        'expectedRevision': catalogRevision,
      });
      if (!mounted) return;
      await load();
      message('تم حفظ الهدية كمسودة، ولن تظهر للمستخدمين حتى نشرها.');
    } catch (e) {
      if (mounted) {
        setState(() => pendingDraft = gift);
        message('${friendlyError(e)} — احتفظنا بالمسودة هنا لإعادة المحاولة.');
      }
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  Future<void> publishDraft(GiftCatalogItem gift) async {
    if (!canManageDrafts) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('نشر الهدية؟'),
        content: Text('سيتم نقل «${gift.nameAr}» من المسودات إلى الهدايا المنشورة. تحقق من سعرها وصورتها وشروطها قبل المتابعة.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('إلغاء')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('نشر الهدية')),
        ],
      ),
    );
    if (confirmed != true || !mounted || !canManageDrafts) return;
    setState(() => saving = true);
    try {
      await post({
        'action': 'publishDraft',
        'giftId': gift.id,
        'expectedRevision': catalogRevision,
      });
      if (!mounted) return;
      await load();
      message('تم نشر الهدية بنجاح.');
    } catch (e) {
      if (mounted) message(friendlyError(e));
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  Future<void> discardDraft(GiftCatalogItem gift) async {
    if (!canManageDrafts) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('حذف المسودة؟'),
        content: Text('سيتم حذف مسودة «${gift.nameAr}» فقط دون المساس بالهدايا المنشورة.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('إلغاء')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('حذف المسودة')),
        ],
      ),
    );
    if (confirmed != true || !mounted || !canManageDrafts) return;
    setState(() => saving = true);
    try {
      await post({
        'action': 'discardDraft',
        'giftId': gift.id,
        'expectedRevision': catalogRevision,
      });
      if (!mounted) return;
      await load();
      message('تم حذف المسودة.');
    } catch (e) {
      if (mounted) message(friendlyError(e));
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  String labelForCategory(String id) {
    for (final item in categoryDefinitions) {
      if (item['id'] == id) return (item['nameAr'] ?? id).toString();
    }
    return GiftCatalogService.categoryLabel(id);
  }

  Future<void> saveCategories() async {
    if (saving || loading || loadFailed || editing || !categoryUnsaved) return;
    if (hasUnsavedChanges) {
      message('احفظ تغييرات الهدايا أو ألغها قبل حفظ الفئات.');
      return;
    }
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('حفظ تغييرات الفئات؟'),
        content: const Text('إخفاء فئة سيوقف ظهور هداياها وإرسالها الجديد، دون تغيير العمليات السابقة.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('إلغاء')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('حفظ الفئات')),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => saving = true);
    try {
      await post({
        'action': 'saveCategories',
        'categories': categoryDefinitions,
        'expectedRevision': catalogRevision,
      });
      if (!mounted) return;
      message('تم حفظ الفئات بنجاح.');
      await load();
    } catch (e) {
      if (mounted) message(friendlyError(e));
    } finally {
      if (mounted) setState(() => saving = false);
    }
  }

  Future<void> editCategory([int? index]) async {
    if (categoryEditorOpen || saving || loading || loadFailed) return;
    categoryEditorOpen = true;
    final current = index == null ? null : categoryDefinitions[index];
    final id = TextEditingController(text: (current?['id'] ?? '').toString());
    final name = TextEditingController(text: (current?['nameAr'] ?? '').toString());
    final asset = TextEditingController(text: (current?['assetKey'] ?? '').toString());
    var enabled = current?['enabled'] != false;
    try {
      final result = await showDialog<Map<String, dynamic>>(
        context: context,
        barrierDismissible: false,
        builder: (context) => StatefulBuilder(
          builder: (context, refresh) => AlertDialog(
            title: Text(index == null ? 'إضافة فئة' : 'تعديل الفئة'),
            content: SizedBox(width: 420, child: SingleChildScrollView(
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                if (index == null) field(id, 'رمز الفئة (حروف إنجليزية صغيرة)', 'ramadan')
                else ListTile(title: Text(name.text), subtitle: const Text('رقم الفئة ثابت لحماية الهدايا')),
                const SizedBox(height: 10),
                field(name, 'اسم الفئة', 'هدايا رمضان'),
                const SizedBox(height: 10),
                OutlinedButton.icon(
                  onPressed: () {
                    final code = id.text.trim();
                    if (!RegExp(r'^[a-z][a-z0-9_]{1,31}$').hasMatch(code)) {
                      message('اكتب رمز الفئة الصحيح أولًا.');
                      return;
                    }
                    if (asset.text.trim().isEmpty) {
                      asset.text = 'gifts.categories.$code.icon';
                    }
                    Navigator.of(context).push(MaterialPageRoute<void>(
                      builder: (_) => ControlAssetManagerPage(
                        initialSearch: asset.text.trim(),
                        initialTemplateId: 'gift.icon.base.v1',
                        initialAssetKey: asset.text.trim(),
                        initialDirectory: 'assets/images/gifts',
                        initialFileName: '${code}_category.webp',
                      ),
                    ));
                  },
                  icon: const Icon(Icons.image_outlined),
                  label: const Text('إضافة/تغيير صورة الفئة'),
                ),
                const SizedBox(height: 10),
                SwitchListTile(
                  title: const Text('الفئة ظاهرة'),
                  value: enabled,
                  onChanged: (value) => refresh(() => enabled = value),
                ),
              ]),
            )),
            actions: [
              TextButton(onPressed: () => Navigator.pop(context), child: const Text('إلغاء')),
              FilledButton(
                onPressed: () {
                  final code = id.text.trim();
                  final label = name.text.trim();
                  final image = asset.text.trim();
                  if (!RegExp(r'^[a-z][a-z0-9_]{1,31}$').hasMatch(code) ||
                      label.isEmpty || label.length > 64 ||
                      (image.isNotEmpty && !RegExp(r'^[a-z0-9][a-z0-9._-]{2,119}$').hasMatch(image))) {
                    message('راجع رمز الفئة واسمها والصورة.');
                    return;
                  }
                  if (index == null && categoryDefinitions.any((e) => e['id'] == code)) {
                    message('رمز الفئة مستخدم. اختر رمزًا مختلفًا.');
                    return;
                  }
                  Navigator.pop(context, {
                    'id': code,
                    'nameAr': label,
                    'assetKey': image,
                    'enabled': enabled,
                  });
                },
                child: const Text('اعتماد التعديل'),
              ),
            ],
          ),
        ),
      );
      if (result == null || !mounted) return;
      setState(() {
        categoryUnsaved = true;
        if (index == null) { categoryDefinitions.add(result); }
        else { categoryDefinitions[index] = result; }
      });
    } finally {
      id.dispose(); name.dispose(); asset.dispose();
      categoryEditorOpen = false;
    }
  }

  void moveCategory(int index, int offset) {
    final target = index + offset;
    if (saving || target < 0 || target >= categoryDefinitions.length) return;
    setState(() {
      categoryUnsaved = true;
      final category = categoryDefinitions.removeAt(index);
      categoryDefinitions.insert(target, category);
    });
  }

  void message(String value) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(value)));
  }

  Future<void> grantBagGift() async {
    if (grantDialogOpen || saving || loading || loadFailed) return;
    grantDialogOpen = true;
    try {
    final enabledGifts = gifts.where((item) =>
      item.enabled && categoryDefinitions.any((category) =>
        category['id'] == item.category && category['enabled'] != false,
      )).toList(growable: false);
    if (enabledGifts.isEmpty) {
      message('لا توجد هدايا مفعلة متاحة للمنح.');
      return;
    }

    final userId = TextEditingController();
    final quantity = TextEditingController(text: '1');
    var giftId = enabledGifts.first.id;
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
                    items: enabledGifts
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
        'targetUid': targetUserId,
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
      message(friendlyError(e));
    }
    } finally {
      grantDialogOpen = false;
    }
  }

  String giftMomentLabel(DateTime? moment) {
    if (moment == null) return 'بدون تحديد';
    String two(int number) => number.toString().padLeft(2, '0');
    return '${moment.year}-${two(moment.month)}-${two(moment.day)}  ${two(moment.hour)}:${two(moment.minute)}';
  }

  Future<DateTime?> chooseGiftMoment(BuildContext context, DateTime? current) async {
    final today = DateTime.now();
    final initial = current ?? today;
    final date = await showDatePicker(
      context: context,
      initialDate: initial.isAfter(DateTime(2100)) ? DateTime(2100) :
          initial.isBefore(DateTime(2020)) ? DateTime(2020) : initial,
      firstDate: DateTime(2020),
      lastDate: DateTime(2100),
      helpText: 'اختر اليوم',
      cancelText: 'إلغاء',
      confirmText: 'التالي',
    );
    if (date == null || !context.mounted) return null;
    final time = await showTimePicker(
      context: context,
      initialTime: current == null ? TimeOfDay.now() : TimeOfDay.fromDateTime(current),
      helpText: 'اختر الساعة',
      cancelText: 'إلغاء',
      confirmText: 'اعتماد',
    );
    if (time == null) return null;
    // Store an absolute instant. The user selects local date/time; the server
    // checks the instant regardless of client device time zone.
    return DateTime(date.year, date.month, date.day, time.hour, time.minute);
  }

  Future<void> editGift([int? index, GiftCatalogItem? template, bool editSavedDraft = false]) async {
    if (editing || saving || loading || loadFailed) return;
    if (editSavedDraft && (hasUnsavedChanges || categoryUnsaved)) {
      message('احفظ التغييرات الحالية قبل تعديل المسودة.');
      return;
    }
    editing = true;
    final current = index == null ? template : gifts[index];
    final id = TextEditingController(
      text: template == null || editSavedDraft ? (current?.id ?? '') : '',
    );
    final nameAr = TextEditingController(
      text: template == null || editSavedDraft ? (current?.nameAr ?? '') : 'نسخة من ${template.nameAr}',
    );
    final price = TextEditingController(
      text: current?.priceCoins.toString() ?? '',
    );
    final assetKey = TextEditingController(
      text: template == null || editSavedDraft ? (current?.assetKey ?? 'gifts.placeholder.default') : 'gifts.placeholder.default',
    );
    final placeholder = TextEditingController(
      text: current?.localPlaceholder ??
          'assets/images/gifts/gift_placeholder.webp',
    );
    var enabled = template == null || editSavedDraft ? (current?.enabled ?? true) : false;
    var featured = current?.featured ?? false;
    final allowedContexts = (current?.allowedContexts ?? const ['room', 'chat', 'diary']).toSet();
    DateTime? visibleFrom = (current?.visibleFromMs ?? 0) > 0
        ? DateTime.fromMillisecondsSinceEpoch(current!.visibleFromMs) : null;
    DateTime? visibleUntil = (current?.visibleUntilMs ?? 0) > 0
        ? DateTime.fromMillisecondsSinceEpoch(current!.visibleUntilMs) : null;
    var category = current?.category ?? 'general';
    var minVipLevel = current?.effectiveMinVipLevel ?? 0;
    var isAnimated = template == null || editSavedDraft ? (current?.isAnimated ?? false) : false;
    var effectMode = template == null || editSavedDraft ? (current?.effectMode ?? 'none') : 'none';
    final effectAssetKey = TextEditingController(
      text: template == null || editSavedDraft ? (current?.effectiveEffectAssetKey ?? current?.assetKey ?? 'gifts.placeholder.default') : 'gifts.placeholder.default',
    );
    final effectSoundAssetKey = TextEditingController(
      text: template == null || editSavedDraft ? (current?.effectSoundAssetKey ?? '') : '',
    );
    final effectMinQuantity = TextEditingController(
      text: (template == null || editSavedDraft ? (current?.effectMinQuantity ?? 0) : 0).toString(),
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

    bool previewOpen = false;
    var saveAsDraft = editSavedDraft;
    final result = await showDialog<GiftCatalogItem>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, setLocal) => AlertDialog(
          title: Text(editSavedDraft ? 'تعديل المسودة' : index == null ? (template == null ? 'إضافة هدية' : 'نسخ هدية جديدة') : 'تعديل الهدية'),
          content: SizedBox(
            width: 540,
            child: SingleChildScrollView(
              child: Column(
                children: [
                  if (index != null || editSavedDraft)
                    TextFormField(
                      initialValue: current!.id,
                      readOnly: true,
                      decoration: const InputDecoration(
                        labelText: 'رقم الهدية (ثابت للحفاظ على السجلات)',
                        border: OutlineInputBorder(),
                      ),
                    )
                  else field(id, 'رقم الهدية الجديدة', 'rose'),
                  const SizedBox(height: 10),
                  field(nameAr, 'اسم الهدية بالعربي', 'وردة'),
                  const SizedBox(height: 10),
                  field(price, 'السعر بالكوينز', '100', numeric: true),
                  const SizedBox(height: 10),
                  DropdownButtonFormField<String>(
                    value: category,
                    decoration: const InputDecoration(
                      labelText: 'الفئة',
                      border: OutlineInputBorder(),
                    ),
                    items: categoryDefinitions
                        .map(
                          (item) => DropdownMenuItem<String>(
                            value: item['id'] as String,
                            child: Text((item['nameAr'] ?? item['id']).toString()),
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
                    'مفتاح صورة الهدية الثابتة (Asset Key)',
                    'gifts.rose.icon',
                  ),
                  const SizedBox(height: 6),
                  Align(
                    alignment: Alignment.centerRight,
                    child: OutlinedButton.icon(
                      onPressed: () {
                        final giftId = id.text.trim();
                        if (!RegExp(r'^[a-z0-9_]{2,64}$').hasMatch(giftId)) {
                          message('اكتب معرّف الهدية الصحيح أولًا.');
                          return;
                        }
                        if (assetKey.text.trim() == 'gifts.placeholder.default') {
                          assetKey.text = 'gifts.$giftId.icon';
                        }
                        Navigator.of(dialogContext).push(
                          MaterialPageRoute<void>(
                            builder: (_) => ControlAssetManagerPage(
                              initialSearch: assetKey.text.trim(),
                              initialTemplateId: 'gift.icon.base.v1',
                              initialAssetKey: assetKey.text.trim(),
                              initialDirectory: 'assets/images/gifts',
                              initialFileName: '${giftId}_icon.webp',
                            ),
                          ),
                        );
                      },
                      icon: const Icon(Icons.image_outlined, size: 18),
                      label: const Text('إضافة/تغيير صورة الهدية'),
                    ),
                  ),
                  const Text(
                    'من استديو الأصول اختر «هدية — صورة ثابتة في قائمة الإرسال» '
                    'وارفع WebP أو PNG بخلفية شفافة؛ حافظ على نفس المفتاح '
                    'عند الاستبدال. لا نعرض الفيديو داخل شبكة الهدايا.',
                    style: TextStyle(fontSize: 11, color: Colors.white60),
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
                    title: const Text('علامة الحركة القديمة في الكتالوج'),
                    subtitle: const Text(
                      'الصور الجديدة لقائمة الهدايا ثابتة؛ ملف الحركة مستقل '
                      'في الحقل التالي.',
                      style: TextStyle(fontSize: 10),
                    ),
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
                        setLocal(() {
                          effectMode = value;
                          if (value == 'none') {
                            effectMinQuantity.text = '0';
                          } else if ((int.tryParse(effectMinQuantity.text) ?? 0) < 1) {
                            effectMinQuantity.text = '1';
                          }
                        });
                      }
                    },
                  ),
                  const SizedBox(height: 10),
                  field(
                    effectAssetKey,
                    'مفتاح مؤثر الهدية المتحرك (مستقل عن الصورة)',
                    'gifts.rose.effect',
                  ),
                  const SizedBox(height: 6),
                  Align(
                    alignment: Alignment.centerRight,
                    child: OutlinedButton.icon(
                      onPressed: () {
                        final giftId = id.text.trim();
                        if (!RegExp(r'^[a-z0-9_]{2,64}$').hasMatch(giftId)) {
                          message('اكتب معرّف الهدية الصحيح أولًا.');
                          return;
                        }
                        if (effectAssetKey.text.trim() == 'gifts.placeholder.default' || effectAssetKey.text.trim() == assetKey.text.trim()) {
                          effectAssetKey.text = 'gifts.$giftId.effect';
                        }
                        Navigator.of(dialogContext).push(
                          MaterialPageRoute<void>(
                            builder: (_) => ControlAssetManagerPage(
                              initialSearch: effectAssetKey.text.trim(),
                              initialTemplateId: 'gift.effect.base.v1',
                              initialAssetKey: effectAssetKey.text.trim(),
                              initialDirectory: 'assets/images/gifts',
                              initialFileName: '${giftId}_effect.webp',
                            ),
                          ),
                        );
                      },
                      icon: const Icon(Icons.animation_outlined, size: 18),
                      label: const Text('إضافة/تغيير مؤثر الهدية'),
                    ),
                  ),
                  const Text(
                    'اختر «هدية — مؤثر متحرك عند الإرسال» وارفع Animated WebP '
                    'أو GIF شفاف. المؤثر يبقى منفصلًا عن صورة الكتالوج؛ '
                    'التحكم بالحجم والمدة والحد الأدنى للكمية من هنا.',
                    style: TextStyle(fontSize: 11, color: Colors.white60),
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
                  if (index == null)
                    SwitchListTile(
                      value: saveAsDraft,
                      onChanged: editSavedDraft || hasUnsavedChanges || categoryUnsaved
                          ? null
                          : (value) => setLocal(() => saveAsDraft = value),
                      title: const Text('حفظ الهدية كمسودة'),
                      subtitle: const Text('لا تظهر الهدية للمستخدمين إلا بعد نشرها من قسم المسودات.'),
                      contentPadding: EdgeInsets.zero,
                    ),
                  const SizedBox(height: 12),
                  const ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text('أماكن ظهور الهدية'),
                    subtitle: Text('حدد أين يمكن للمستخدم إرسال هذه الهدية.'),
                  ),
                  for (final place in const [
                    ('room', 'الغرف الصوتية'),
                    ('chat', 'الرسائل والملف الشخصي'),
                    ('diary', 'اليوميات'),
                  ])
                    CheckboxListTile(
                      contentPadding: EdgeInsets.zero,
                      title: Text(place.$2),
                      value: allowedContexts.contains(place.$1),
                      onChanged: (selected) => setLocal(() {
                        if (selected == true) {
                          allowedContexts.add(place.$1);
                        } else {
                          allowedContexts.remove(place.$1);
                        }
                      }),
                    ),
                  const SizedBox(height: 10),
                  const ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text('موعد إظهار الهدية'),
                    subtitle: Text('اترك الموعدين بدون تحديد لتكون الهدية متاحة دائمًا. المواعيد حسب توقيت جهازك.'),
                  ),
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('بداية الظهور'),
                    subtitle: Text(giftMomentLabel(visibleFrom)),
                    trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                      if (visibleFrom != null)
                        IconButton(
                          tooltip: 'إلغاء موعد البداية',
                          onPressed: () => setLocal(() => visibleFrom = null),
                          icon: const Icon(Icons.close_rounded),
                        ),
                      IconButton(
                        tooltip: 'تحديد بداية الظهور',
                        onPressed: () async {
                          final selected = await chooseGiftMoment(dialogContext, visibleFrom);
                          if (selected != null && dialogContext.mounted) {
                            setLocal(() => visibleFrom = selected);
                          }
                        },
                        icon: const Icon(Icons.calendar_month_outlined),
                      ),
                    ]),
                  ),
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('نهاية الظهور'),
                    subtitle: Text(giftMomentLabel(visibleUntil)),
                    trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                      if (visibleUntil != null)
                        IconButton(
                          tooltip: 'إلغاء موعد النهاية',
                          onPressed: () => setLocal(() => visibleUntil = null),
                          icon: const Icon(Icons.close_rounded),
                        ),
                      IconButton(
                        tooltip: 'تحديد نهاية الظهور',
                        onPressed: () async {
                          final selected = await chooseGiftMoment(dialogContext, visibleUntil);
                          if (selected != null && dialogContext.mounted) {
                            setLocal(() => visibleUntil = selected);
                          }
                        },
                        icon: const Icon(Icons.calendar_month_outlined),
                      ),
                    ]),
                  ),
                  const SizedBox(height: 8),
                  SwitchListTile(
                    value: enabled,
                    onChanged: (value) => setLocal(() => enabled = value),
                    title: const Text('الهدية مفعلة'),
                    contentPadding: EdgeInsets.zero,
                  ),
                  SwitchListTile(
                    value: featured,
                    onChanged: (value) => setLocal(() => featured = value),
                    title: const Text('هدية مميزة في الكتالوج'),
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
            OutlinedButton.icon(
              onPressed: () async {
                if (previewOpen) return;
                previewOpen = true;
                final previewName = nameAr.text.trim();
                final previewPrice = price.text.trim();
                final previewAsset = assetKey.text.trim();
                final previewMode = effectMode;
                try {
                  await showDialog<void>(
                    context: dialogContext,
                    builder: (previewContext) => AlertDialog(
                      title: const Text('معاينة الهدية'),
                      content: SizedBox(
                        width: 320,
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            SizedBox(
                              width: 110,
                              height: 110,
                              child: FutureBuilder<Uri?>(
                                future: ShadowAssetRegistry.remoteUrl(previewAsset),
                                builder: (_, snapshot) {
                                  final url = snapshot.data;
                                  if (url == null) {
                                    return const Icon(Icons.card_giftcard_rounded, size: 70);
                                  }
                                  return Image.network(
                                    url.toString(),
                                    fit: BoxFit.contain,
                                    errorBuilder: (_, __, ___) =>
                                        const Icon(Icons.card_giftcard_rounded, size: 70),
                                  );
                                },
                              ),
                            ),
                            const SizedBox(height: 12),
                            Text(previewName.isEmpty ? 'اسم الهدية' : previewName,
                                style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                            Text('${previewPrice.isEmpty ? '—' : previewPrice} كوينز'),
                            const SizedBox(height: 8),
                            Text(previewMode == 'none'
                              ? 'بدون مؤثر'
                              : previewMode == 'seat' ? 'مؤثر خفيف على المايك'
                              : 'مؤثر سينمائي داخل الغرفة'),
                            const SizedBox(height: 8),
                            const Text('هذه معاينة للصورة المنشورة والإعدادات، وليست اختبارًا لتشغيل المؤثر.',
                              textAlign: TextAlign.center,
                              style: TextStyle(fontSize: 11)),
                          ],
                        ),
                      ),
                      actions: [
                        FilledButton(
                          onPressed: () => Navigator.pop(previewContext),
                          child: const Text('إغلاق'),
                        ),
                      ],
                    ),
                  );
                } finally {
                  previewOpen = false;
                }
              },
              icon: const Icon(Icons.visibility_outlined, size: 18),
              label: const Text('معاينة'),
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
                    (!relationshipGift && parsedAffinity != 0) ||
                    allowedContexts.isEmpty ||
                    (visibleFrom != null && visibleUntil != null &&
                        !visibleUntil!.isAfter(visibleFrom!))) {
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
                    allowedContexts: [
                      for (final value in const ['room', 'chat', 'diary'])
                        if (allowedContexts.contains(value)) value,
                    ],
                    visibleFromMs: visibleFrom?.millisecondsSinceEpoch ?? 0,
                    visibleUntilMs: visibleUntil?.millisecondsSinceEpoch ?? 0,
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

    editing = false;
    if (result == null || !mounted) return;
    if (saveAsDraft) {
      await storeDraft(result);
      return;
    }
    setState(() {
      hasUnsavedChanges = true;
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
      hasUnsavedChanges = true;
      final item = gifts.removeAt(index);
      gifts.insert(next, item);
    });
  }

  List<int> get visibleIndices {
    final term = query.trim().toLowerCase();
    final indexes = <int>[];
    for (var i = 0; i < gifts.length; i++) {
      final item = gifts[i];
      if (term.isNotEmpty &&
          !item.nameAr.toLowerCase().contains(term) &&
          !item.id.toLowerCase().contains(term)) continue;
      if (categoryFilter != 'all' && item.category != categoryFilter) continue;
      if (visibilityFilter == 'shown' && !item.enabled) continue;
      if (visibilityFilter == 'hidden' && item.enabled) continue;
      indexes.add(i);
    }
    if (orderFilter == 'priceAsc') {
      indexes.sort((a, b) => gifts[a].priceCoins.compareTo(gifts[b].priceCoins));
    } else if (orderFilter == 'priceDesc') {
      indexes.sort((a, b) => gifts[b].priceCoins.compareTo(gifts[a].priceCoins));
    } else if (orderFilter == 'name') {
      indexes.sort((a, b) => gifts[a].nameAr.compareTo(gifts[b].nameAr));
    }
    return indexes;
  }

  Widget giftThumbnail(GiftCatalogItem gift) {
    final fallback = Container(
      width: 44,
      height: 44,
      decoration: BoxDecoration(
        color: const Color(0xFF261A45),
        borderRadius: BorderRadius.circular(9),
      ),
      child: const Icon(Icons.card_giftcard_rounded, color: Color(0xFFFFD54A)),
    );
    return SizedBox(
      width: 44,
      height: 44,
      child: FutureBuilder<Uri?>(
        future: ShadowAssetRegistry.remoteUrl(gift.assetKey),
        builder: (_, snapshot) {
          final url = snapshot.data;
          if (url == null) return fallback;
          return Image.network(
            url.toString(),
            fit: BoxFit.contain,
            errorBuilder: (_, __, ___) => fallback,
          );
        },
      ),
    );
  }

  Widget sectionSelector() {
    const labels = ['كل الهدايا', 'الفئات', 'المؤثرات', 'الإحصاءات'];
    const icons = [Icons.card_giftcard_outlined, Icons.category_outlined, Icons.auto_awesome_outlined, Icons.bar_chart_outlined];
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Wrap(
        spacing: 8,
        runSpacing: 8,
        children: List.generate(labels.length, (i) => ChoiceChip(
          avatar: Icon(icons[i], size: 18),
          label: Text(labels[i]),
          selected: selectedSection == i,
          onSelected: (_) => setState(() => selectedSection = i),
        )),
      ),
    );
  }

  Widget categoryThumbnail(String assetKey) {
    if (assetKey.isEmpty) return const Icon(Icons.category_outlined);
    return SizedBox(
      width: 44,
      height: 44,
      child: FutureBuilder<Uri?>(
        future: ShadowAssetRegistry.remoteUrl(assetKey),
        builder: (_, snapshot) {
          final url = snapshot.data;
          if (url == null) return const Icon(Icons.category_outlined);
          return Image.network(url.toString(),
            fit: BoxFit.contain,
            errorBuilder: (_, __, ___) => const Icon(Icons.category_outlined),
          );
        },
      ),
    );
  }

  Widget categoryOverview() {
    final counts = <String, int>{};
    for (final gift in gifts) {
      counts[gift.category] = (counts[gift.category] ?? 0) + 1;
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        ListTile(
          title: const Text('إدارة فئات الهدايا'),
          subtitle: const Text('يمكن إضافة الفئات وتغيير ترتيبها وصورها وظهورها دون حذف الهدايا السابقة.'),
          trailing: FilledButton.icon(
            onPressed: saving || categoryDefinitions.length >= 30 ? null : () => editCategory(),
            icon: const Icon(Icons.add_rounded),
            label: const Text('إضافة فئة'),
          ),
        ),
        for (var i = 0; i < categoryDefinitions.length; i++)
          Card(child: ListTile(
            leading: categoryThumbnail((categoryDefinitions[i]['assetKey'] ?? '').toString()),
            title: Text(labelForCategory(categoryDefinitions[i]['id'].toString())),
            subtitle: Text('${counts[categoryDefinitions[i]['id']] ?? 0} هدية • ${categoryDefinitions[i]['enabled'] == false ? 'مخفية' : 'ظاهرة'}'),
            trailing: PopupMenuButton<String>(
              tooltip: 'خيارات الفئة',
              enabled: !saving,
              onSelected: (value) {
                if (value == 'edit') editCategory(i);
                if (value == 'up') moveCategory(i, -1);
                if (value == 'down') moveCategory(i, 1);
              },
              itemBuilder: (_) => [
                const PopupMenuItem(value: 'edit', child: Text('تعديل الفئة')),
                if (i > 0)
                  const PopupMenuItem(value: 'up', child: Text('رفع الفئة')),
                if (i < categoryDefinitions.length - 1)
                  const PopupMenuItem(value: 'down', child: Text('خفض الفئة')),
              ],
            ),
            onTap: () => setState(() {
              categoryFilter = categoryDefinitions[i]['id'].toString();
              selectedSection = 0;
            }),
          )),
        if (categoryUnsaved)
          FilledButton.icon(
            onPressed: saving || hasUnsavedChanges ? null : saveCategories,
            icon: const Icon(Icons.save_outlined),
            label: const Text('حفظ تغييرات الفئات'),
          ),
      ],
    );
  }

  Widget effectsOverview() {
    final indices = <int>[
      for (var i = 0; i < gifts.length; i++)
        if (gifts[i].effectMode != 'none') i,
    ];
    return Column(
      children: [
        const ListTile(
          title: Text('مؤثرات الهدايا'),
          subtitle: Text('تعديل المؤثر الحالي والمدة والحجم والكمية من إعدادات كل هدية.'),
        ),
        if (indices.isEmpty) const ListTile(title: Text('لا توجد مؤثرات مفعّلة حالياً')),
        ...indices.map((i) => Card(child: ListTile(
          leading: const Icon(Icons.auto_awesome_outlined),
          title: Text(gifts[i].nameAr),
          subtitle: Text(gifts[i].effectMode == 'seat' ? 'خفيف على المايك' : 'سينمائي داخل الغرفة'),
          trailing: const Icon(Icons.edit_outlined),
          onTap: saving ? null : () => editGift(i),
        ))),
      ],
    );
  }

  Widget statisticsOverview() => const Card(
    child: Padding(
      padding: EdgeInsets.all(20),
      child: Column(
        children: [
          Icon(Icons.bar_chart_outlined, size: 42),
          SizedBox(height: 12),
          Text('إحصاءات الهدايا'),
          SizedBox(height: 8),
          Text('لا تتوفر بيانات إحصائية موثوقة في هذا القسم بعد. سيتم عرض العمليات الفعلية بعد ربط التقارير بالسجلات المعتمدة، دون أرقام تقديرية.', textAlign: TextAlign.center),
        ],
      ),
    ),
  );

  Widget draftsOverview() {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            ListTile(
              leading: const Icon(Icons.edit_note_outlined),
              title: const Text('مسودات الهدايا'),
              subtitle: Text(drafts.isEmpty
                  ? 'لا توجد مسودات محفوظة.'
                  : '${drafts.length} مسودة محفوظة — غير ظاهرة للمستخدمين'),
            ),
            if (pendingDraft != null)
              ListTile(
                leading: const Icon(Icons.warning_amber_rounded, color: Colors.orangeAccent),
                title: Text('مسودة لم يُؤكَّد حفظها: ${pendingDraft!.nameAr}'),
                subtitle: const Text('يمكن إعادة المحاولة دون إعادة إدخال البيانات.'),
                trailing: TextButton(
                  onPressed: canManageDrafts ? () => storeDraft(pendingDraft!) : null,
                  child: const Text('إعادة الحفظ'),
                ),
                onTap: canManageDrafts ? () => editGift(null, pendingDraft, true) : null,
              ),
            for (final draft in drafts)
              ListTile(
                leading: giftThumbnail(draft),
                title: Text(draft.nameAr),
                subtitle: Text('${draft.priceCoins} كوينز • ${labelForCategory(draft.category)}'),
                trailing: PopupMenuButton<String>(
                  tooltip: 'خيارات المسودة',
                  enabled: canManageDrafts,
                  onSelected: (choice) {
                    if (choice == 'edit') editGift(null, draft, true);
                    if (choice == 'publish') publishDraft(draft);
                    if (choice == 'discard') discardDraft(draft);
                  },
                  itemBuilder: (_) => const [
                    PopupMenuItem(value: 'edit', child: Text('تعديل المسودة')),
                    PopupMenuItem(value: 'publish', child: Text('نشر الهدية')),
                    PopupMenuItem(value: 'discard', child: Text('حذف المسودة')),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget catalogFilters() {
    final categories = <String>{'all', ...categoryDefinitions.map((item) => item['id'].toString()), ...gifts.map((gift) => gift.category)};
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            TextField(
              onChanged: (value) => setState(() => query = value),
              decoration: const InputDecoration(
                labelText: 'البحث عن هدية',
                hintText: 'اسم الهدية أو رقمها',
                prefixIcon: Icon(Icons.search_rounded),
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 10,
              runSpacing: 8,
              children: [
                DropdownButton<String>(
                  value: categoryFilter,
                  items: categories.map((category) => DropdownMenuItem(
                    value: category,
                    child: Text(category == 'all' ? 'كل الفئات' : labelForCategory(category)),
                  )).toList(),
                  onChanged: (value) => setState(() => categoryFilter = value ?? 'all'),
                ),
                DropdownButton<String>(
                  value: visibilityFilter,
                  items: const [
                    DropdownMenuItem(value: 'all', child: Text('كل الحالات')),
                    DropdownMenuItem(value: 'shown', child: Text('الظاهرة')),
                    DropdownMenuItem(value: 'hidden', child: Text('المخفية')),
                  ],
                  onChanged: (value) => setState(() => visibilityFilter = value ?? 'all'),
                ),
                DropdownButton<String>(
                  value: orderFilter,
                  items: const [
                    DropdownMenuItem(value: 'catalog', child: Text('ترتيب العرض')),
                    DropdownMenuItem(value: 'name', child: Text('الاسم')),
                    DropdownMenuItem(value: 'priceAsc', child: Text('السعر: الأقل أولاً')),
                    DropdownMenuItem(value: 'priceDesc', child: Text('السعر: الأعلى أولاً')),
                  ],
                  onChanged: (value) => setState(() => orderFilter = value ?? 'catalog'),
                ),
              ],
            ),
            Text('النتائج: ${visibleIndices.length} من ${gifts.length}'),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('الهدايا'),
        actions: [
          IconButton(
            onPressed: loading || saving || editing ? null : refreshCatalog,
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: loading || saving || loadFailed || selectedSection != 0 ? null : () => editGift(),
        icon: const Icon(Icons.add),
        label: const Text('إضافة هدية'),
      ),
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : Directionality(
              textDirection: TextDirection.rtl,
              child: ListView(
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
                      onPressed: saving || loadFailed ? null : grantBagGift,
                      child: const Text('منح'),
                    ),
                    onTap: saving || loadFailed ? null : grantBagGift,
                  ),
                ),
                if (error != null)
                  Card(
                    child: ListTile(
                      leading: const Icon(
                        Icons.info_outline,
                        color: Colors.orangeAccent,
                      ),
                      title: const Text('تعذر تحميل الهدايا المحفوظة'),
                      subtitle: Text(error!),
                    ),
                  ),
                if (hasUnsavedChanges || categoryUnsaved)
                  const Card(child: ListTile(
                    leading: Icon(Icons.edit_note_rounded, color: Colors.amberAccent),
                    title: Text('هناك تغييرات لم تُحفظ بعد'),
                    subtitle: Text('اضغط «حفظ كتالوج الهدايا» لتطبيقها.'),
                  )),
                sectionSelector(),
                if (selectedSection == 1) categoryOverview(),
                if (selectedSection == 2) effectsOverview(),
                if (selectedSection == 3) statisticsOverview(),
                if (selectedSection == 0) ...[
                draftsOverview(),
                const SizedBox(height: 10),
                catalogFilters(),
                ...visibleIndices.take(visibleLimit).map((index) {
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
                                    hasUnsavedChanges = true;
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
                              giftThumbnail(item),
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
                                labelForCategory(item.category) +
                                (item.effectiveMinVipLevel > 0
                                    ? ' • VIP' +
                                        item.effectiveMinVipLevel.toString() +
                                        '+'
                                    : ''),
                          ),

                          const SizedBox(height: 6),
                          Wrap(
                            spacing: 2,
                            runSpacing: 2,
                            children: [
                              IconButton(
                                onPressed: orderFilter == 'catalog' && query.isEmpty && categoryFilter == 'all' && visibilityFilter == 'all' && index > 0 ? () => move(index, -1) : null,
                                icon: const Icon(Icons.arrow_upward_rounded),
                              ),
                              IconButton(
                                onPressed: orderFilter == 'catalog' && query.isEmpty && categoryFilter == 'all' && visibilityFilter == 'all' && index < gifts.length - 1
                                    ? () => move(index, 1)
                                    : null,
                                icon: const Icon(Icons.arrow_downward_rounded),
                              ),
                              IconButton(
                                tooltip: 'نسخ الهدية',
                                onPressed: saving ? null : () => editGift(null, item),
                                icon: const Icon(Icons.copy_outlined),
                              ),
                              IconButton(
                                tooltip: 'تعديل الهدية',
                                onPressed: saving ? null : () => editGift(index),
                                icon: const Icon(Icons.edit_outlined),
                              ),
                              IconButton(
                                tooltip: 'إخفاء الهدية دون حذف سجلها',
                                onPressed: saving || !item.enabled
                                    ? null
                                    : () => setState(() {
                                          hasUnsavedChanges = true;
                                          gifts[index] = GiftCatalogItem.fromMap({
                                            ...item.toMap(),
                                            'enabled': false,
                                          });
                                        }),
                                icon: const Icon(Icons.visibility_off_outlined),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  );
                }),
                if (visibleIndices.length > visibleLimit)
                  OutlinedButton.icon(
                    onPressed: () => setState(() => visibleLimit += 20),
                    icon: const Icon(Icons.expand_more_rounded),
                    label: Text('عرض المزيد (${visibleIndices.length - visibleLimit} متبقية)'),
                  ),
                ],
                if (selectedSection == 0) const SizedBox(height: 14),
                if (selectedSection == 0) FilledButton.icon(
                  onPressed: saving || loadFailed ? null : save,
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
            ),
    );
  }
}
