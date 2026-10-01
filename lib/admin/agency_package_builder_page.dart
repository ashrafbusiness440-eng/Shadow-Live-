import 'package:flutter/material.dart';

import '../features/agency/services/agency_package_service.dart';
import 'control_firebase.dart';

class AgencyPackageBuilderPage extends StatefulWidget {
  const AgencyPackageBuilderPage({super.key});

  @override
  State<AgencyPackageBuilderPage> createState() =>
      _AgencyPackageBuilderPageState();
}

class _AgencyPackageBuilderPageState extends State<AgencyPackageBuilderPage> {
  late final AgencyPackageService _service;
  List<AgencyPackageTemplate> _templates = const [];
  List<AgencyPackageAsset> _assets = const [];
  bool _loading = true;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _service = AgencyPackageService(auth: controlAuth);
    _load();
  }

  @override
  void dispose() {
    _service.close();
    super.dispose();
  }

  String _key(String prefix) =>
      prefix + '_' + DateTime.now().microsecondsSinceEpoch.toString();

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final templates = await _service.loadTemplates();
      final assets = await _service.loadAssets();
      if (!mounted) return;
      setState(() {
        _templates = templates;
        _assets = assets;
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

  Future<void> _edit([AgencyPackageTemplate? template]) async {
    if (_busy) return;
    final name = TextEditingController(text: template?.name ?? '');
    final packageHours = TextEditingController(
      text: (template?.packageDurationHours ?? 720).toString(),
    );
    final draft = (template?.lineItems ?? const <AgencyPackageLine>[])
        .map<Map<String, dynamic>>(
          (item) => {
            'lineId': item.lineId,
            'type': item.type,
            'assetKey': item.assetKey,
            'nameAr': item.nameAr,
            'hours': item.entitlementDurationHours,
            'quantity': item.quantity,
          },
        )
        .toList();

    if (draft.isEmpty && _assets.isNotEmpty) {
      draft.add({
        'lineId': 'line_1',
        'type': 'frame',
        'assetKey': _assets.first.assetKey,
        'nameAr': '',
        'hours': 24,
        'quantity': 1,
      });
    }

    final save = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF0D1220),
      builder: (sheetContext) => StatefulBuilder(
        builder: (context, setSheetState) => Directionality(
          textDirection: TextDirection.rtl,
          child: SafeArea(
            child: FractionallySizedBox(
              heightFactor: .92,
              child: ListView(
                padding: EdgeInsets.fromLTRB(
                  16,
                  12,
                  16,
                  20 + MediaQuery.viewInsetsOf(context).bottom,
                ),
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          template == null
                              ? 'إنشاء باكيج وكالة'
                              : 'تعديل ' + template.name,
                          style: const TextStyle(
                            fontSize: 20,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ),
                      IconButton(
                        onPressed: () => Navigator.pop(sheetContext, false),
                        icon: const Icon(Icons.close),
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: name,
                    maxLength: 80,
                    decoration: const InputDecoration(
                      labelText: 'اسم الباكيج',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: packageHours,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(
                      labelText: 'مدة مخزون الباكيج — بالساعات',
                      helperText: 'تبدأ من لحظة منح الباكيج للوكالة.',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 14),
                  Row(
                    children: [
                      const Expanded(
                        child: Text(
                          'محتويات الباكيج',
                          style: TextStyle(
                            fontSize: 17,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ),
                      OutlinedButton.icon(
                        onPressed: _assets.isEmpty || draft.length >= 40
                            ? null
                            : () {
                                setSheetState(() {
                                  draft.add({
                                    'lineId': 'line_' +
                                        DateTime.now()
                                            .microsecondsSinceEpoch
                                            .toString(),
                                    'type': 'frame',
                                    'assetKey': _assets.first.assetKey,
                                    'nameAr': '',
                                    'hours': 24,
                                    'quantity': 1,
                                  });
                                });
                              },
                        icon: const Icon(Icons.add),
                        label: const Text('إضافة أصل'),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  if (_assets.isEmpty)
                    const Card(
                      child: ListTile(
                        leading: Icon(Icons.warning_amber_rounded),
                        title: Text('لا توجد أصول منشورة متاحة'),
                      ),
                    ),
                  for (var index = 0; index < draft.length; index += 1)
                    Card(
                      margin: const EdgeInsets.only(bottom: 10),
                      child: Padding(
                        padding: const EdgeInsets.all(12),
                        child: Column(
                          children: [
                            Row(
                              children: [
                                Expanded(
                                  child: Text(
                                    'عنصر ' + (index + 1).toString(),
                                    style: const TextStyle(
                                      fontWeight: FontWeight.w800,
                                    ),
                                  ),
                                ),
                                IconButton(
                                  onPressed: () => setSheetState(
                                    () => draft.removeAt(index),
                                  ),
                                  icon: const Icon(Icons.delete_outline),
                                ),
                              ],
                            ),
                            DropdownButtonFormField<String>(
                              initialValue: draft[index]['type'] as String,
                              decoration:
                                  const InputDecoration(labelText: 'النوع'),
                              items: const [
                                DropdownMenuItem(
                                  value: 'frame',
                                  child: Text('إطار'),
                                ),
                                DropdownMenuItem(
                                  value: 'entrance',
                                  child: Text('دخول'),
                                ),
                                DropdownMenuItem(
                                  value: 'room_background',
                                  child: Text('خلفية غرفة'),
                                ),
                              ],
                              onChanged: (value) {
                                if (value != null) {
                                  draft[index]['type'] = value;
                                }
                              },
                            ),
                            const SizedBox(height: 8),
                            DropdownButtonFormField<String>(
                              initialValue:
                                  draft[index]['assetKey'] as String,
                              isExpanded: true,
                              decoration:
                                  const InputDecoration(labelText: 'الأصل'),
                              items: _assets
                                  .map(
                                    (asset) => DropdownMenuItem(
                                      value: asset.assetKey,
                                      child: Text(
                                        asset.assetKey,
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                      ),
                                    ),
                                  )
                                  .toList(growable: false),
                              onChanged: (value) {
                                if (value != null) {
                                  draft[index]['assetKey'] = value;
                                }
                              },
                            ),
                            const SizedBox(height: 8),
                            TextFormField(
                              initialValue:
                                  (draft[index]['nameAr'] ?? '').toString(),
                              decoration: const InputDecoration(
                                labelText: 'الاسم الظاهر — اختياري',
                              ),
                              onChanged: (value) =>
                                  draft[index]['nameAr'] = value,
                            ),
                            const SizedBox(height: 8),
                            Row(
                              children: [
                                Expanded(
                                  child: TextFormField(
                                    initialValue:
                                        (draft[index]['hours'] ?? 24)
                                            .toString(),
                                    keyboardType: TextInputType.number,
                                    decoration: const InputDecoration(
                                      labelText: 'مدة الحق — ساعات',
                                    ),
                                    onChanged: (value) =>
                                        draft[index]['hours'] =
                                            int.tryParse(value) ?? 0,
                                  ),
                                ),
                                const SizedBox(width: 10),
                                Expanded(
                                  child: TextFormField(
                                    initialValue:
                                        (draft[index]['quantity'] ?? 1)
                                            .toString(),
                                    keyboardType: TextInputType.number,
                                    decoration: const InputDecoration(
                                      labelText: 'الكمية',
                                    ),
                                    onChanged: (value) =>
                                        draft[index]['quantity'] =
                                            int.tryParse(value) ?? 0,
                                  ),
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                    ),
                  const SizedBox(height: 10),
                  FilledButton.icon(
                    onPressed: () => Navigator.pop(sheetContext, true),
                    icon: const Icon(Icons.save_outlined),
                    label: const Text('حفظ الباكيج'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );

    if (save != true || !mounted) {
      name.dispose();
      packageHours.dispose();
      return;
    }

    final hours = int.tryParse(packageHours.text.trim()) ?? 0;
    final templateName = name.text.trim();
    final lines = draft
        .map(
          (item) => AgencyPackageLine(
            lineId: (item['lineId'] ?? '').toString(),
            type: (item['type'] ?? '').toString(),
            assetKey: (item['assetKey'] ?? '').toString(),
            nameAr: (item['nameAr'] ?? '').toString().trim(),
            entitlementDurationHours: item['hours'] as int? ?? 0,
            quantity: item['quantity'] as int? ?? 0,
          ),
        )
        .toList(growable: false);
    name.dispose();
    packageHours.dispose();

    if (templateName.length < 2 || hours <= 0 || lines.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تحقق من اسم الباكيج والمدد والكميات.')),
      );
      return;
    }

    setState(() => _busy = true);
    try {
      await _service.saveTemplate(
        templateId: template?.templateId,
        name: templateName,
        packageDurationHours: hours,
        lineItems: lines,
        idempotencyKey: _key('agency_package_save'),
      );
      await _load();
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('تعذر حفظ الباكيج: ' + error.toString())),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _duplicate(AgencyPackageTemplate template) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await _service.duplicateTemplate(
        sourceTemplateId: template.templateId,
        name: template.name + ' نسخة',
        idempotencyKey: _key('agency_package_duplicate'),
      );
      await _load();
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('تعذر نسخ الباكيج: ' + error.toString())),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _archive(AgencyPackageTemplate template) async {
    if (_busy) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('أرشفة الباكيج'),
        content: Text(
          'سيتم إيقاف منح «' +
              template.name +
              '» الجديد. المنح السابقة لا تتغير.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('إلغاء'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('أرشفة'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    setState(() => _busy = true);
    try {
      await _service.archiveTemplate(
        templateId: template.templateId,
        idempotencyKey: _key('agency_package_archive'),
      );
      await _load();
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('تعذر أرشفة الباكيج: ' + error.toString())),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _preview(AgencyPackageTemplate template) async {
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(template.name),
        content: SizedBox(
          width: 520,
          child: ListView(
            shrinkWrap: true,
            children: [
              Text(
                'مدة المخزون: ' +
                    template.packageDurationHours.toString() +
                    ' ساعة',
              ),
              const SizedBox(height: 10),
              for (final item in template.lineItems)
                ListTile(
                  dense: true,
                  leading: item.imageUrl == null
                      ? const Icon(Icons.auto_awesome)
                      : CircleAvatar(
                          backgroundImage: NetworkImage(item.imageUrl!),
                        ),
                  title: Text(
                    item.nameAr.isEmpty ? item.assetKey : item.nameAr,
                  ),
                  subtitle: Text(
                    _typeLabel(item.type) +
                        ' • ' +
                        item.entitlementDurationHours.toString() +
                        ' ساعة',
                  ),
                  trailing: Text('×' + item.quantity.toString()),
                ),
            ],
          ),
        ),
        actions: [
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('إغلاق'),
          ),
        ],
      ),
    );
  }

  String _typeLabel(String type) {
    if (type == 'frame') return 'إطار';
    if (type == 'entrance') return 'دخول';
    if (type == 'room_background') return 'خلفية غرفة';
    return type;
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(
          title: const Text('Agency Package Builder'),
          actions: [
            IconButton(
              onPressed: _busy ? null : _load,
              icon: const Icon(Icons.refresh),
            ),
          ],
        ),
        floatingActionButton: FloatingActionButton.extended(
          onPressed: _busy || _assets.isEmpty ? null : () => _edit(),
          icon: const Icon(Icons.add),
          label: const Text('باكيج جديد'),
        ),
        body: _loading
            ? const Center(child: CircularProgressIndicator())
            : _error != null
                ? Center(
                    child: FilledButton.icon(
                      onPressed: _load,
                      icon: const Icon(Icons.refresh),
                      label: Text('إعادة المحاولة — ' + _error!),
                    ),
                  )
                : ListView(
                    padding: const EdgeInsets.fromLTRB(16, 16, 16, 100),
                    children: [
                      Card(
                        child: ListTile(
                          leading: const Icon(Icons.inventory_2_outlined),
                          title: Text(
                            'القوالب ' +
                                _templates
                                    .where((e) => e.status == 'active')
                                    .length
                                    .toString() +
                                '/100',
                          ),
                          subtitle: const Text(
                            'Frames + Entrance Effects + Room Backgrounds. انتهاء الباكيج يلغي المخزون غير الموزع فقط.',
                          ),
                        ),
                      ),
                      const SizedBox(height: 10),
                      if (_templates.isEmpty)
                        const Card(
                          child: ListTile(
                            title: Text('لا توجد قوالب باكيج بعد.'),
                          ),
                        ),
                      for (final template in _templates)
                        Card(
                          child: ListTile(
                            leading: Icon(
                              template.status == 'active'
                                  ? Icons.inventory_2_rounded
                                  : Icons.archive_outlined,
                            ),
                            title: Text(template.name),
                            subtitle: Text(
                              template.lineItems.length.toString() +
                                  ' عناصر • ' +
                                  template.packageDurationHours.toString() +
                                  ' ساعة • ' +
                                  (template.status == 'active'
                                      ? 'نشط'
                                      : 'مؤرشف'),
                            ),
                            onTap: () => _preview(template),
                            trailing: PopupMenuButton<String>(
                              enabled: !_busy,
                              onSelected: (value) {
                                if (value == 'edit') _edit(template);
                                if (value == 'duplicate') {
                                  _duplicate(template);
                                }
                                if (value == 'archive') _archive(template);
                                if (value == 'preview') _preview(template);
                              },
                              itemBuilder: (_) => [
                                const PopupMenuItem(
                                  value: 'preview',
                                  child: Text('معاينة'),
                                ),
                                if (template.status == 'active')
                                  const PopupMenuItem(
                                    value: 'edit',
                                    child: Text('تعديل'),
                                  ),
                                const PopupMenuItem(
                                  value: 'duplicate',
                                  child: Text('نسخ'),
                                ),
                                if (template.status == 'active')
                                  const PopupMenuItem(
                                    value: 'archive',
                                    child: Text('أرشفة'),
                                  ),
                              ],
                            ),
                          ),
                        ),
                    ],
                  ),
      );
}
