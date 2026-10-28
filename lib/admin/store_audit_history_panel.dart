import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import 'control_api_endpoints.dart';
import 'control_firebase.dart';

class StoreAuditHistoryPanel extends StatefulWidget {
  const StoreAuditHistoryPanel({super.key});

  @override
  State<StoreAuditHistoryPanel> createState() => _StoreAuditHistoryPanelState();
}

class _StoreAuditHistoryPanelState extends State<StoreAuditHistoryPanel> {
  bool _loading = false;
  String? _error;
  bool _loaded = false;
  bool _more = false;
  List<Map<String, dynamic>> _entries = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (_loading) return;
    setState(() { _loading = true; _error = null; });
    try {
      final user = controlAuth.currentUser;
      if (user == null) throw StateError('unauthorized');
      final token = await user.getIdToken();
      if (token == null || token.isEmpty) throw StateError('unauthorized');
      final response = await http.post(
        shadowApiEndpoint('manage-store-audit'),
        headers: {'authorization': 'Bearer $token',
          'content-type': 'application/json'},
        body: jsonEncode({'action': 'history'}),
      ).timeout(const Duration(seconds: 25));
      final parsed = jsonDecode(response.body);
      if (parsed is! Map || response.statusCode != 200 ||
          parsed['ok'] != true || parsed['entries'] is! List ||
          parsed['purchasingEnabled'] != false ||
          parsed['moreMayExist'] is! bool) {
        final code = parsed is Map ? parsed['code']?.toString() ?? '' : '';
        throw StateError(code.isEmpty ? 'request_failed' : code);
      }
      final raw = parsed['entries'] as List;
      if (raw.length > 50 || raw.any((entry) => entry is! Map)) {
        throw const FormatException('invalid_store_audit');
      }
      if (!mounted) return;
      setState(() {
        _entries = raw.map((e) =>
          Map<String, dynamic>.from(e as Map)).toList(growable: false);
        _more = parsed['moreMayExist'] as bool;
        _loaded = true;
      });
    } catch (error) {
      if (!mounted) return;
      final cause = error.toString();
      setState(() {
        _error = cause.contains('recent_auth_required')
            ? 'يلزم تسجيل الدخول مجدداً للاطلاع على سجل التعديلات.'
            : cause.contains('forbidden')
                ? 'لا تملك صلاحية عرض سجل تعديلات المتجر.'
                : 'تعذّر تحميل سجل تعديلات المتجر. جرّب مجدداً.';
      });
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Widget _entry(Map<String, dynamic> entry) {
    final date = entry['at'] == null
        ? 'الوقت غير متاح'
        : DateTime.tryParse(entry['at'].toString())?.toLocal().toString()
            .substring(0, 16) ?? 'الوقت غير متاح';
    final ids = entry['changedIds'] is List
        ? (entry['changedIds'] as List).map((e) => e.toString()).join('، ')
        : '';
    return Card(child: ListTile(
      leading: const Icon(Icons.history),
      title: Text('تعديل رقم ${entry['toRevision']} • $date'),
      subtitle: Text(
        'بواسطة: ${entry['actorUid']}\n'
        'من الإصدار ${entry['fromRevision']} إلى ${entry['toRevision']}\n'
        '${ids.isEmpty ? 'لا توجد أرقام منتجات مسجلة' : 'المنتجات: $ids'}',
      ),
      isThreeLine: true,
    ));
  }

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      const Card(child: ListTile(
        leading: Icon(Icons.security_outlined),
        title: Text('سجل تعديلات المتجر'),
        subtitle: Text('عرض للقراءة فقط من السجلات الحقيقية. '
            'لا يُظهر سجلات الحسابات الأخرى أو يتيح تعديل المنتجات.'),
      )),
      Align(alignment: Alignment.centerRight,child: OutlinedButton.icon(
        onPressed: _loading ? null : _load,
        icon: const Icon(Icons.refresh),label: const Text('تحديث السجل'),
      )),
      if (_loading) const LinearProgressIndicator(),
      if (_error != null) Padding(
        padding: const EdgeInsets.all(8),
        child: Text(_error!, style: const TextStyle(color: Colors.orangeAccent)),
      ),
      if (_loaded && _entries.isEmpty)
        const Card(child: ListTile(
          title: Text('لا توجد تعديلات متجر في النتائج المسترجعة.'),
        )),
      for (final entry in _entries) _entry(entry),
      if (_more) const Padding(
        padding: EdgeInsets.all(8),
        child: Text('تم عرض 50 نتيجة كحد أقصى. '
            'هذه القائمة لا تعني أن جميع التعديلات القديمة معروضة.'),
      ),
    ],
  );
}
