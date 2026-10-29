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
  bool _canViewOperations = false;
  bool _moreOperations = false;
  List<Map<String, dynamic>> _entries = [];
  List<Map<String, dynamic>> _operationEntries = [];

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
      // A Worker from an older deployment may not yet expose operations.
      // In that case continue showing catalog history, never guess an
      // Owner's permission from the Flutter client.
      final canViewOperations = parsed['canViewOperations'] == true;
      final rawOperations = parsed['operationEntries'];
      if (canViewOperations &&
          (rawOperations is! List || rawOperations.length > 50 ||
              rawOperations.any((entry) => entry is! Map) ||
              parsed['moreOperationsMayExist'] is! bool)) {
        throw const FormatException('invalid_store_operation_audit');
      }
      if (!mounted) return;
      setState(() {
        _entries = raw.map((e) =>
          Map<String, dynamic>.from(e as Map)).toList(growable: false);
        _more = parsed['moreMayExist'] as bool;
        _canViewOperations = canViewOperations;
        _moreOperations = canViewOperations &&
            parsed['moreOperationsMayExist'] == true;
        _operationEntries = canViewOperations
            ? (rawOperations as List).map((entry) =>
                Map<String, dynamic>.from(entry as Map)).toList(growable: false)
            : [];
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

  String _operationName(String action) => switch (action) {
    'grant' => 'منح منتج',
    'revoke' => 'سحب منحة',
    'purchase' => 'شراء منتج',
    'renew' => 'تجديد منتج',
    _ => 'عملية متجر',
  };

  Widget _operation(Map<String, dynamic> entry) {
    final action = (entry['action'] ?? '').toString();
    final at = DateTime.tryParse((entry['at'] ?? '').toString())?.toLocal();
    final date = at == null ? 'وقت غير متاح'
        : '${at.day}/${at.month}/${at.year}';
    final amount = entry['priceCoins'];
    return Card(child: ListTile(
      leading: const Icon(Icons.receipt_long_outlined),
      title: Text('${_operationName(action)} • $date'),
      subtitle: Text(
        'رقم المنتج: ${entry['productId']}\n'
        'حساب المستفيد: ${entry['targetUid']}\n'
        'بواسطة: ${entry['actorUid']}'
        '${amount is int && amount > 0 ? ' • $amount كوينز' : ''}',
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
            'تفاصيل عمليات المستخدمين تظهر للمالك فقط، ولا يمكن تعديل السجلات.'),
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
      if (_canViewOperations) ...[
        const SizedBox(height: 12),
        const Divider(),
        const ListTile(
          leading: Icon(Icons.admin_panel_settings_outlined),
          title: Text('سجل عمليات المتجر'),
          subtitle: Text('منح المنتجات وسحبها والشراء والتجديد. '
              'للمالك فقط، عرض للقراءة من سجلات حقيقية. '
              'لا يحتوي على بيانات المحفظة الخاصة.'),
        ),
        if (_loaded && _operationEntries.isEmpty)
          const Card(child: ListTile(
            title: Text('لا توجد عمليات متجر محفوظة في النتائج المعروضة.'),
          )),
        for (final entry in _operationEntries) _operation(entry),
        if (_moreOperations) const Padding(
          padding: EdgeInsets.all(8),
          child: Text('يظهر حتى 50 سجل عملية. '
              'قد توجد عمليات أقدم خارج النتائج الحالية.'),
        ),
      ],
    ],
  );
}
