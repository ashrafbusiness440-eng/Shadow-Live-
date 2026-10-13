import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:file_picker/file_picker.dart';
import 'content_filter_import.dart';

import 'control_api_endpoints.dart';
import 'control_firebase.dart';

/// Single Arabic-first entrypoint for all filter settings.
class ContentFilterControlPage extends StatefulWidget {
  const ContentFilterControlPage({super.key});

  @override
  State<ContentFilterControlPage> createState() =>
      _ContentFilterControlPageState();
}

class _ContentFilterControlPageState extends State<ContentFilterControlPage> {
  static const _surfaces = <String, String>{
    'private_chat': 'الرسائل الخاصة',
    'room_chat': 'رسائل الغرف الصوتية',
    'diary_post': 'منشورات يومياتي',
    'diary_comment': 'تعليقات يومياتي',
  };
  static const _actions = <String, String>{
    'mask': 'إخفاء الكلمة بنجوم',
    'block': 'منع الإرسال',
    'flag': 'تسجيل مخالفة للمراجعة',
  };
  static const _groups = <String, String>{
    'insults': 'شتائم',
    'sexual': 'ألفاظ جنسية مسيئة',
    'bullying': 'تنمر',
    'spam': 'إزعاج وتكرار',
    'ads': 'إعلانات',
    'links': 'روابط',
    'other': 'أخرى',
  };

  final _search = TextEditingController();
  final _reason = TextEditingController(text: 'تعديل قائمة الكلمات المحظورة');
  final _sample = TextEditingController();
  bool _loading = true;
  bool _loadFailed = false;
  bool _busy = false;
  bool _enabled = false;
  bool _dirty = false;
  int _version = 0;
  int _visibleLimit = 30;
  String _testSurface = 'private_chat';
  String? _message;
  String? _preview;
  bool _previewBlocked = false;
  bool _previewFlagged = false;
  Map<String, bool> _areas = {
    for (final k in _surfaces.keys) k: true,
  };
  List<Map<String, dynamic>> _rules = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _search.dispose();
    _reason.dispose();
    _sample.dispose();
    super.dispose();
  }

  Map<String, dynamic> get _policy => {
        'enabled': _enabled,
        'surfaces': _areas,
        'rules': _rules,
      };

  String _errorLabel(String code) => switch (code) {
        'forbidden' => 'ما عندك صلاحية لتعديل قائمة الكلمات.',
        'unauthorized' => 'انتهت جلسة الإدارة. سجّل الدخول من جديد.',
        'recent_auth_required' => 'سجّل الدخول من جديد قبل التعديل.',
        'duplicate_filter_rule' => 'في كلمة مكررة ضمن نفس الأماكن. راجع القائمة.',
        'invalid_filter_config' || 'invalid_rule' =>
          'في إعداد أو كلمة غير صحيحة. راجع البيانات قبل الحفظ.',
        'filter_conflict' => 'تغيّرت القائمة من جهاز آخر. حدّث الصفحة وراجع التغييرات.',
        _ => 'تعذر إكمال الطلب. تأكد من الاتصال وحاول مرة ثانية.',
      };

  Future<Map<String, dynamic>> _send(Map<String, dynamic> data) async {
    final user = controlAuth.currentUser;
    if (user == null) throw const FormatException('unauthorized');
    final token = await user.getIdToken();
    if (token == null || token.isEmpty) {
      throw const FormatException('unauthorized');
    }
    final response = await http
        .post(
          shadowApiEndpoint('content-filter-control'),
          headers: {
            'authorization': 'Bearer $token',
            'content-type': 'application/json',
          },
          body: jsonEncode(data),
        )
        .timeout(const Duration(seconds: 15));
    final decoded = jsonDecode(response.body);
    if (decoded is! Map) throw const FormatException('invalid_response');
    final body = Map<String, dynamic>.from(decoded);
    if (body['ok'] != true) throw FormatException('${body['code'] ?? ''}');
    return body;
  }

  void _apply(Map<String, dynamic> policy) {
    final areas = policy['surfaces'] is Map
        ? Map<String, dynamic>.from(policy['surfaces'] as Map)
        : <String, dynamic>{};
    final rules = policy['rules'] is List ? policy['rules'] as List : [];
    _enabled = policy['enabled'] == true;
    _areas = {for (final k in _surfaces.keys) k: areas[k] != false};
    _rules = rules
        .whereType<Map>()
        .map((value) => Map<String, dynamic>.from(value))
        .toList();
    _version = (policy['version'] as num?)?.toInt() ?? 0;
    _dirty = false;
  }

  Future<void> _load() async {
    if (_busy) return;
    setState(() {
      _loading = true;
      _message = null;
    });
    try {
      final response = await _send({'action': 'load'});
      if (!mounted) return;
      setState(() {
        _apply(Map<String, dynamic>.from(response['config'] as Map));
        _loadFailed = false;
        if (response['roomSynced'] != true) {
          _message = 'إعدادات رسائل الغرف لم تتحدّث بعد. اضغط تحديث لاحقًا للتأكد.';
        }
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loadFailed = true;
        _message = _errorLabel(
          error is FormatException ? error.message : '',
        );
      });
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _save() async {
    if (_busy || _loading || !_dirty) return;
    if (_reason.text.trim().length < 3) {
      setState(() => _message = 'اكتب سببًا مختصرًا للتغيير.');
      return;
    }
    setState(() { _busy = true; _message = null; });
    try {
      final response = await _send({
        'action': 'save',
        'config': _policy,
        'expectedVersion': _version,
        'reason': _reason.text.trim(),
        'idempotencyKey': 'content_filter_${DateTime.now().microsecondsSinceEpoch}',
      });
      if (!mounted) return;
      setState(() {
        _apply(Map<String, dynamic>.from(response['config'] as Map));
        _message = response['roomSynced'] == true
            ? 'تم حفظ إعدادات الفلترة بنجاح. قد تستغرق رسائل الغرف دقيقة لتحديثها.'
            : 'انحفظت الإعدادات، لكن تطبيقها في الغرف لم يتأكد. حدّث الصفحة قبل الاعتماد عليها.';
      });
    } catch (error) {
      if (!mounted) return;
      setState(() => _message = _errorLabel(
            error is FormatException ? error.message : '',
          ));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _previewText() async {
    if (_busy || _loading || _sample.text.trim().isEmpty) return;
    setState(() { _busy = true; _message = null; });
    try {
      final response = await _send({
        'action': 'preview',
        'surface': _testSurface,
        'text': _sample.text.trim(),
        'config': _policy,
      });
      if (!mounted) return;
      final result = Map<String, dynamic>.from(response['result'] as Map);
      setState(() {
        _preview = '${result['text'] ?? ''}';
        _previewBlocked = result['blocked'] == true;
        _previewFlagged = result['flagged'] == true;
      });
    } catch (error) {
      if (mounted) {
        setState(() => _message = _errorLabel(
          error is FormatException ? error.message : '',
        ));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _changed(VoidCallback update) {
    setState(() {
      update();
      _dirty = true;
      _preview = null;
      _message = null;
    });
  }

  Future<void> _editRule([int? index]) async {
    final old = index == null ? <String, dynamic>{} : _rules[index];
    final pattern = TextEditingController(text: '${old['pattern'] ?? ''}');
    final exceptions = TextEditingController(
      text: (old['exceptions'] is List
              ? (old['exceptions'] as List).join('، ')
              : ''),
    );
    String action = '${old['action'] ?? 'mask'}';
    String group = '${old['group'] ?? 'insults'}';
    final selected = <String>{
      ...(old['surfaces'] is List
          ? (old['surfaces'] as List).map((e) => '$e')
          : _surfaces.keys),
    };
    bool enabled = old['enabled'] != false;
    String? localError;
    final saved = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, refresh) => AlertDialog(
          title: Text(index == null ? 'إضافة كلمة' : 'تعديل كلمة'),
          content: SizedBox(
            width: 450,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  TextField(
                    controller: pattern,
                    maxLength: 80,
                    decoration: const InputDecoration(
                      labelText: 'الكلمة أو العبارة',
                      hintText: 'اكتب الكلمة التي تريد فلترتها',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 8),
                  DropdownButtonFormField<String>(
                    initialValue: group,
                    isExpanded: true,
                    decoration: const InputDecoration(
                      labelText: 'التصنيف', border: OutlineInputBorder(),
                    ),
                    items: [
                      for (final entry in _groups.entries)
                        DropdownMenuItem(value: entry.key, child: Text(entry.value)),
                    ],
                    onChanged: (v) { if (v != null) refresh(() => group = v); },
                  ),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<String>(
                    initialValue: action,
                    isExpanded: true,
                    decoration: const InputDecoration(
                      labelText: 'ماذا يحدث عند اكتشافها؟',
                      border: OutlineInputBorder(),
                    ),
                    items: [
                      for (final entry in _actions.entries)
                        DropdownMenuItem(value: entry.key, child: Text(entry.value)),
                    ],
                    onChanged: (v) { if (v != null) refresh(() => action = v); },
                  ),
                  const SizedBox(height: 10),
                  const Text('أماكن تطبيق الكلمة',
                      style: TextStyle(fontWeight: FontWeight.bold)),
                  for (final entry in _surfaces.entries)
                    CheckboxListTile(
                      contentPadding: EdgeInsets.zero,
                      dense: true,
                      value: selected.contains(entry.key),
                      title: Text(entry.value),
                      onChanged: (v) => refresh(() {
                        if (v == true) { selected.add(entry.key); }
                        else { selected.remove(entry.key); }
                      }),
                    ),
                  TextField(
                    controller: exceptions,
                    decoration: const InputDecoration(
                      labelText: 'عبارات مستثناة (اختياري)',
                      hintText: 'افصل بين العبارات بفاصلة',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('هذه الكلمة مفعّلة'),
                    value: enabled,
                    onChanged: (v) => refresh(() => enabled = v),
                  ),
                  if (localError != null)
                    Text(localError!, style: const TextStyle(color: Colors.orangeAccent)),
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
                if (pattern.text.trim().length < 2 || selected.isEmpty) {
                  refresh(() => localError =
                    'اكتب كلمة من حرفين على الأقل واختر مكانًا واحدًا.');
                  return;
                }
                Navigator.pop(dialogContext, {
                  'id': old['id'] ??
                      'word_${DateTime.now().microsecondsSinceEpoch}',
                  'pattern': pattern.text.trim(),
                  'group': group,
                  'action': action,
                  'enabled': enabled,
                  'surfaces': selected.toList(),
                  'exceptions': exceptions.text
                      .split(RegExp('[،,]'))
                      .map((v) => v.trim())
                      .where((v) => v.isNotEmpty)
                      .take(8)
                      .toList(),
                });
              },
              child: const Text('اعتماد الكلمة'),
            ),
          ],
        ),
      ),
    );
    pattern.dispose();
    exceptions.dispose();
    if (saved == null || !mounted) return;
    _changed(() {
      if (index == null) {
        _rules.add(saved);
      } else {
        _rules[index] = saved;
      }
    });
  }

  Future<void> _bulkAdd() async {
    final input = TextEditingController();
    final accepted = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('إضافة عدة كلمات'),
        content: SizedBox(
          width: 420,
          child: TextField(
            controller: input, maxLines: 8, maxLength: 9000,
            decoration: const InputDecoration(
              labelText: 'كل كلمة أو عبارة بسطر مستقل',
              hintText: 'انسخ الكلمات والصقها هنا',
              border: OutlineInputBorder(),
            ),
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext),
              child: const Text('إلغاء')),
          FilledButton(onPressed: () => Navigator.pop(dialogContext, input.text),
              child: const Text('إضافة إلى القائمة')),
        ],
      ),
    );
    input.dispose();
    if (accepted == null || !mounted) return;
    _addUnreviewedWords(accepted.split(RegExp(r'[\r\n]+')));
  }

  void _addUnreviewedWords(Iterable<String> raw) {
    final words = raw.map((v) => v.trim())
        .where((v) => v.length >= 2 && v.length <= 80)
        .toSet();
    final known = _rules.map((e) => '${e['pattern']}'.toLowerCase()).toSet();
    final additions = words.where((v) => !known.contains(v.toLowerCase()))
        .take(300 - _rules.length)
        .toList();
    _changed(() {
      for (final word in additions) {
        _rules.add({
          'id': 'word_${DateTime.now().microsecondsSinceEpoch}_${_rules.length}',
          'pattern': word,
          'group': 'insults',
          'action': 'mask',
          'enabled': false, // Review individually before enabling.
          'surfaces': _surfaces.keys.toList(),
          'exceptions': <String>[],
        });
      }
      _message = 'أُضيفت ${additions.length} كلمة غير مفعّلة. راجعها ثم احفظ.';
    });
  }

  Future<void> _importFile() async {
    if (_rules.length >= 300 || _busy) return;
    try {
      final file = await FilePicker.pickFile(
        type: FileType.custom, allowedExtensions: const ['txt', 'csv'],
      );
      if (file == null || !mounted) return;
      final length = file.lengthSync() ?? await file.length();
      if (length == null || length > 64 * 1024) {
        setState(() => _message =
          'الملف كبير أو تعذر فتحه. اختر ملفًا أصغر من 64 كيلوبايت.');
        return;
      }
      final bytes = await file.readAsBytes();
      if (bytes.lengthInBytes > 64 * 1024) {
        if (mounted) setState(() =>
          _message = 'الملف كبير. اختر ملفًا أصغر من 64 كيلوبايت.');
        return;
      }
      if (!mounted) return;
      final words = parseImportedFilterWords(bytes, fileName: file.name);
      _addUnreviewedWords(words);
    } on FormatException {
      if (mounted) setState(() => _message = 'تعذر قراءة الملف. استخدم قائمة كلمات أو جدولًا محفوظًا بالعربية.');
    } catch (_) {
      if (mounted) setState(() => _message = 'تعذر فتح الملف. جرّب نسخه ولصقه بدلًا من ذلك.');
    }
  }

  Future<void> _copyBackup() async {
    final lines = _rules.map((rule) => [
      '${rule['pattern']}'.replaceAll('"', '""'),
      '${rule['group']}',
      '${rule['action']}',
      rule['enabled'] == true ? 'نعم' : 'لا',
    ].map((value) => '"$value"').join(',')).join('\n');
    await Clipboard.setData(ClipboardData(
      text: '"الكلمة","التصنيف","التصرف","مفعلة"\n$lines',
    ));
    if (mounted) {
      setState(() => _message = 'تم نسخ نسخة من القائمة، يمكنك حفظها في مكان آمن.');
    }
  }

  Future<void> _deleteRule(int index) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('حذف الكلمة؟'),
        content: Text('هل تريد حذف «${_rules[index]['pattern']}» من القائمة؟'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false),
            child: const Text('إلغاء')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true),
            child: const Text('حذف')),
        ],
      ),
    );
    if (confirmed == true && mounted) _changed(() => _rules.removeAt(index));
  }

  @override
  Widget build(BuildContext context) {
    final term = _search.text.trim().toLowerCase();
    final matches = _rules.asMap().entries.where((entry) {
      final rule = entry.value;
      return term.isEmpty ||
          '${rule['pattern']}'.toLowerCase().contains(term) ||
          (_groups['${rule['group']}'] ?? '').contains(term);
    }).toList();
    final visible = matches.take(_visibleLimit).toList();
    return Scaffold(
      appBar: AppBar(
        title: const Text('فلترة الكلمات'),
        actions: [
          IconButton(
            tooltip: 'تحديث القائمة',
            onPressed: _busy || _loading || _dirty ? null : _load,
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _loadFailed
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(20),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.cloud_off_outlined, size: 40),
                        const SizedBox(height: 12),
                        Text(_message ?? 'تعذر تحميل قائمة الكلمات.',
                            textAlign: TextAlign.center),
                        const SizedBox(height: 12),
                        FilledButton.icon(
                          onPressed: _load,
                          icon: const Icon(Icons.refresh_rounded),
                          label: const Text('إعادة المحاولة'),
                        ),
                      ],
                    ),
                  ),
                )
              : ListView(
              padding: const EdgeInsets.all(14),
              children: [
                const Text('تحكم بالكلمات غير المناسبة داخل التطبيق',
                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
                const SizedBox(height: 6),
                const Text(
                  'أي تعديل هنا لا يؤثر على المستخدمين حتى تضغط «حفظ التغييرات».',
                  style: TextStyle(color: Colors.white70),
                ),
                const SizedBox(height: 14),
                Card(
                  child: Column(
                    children: [
                      SwitchListTile(
                        title: const Text('تشغيل فلترة الكلمات'),
                        subtitle: Text(_enabled
                            ? 'الفلترة تعمل في الأماكن التي تختارها'
                            : 'الفلترة متوقفة حاليًا'),
                        value: _enabled,
                        onChanged: _busy ? null : (v) =>
                            _changed(() => _enabled = v),
                      ),
                      const Divider(height: 1),
                      const Padding(
                        padding: EdgeInsets.fromLTRB(16, 14, 16, 2),
                        child: Align(
                          alignment: Alignment.centerRight,
                          child: Text('أماكن تطبيق الفلترة',
                              style: TextStyle(fontWeight: FontWeight.w800)),
                        ),
                      ),
                      for (final entry in _surfaces.entries)
                        SwitchListTile(
                          dense: true,
                          title: Text(entry.value),
                          value: _areas[entry.key] == true,
                          onChanged: _busy ? null : (v) =>
                              _changed(() => _areas[entry.key] = v),
                        ),
                    ],
                  ),
                ),
                const SizedBox(height: 12),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('الكلمات المحظورة (${_rules.length})',
                            style: const TextStyle(
                              fontSize: 18, fontWeight: FontWeight.w800)),
                        const SizedBox(height: 6),
                        const Text('اختَر ما يحدث عند اكتشاف كل كلمة. '
                            'يمكنك إيقاف أي كلمة وحدها.'),
                        const SizedBox(height: 10),
                        TextField(
                          controller: _search,
                          onChanged: (_) => setState(() => _visibleLimit = 30),
                          decoration: const InputDecoration(
                            labelText: 'ابحث عن كلمة أو تصنيف',
                            prefixIcon: Icon(Icons.search_rounded),
                            border: OutlineInputBorder(),
                          ),
                        ),
                        const SizedBox(height: 10),
                        Wrap(
                          spacing: 8, runSpacing: 8,
                          children: [
                            FilledButton.icon(
                              onPressed: _busy || _rules.length >= 300
                                  ? null : () => _editRule(),
                              icon: const Icon(Icons.add),
                              label: const Text('إضافة كلمة'),
                            ),
                            OutlinedButton.icon(
                              onPressed: _busy || _rules.length >= 300
                                  ? null : _bulkAdd,
                              icon: const Icon(Icons.library_add_outlined),
                              label: const Text('إضافة عدة كلمات'),
                            ),
                            OutlinedButton.icon(
                              onPressed: _busy || _rules.length >= 300
                                  ? null : _importFile,
                              icon: const Icon(Icons.upload_file_outlined),
                              label: const Text('إضافة من ملف'),
                            ),
                            OutlinedButton.icon(
                              onPressed: _rules.isEmpty ? null : _copyBackup,
                              icon: const Icon(Icons.copy_rounded),
                              label: const Text('نسخ نسخة احتياطية'),
                            ),
                          ],
                        ),
                        const Divider(height: 20),
                        if (matches.isEmpty)
                          const Padding(
                            padding: EdgeInsets.all(12),
                            child: Text('ما في كلمات مطابقة لبحثك.'),
                          ),
                        for (final found in visible)
                          ListTile(
                            contentPadding: EdgeInsets.zero,
                            title: Text('${found.value['pattern']}',
                                maxLines: 2, overflow: TextOverflow.ellipsis),
                            subtitle: Text(
                              '${_groups['${found.value['group']}'] ?? 'أخرى'}'
                              ' • ${_actions['${found.value['action']}'] ?? 'إخفاء الكلمة بنجوم'}',
                              maxLines: 2, overflow: TextOverflow.ellipsis),
                            leading: Switch(
                              value: found.value['enabled'] != false,
                              onChanged: _busy ? null : (v) => _changed(() =>
                                _rules[found.key] = {
                                  ...found.value, 'enabled': v,
                                }),
                            ),
                            trailing: PopupMenuButton<String>(
                              tooltip: 'خيارات الكلمة',
                              onSelected: (choice) {
                                if (choice == 'edit') _editRule(found.key);
                                if (choice == 'delete') _deleteRule(found.key);
                              },
                              itemBuilder: (_) => const [
                                PopupMenuItem(value: 'edit',
                                    child: Text('تعديل الكلمة')),
                                PopupMenuItem(value: 'delete',
                                    child: Text('حذف الكلمة')),
                              ],
                            ),
                          ),
                        if (matches.length > visible.length)
                          TextButton(
                            onPressed: () =>
                                setState(() => _visibleLimit += 30),
                            child: const Text('عرض المزيد من الكلمات'),
                          ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('جرّب الفلترة قبل الحفظ',
                            style: TextStyle(
                              fontSize: 18, fontWeight: FontWeight.w800)),
                        const Text(
                          'التجربة لا ترسل رسالة ولا تشغّل الفلتر للمستخدمين.',
                          style: TextStyle(color: Colors.white70),
                        ),
                        const SizedBox(height: 8),
                        DropdownButtonFormField<String>(
                          initialValue: _testSurface,
                          isExpanded: true,
                          decoration: const InputDecoration(
                            labelText: 'وين بدك تجرب؟',
                            border: OutlineInputBorder(),
                          ),
                          items: [
                            for (final entry in _surfaces.entries)
                              DropdownMenuItem(value: entry.key,
                                  child: Text(entry.value)),
                          ],
                          onChanged: (v) => setState(() {
                            _testSurface = v ?? _testSurface;
                            _preview = null;
                          }),
                        ),
                        const SizedBox(height: 10),
                        TextField(
                          controller: _sample,
                          maxLines: 3,
                          maxLength: 500,
                          decoration: const InputDecoration(
                            labelText: 'اكتب رسالة للتجربة',
                            border: OutlineInputBorder(),
                          ),
                        ),
                        OutlinedButton.icon(
                          onPressed: _busy ? null : _previewText,
                          icon: const Icon(Icons.visibility_outlined),
                          label: const Text('اعرض النتيجة'),
                        ),
                        if (_preview != null) ...[
                          const SizedBox(height: 10),
                          SelectableText(_previewBlocked
                              ? 'النتيجة: لن تُرسل الرسالة'
                              : _previewFlagged
                                  ? 'النتيجة: تُرسل وتُسجّل للمراجعة\n$_preview'
                                  : 'النتيجة: $_preview'),
                        ],
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _reason,
                  maxLength: 180,
                  decoration: const InputDecoration(
                    labelText: 'سبب التغيير',
                    border: OutlineInputBorder(),
                    hintText: 'اكتب سببًا بسيطًا لحفظ الإعدادات',
                  ),
                ),
                FilledButton.icon(
                  onPressed: !_dirty || _busy ? null : _save,
                  icon: const Icon(Icons.save_outlined),
                  label: Text(_busy ? 'جارٍ التنفيذ...' : 'حفظ التغييرات'),
                ),
                if (_dirty)
                  const Padding(
                    padding: EdgeInsets.only(top: 8),
                    child: Text('عندك تغييرات لم تُحفظ بعد.',
                        style: TextStyle(color: Color(0xFFFFD79E))),
                  ),
                if (_message != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 10),
                    child: Text(_message!,
                        style: const TextStyle(fontWeight: FontWeight.w700)),
                  ),
                const SizedBox(height: 28),
              ],
            ),
    );
  }
}
