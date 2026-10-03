import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import 'control_api_endpoints.dart';
import 'control_firebase.dart';

class ControlRelationshipTypesPage extends StatefulWidget {
  const ControlRelationshipTypesPage({super.key});

  @override
  State<ControlRelationshipTypesPage> createState() =>
      _ControlRelationshipTypesPageState();
}

class _ControlRelationshipTypesPageState
    extends State<ControlRelationshipTypesPage> {
  final List<_EditableRelationshipType> _types = [];
  bool _loading = true;
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    for (final type in _types) {
      type.dispose();
    }
    super.dispose();
  }

  Future<Map<String, dynamic>> _post(
    String action, [
    Map<String, dynamic> payload = const {},
  ]) async {
    final token = await controlAuth.currentUser?.getIdToken(true);
    if (token == null || token.trim().isEmpty) {
      throw StateError('auth_required');
    }
    final response = await http.post(
      shadowApiEndpoint('relationships'),
      headers: {
        'authorization': 'Bearer $token',
        'content-type': 'application/json',
      },
      body: jsonEncode({'action': action, ...payload}),
    );
    Map<String, dynamic> data = <String, dynamic>{};
    try {
      final decoded = jsonDecode(response.body);
      if (decoded is Map<String, dynamic>) data = decoded;
    } catch (_) {}
    if (response.statusCode != 200 || data['ok'] != true) {
      throw StateError((data['code'] ?? 'relationships_failed').toString());
    }
    return data;
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final body = await _post('types');
      final raw = body['types'];
      final next = <_EditableRelationshipType>[];
      if (raw is List) {
        for (final item in raw.whereType<Map>()) {
          next.add(
            _EditableRelationshipType.fromMap(
              Map<String, dynamic>.from(item),
            ),
          );
        }
      }
      next.sort((a, b) => a.order.compareTo(b.order));
      if (!mounted) {
        for (final type in next) {
          type.dispose();
        }
        return;
      }
      for (final type in _types) {
        type.dispose();
      }
      setState(() {
        _types
          ..clear()
          ..addAll(next);
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = _message(error);
      });
    }
  }

  void _normalizeOrder() {
    for (var index = 0; index < _types.length; index += 1) {
      _types[index].order = (index + 1) * 10;
    }
  }

  void _move(int index, int delta) {
    final target = index + delta;
    if (target < 0 || target >= _types.length) return;
    setState(() {
      final item = _types.removeAt(index);
      _types.insert(target, item);
      _normalizeOrder();
    });
  }

  Future<void> _addType() async {
    if (_types.length >= 20) {
      _snack('الحد الأقصى 20 نوع علاقة.');
      return;
    }
    final key = TextEditingController();
    final label = TextEditingController();
    final result = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('إضافة نوع علاقة'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: key,
              decoration: const InputDecoration(
                labelText: 'المفتاح الداخلي',
                hintText: 'مثال: mentor',
              ),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: label,
              decoration: const InputDecoration(
                labelText: 'الاسم الظاهر',
              ),
            ),
            const SizedBox(height: 8),
            const Text(
              'المفتاح الداخلي يثبت بعد الإنشاء ولا يتم تغييره لاحقاً.',
              style: TextStyle(fontSize: 12, color: Colors.white54),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('إلغاء'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('إضافة'),
          ),
        ],
      ),
    );
    final keyValue = key.text.trim().toLowerCase();
    final labelValue = label.text.trim();
    key.dispose();
    label.dispose();
    if (result != true) return;
    if (!RegExp(r'^[a-z0-9_]{2,32}$').hasMatch(keyValue)) {
      _snack('المفتاح يجب أن يكون 2–32 حرفاً: a-z / 0-9 / _.');
      return;
    }
    if (labelValue.isEmpty || labelValue.length > 40) {
      _snack('الاسم الظاهر مطلوب وبحد أقصى 40 حرفاً.');
      return;
    }
    if (_types.any((type) => type.key == keyValue)) {
      _snack('هذا المفتاح موجود مسبقاً.');
      return;
    }
    setState(() {
      _types.add(
        _EditableRelationshipType(
          key: keyValue,
          labelAr: labelValue,
          assetKey: '',
          enabled: true,
          order: (_types.length + 1) * 10,
        ),
      );
    });
  }

  Future<void> _save() async {
    if (_saving) return;
    for (final type in _types) {
      final label = type.label.text.trim();
      final asset = type.asset.text.trim();
      if (label.isEmpty || label.length > 40) {
        _snack('تحقق من أسماء أنواع العلاقات.');
        return;
      }
      if (asset.length > 160) {
        _snack('Asset Key طويل أكثر من الحد المسموح.');
        return;
      }
    }

    _normalizeOrder();
    setState(() => _saving = true);
    try {
      await _post('setTypes', {
        'types': _types
            .map(
              (type) => {
                'key': type.key,
                'labelAr': type.label.text.trim(),
                'assetKey': type.asset.text.trim(),
                'enabled': type.enabled,
                'order': type.order,
              },
            )
            .toList(growable: false),
      });
      if (!mounted) return;
      _snack('تم حفظ أنواع العلاقات.');
      await _load();
    } catch (error) {
      if (!mounted) return;
      _snack(_message(error));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  String _message(Object error) {
    final text = error.toString();
    if (text.contains('forbidden')) {
      return 'تحتاج Owner أو صلاحية manageSystem.';
    }
    if (text.contains('relationship_type_removal_not_allowed')) {
      return 'لا يمكن حذف نوع موجود؛ عطّله بدل الحذف.';
    }
    if (text.contains('invalid_relationship_types')) {
      return 'بيانات أنواع العلاقات غير صالحة.';
    }
    return 'تعذر تنفيذ العملية حالياً.';
  }

  void _snack(String text) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(text)),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('العلاقات / CP'),
          actions: [
            IconButton(
              tooltip: 'تحديث',
              onPressed: _loading || _saving ? null : _load,
              icon: const Icon(Icons.refresh_rounded),
            ),
          ],
        ),
        floatingActionButton: FloatingActionButton.extended(
          onPressed: _loading || _saving ? null : _addType,
          icon: const Icon(Icons.add_rounded),
          label: const Text('نوع جديد'),
        ),
        body: _loading && _types.isEmpty
            ? const Center(child: CircularProgressIndicator())
            : _error != null && _types.isEmpty
                ? Center(
                    child: FilledButton.icon(
                      onPressed: _load,
                      icon: const Icon(Icons.refresh_rounded),
                      label: Text(_error!),
                    ),
                  )
                : ListView(
                    padding: const EdgeInsets.fromLTRB(16, 16, 16, 100),
                    children: [
                      const Text(
                        'إدارة أنواع العلاقات',
                        style: TextStyle(
                          fontSize: 23,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      const SizedBox(height: 6),
                      const Text(
                        'يمكن تعديل الاسم وAsset والتفعيل والترتيب. '
                        'المفتاح الداخلي ثابت، والحذف غير مسموح لحماية العلاقات القديمة.',
                        style: TextStyle(color: Colors.white60, height: 1.45),
                      ),
                      const SizedBox(height: 14),
                      for (var index = 0;
                          index < _types.length;
                          index += 1)
                        _typeCard(index, _types[index]),
                      const SizedBox(height: 14),
                      FilledButton.icon(
                        onPressed: _saving ? null : _save,
                        icon: _saving
                            ? const SizedBox.square(
                                dimension: 18,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                ),
                              )
                            : const Icon(Icons.save_rounded),
                        label: Text(
                          _saving ? 'جارٍ الحفظ...' : 'حفظ التعديلات',
                        ),
                      ),
                    ],
                  ),
      ),
    );
  }

  Widget _typeCard(int index, _EditableRelationshipType type) {
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          children: [
            Row(
              children: [
                const Icon(
                  Icons.favorite_rounded,
                  color: Color(0xFFD7B85A),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    type.key,
                    textDirection: TextDirection.ltr,
                    style: const TextStyle(fontWeight: FontWeight.w900),
                  ),
                ),
                Switch(
                  value: type.enabled,
                  onChanged: _saving
                      ? null
                      : (value) => setState(() => type.enabled = value),
                ),
                IconButton(
                  tooltip: 'للأعلى',
                  onPressed:
                      _saving || index == 0 ? null : () => _move(index, -1),
                  icon: const Icon(Icons.arrow_upward_rounded),
                ),
                IconButton(
                  tooltip: 'للأسفل',
                  onPressed: _saving || index == _types.length - 1
                      ? null
                      : () => _move(index, 1),
                  icon: const Icon(Icons.arrow_downward_rounded),
                ),
              ],
            ),
            const SizedBox(height: 8),
            TextField(
              controller: type.label,
              enabled: !_saving,
              maxLength: 40,
              decoration: const InputDecoration(
                labelText: 'الاسم الظاهر',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: type.asset,
              enabled: !_saving,
              maxLength: 160,
              decoration: const InputDecoration(
                labelText: 'Asset Key — اختياري',
                border: OutlineInputBorder(),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _EditableRelationshipType {
  _EditableRelationshipType({
    required this.key,
    required String labelAr,
    required String assetKey,
    required this.enabled,
    required this.order,
  })  : label = TextEditingController(text: labelAr),
        asset = TextEditingController(text: assetKey);

  final String key;
  final TextEditingController label;
  final TextEditingController asset;
  bool enabled;
  int order;

  factory _EditableRelationshipType.fromMap(Map<String, dynamic> data) {
    return _EditableRelationshipType(
      key: (data['key'] ?? '').toString().trim(),
      labelAr: (data['labelAr'] ?? data['label'] ?? '').toString().trim(),
      assetKey: (data['assetKey'] ?? '').toString().trim(),
      enabled: data['enabled'] != false,
      order: (data['order'] as num?)?.toInt() ?? 999,
    );
  }

  void dispose() {
    label.dispose();
    asset.dispose();
  }
}
