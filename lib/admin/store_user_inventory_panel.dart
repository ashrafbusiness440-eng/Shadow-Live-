import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import '../core/assets/shadow_asset_registry.dart';
import 'control_api_endpoints.dart';
import 'control_firebase.dart';

/// Read-only inventory inspection. Permissions and target access are checked
/// afresh by the Worker on every request, never trusted from this widget.
class StoreUserInventoryPanel extends StatefulWidget {
  const StoreUserInventoryPanel({super.key});

  @override
  State<StoreUserInventoryPanel> createState() =>
      _StoreUserInventoryPanelState();
}

class _StoreUserInventoryPanelState extends State<StoreUserInventoryPanel> {
  final _uid = TextEditingController();
  bool _loading = false;
  String? _error;
  String? _target;
  bool _more = false;
  List<Map<String, dynamic>> _items = [];
  int _generation = 0;

  @override
  void dispose() {
    _generation++;
    _uid.dispose();
    super.dispose();
  }

  Future<void> _search() async {
    if (_loading) return;
    final target = _uid.text.trim();
    if (!RegExp(r'^[A-Za-z0-9_٠-٩۰-۹-]{1,128}$').hasMatch(target)) {
      setState(() {
        _error = 'اكتب معرّف الحساب الصحيح.';
        _target = null;
        _items = [];
        _more = false;
      });
      return;
    }
    final generation = ++_generation;
    setState(() {
      _loading = true;
      _target = null;
      _items = [];
      _more = false;
      _error = null;
    });
    try {
      final current = controlAuth.currentUser;
      if (current == null) throw StateError('unauthorized');
      final token = await current.getIdToken();
      if (token == null || token.isEmpty) throw StateError('unauthorized');
      final response = await http.post(
        shadowApiEndpoint('manage-store-inventory'),
        headers: {
          'content-type': 'application/json',
          'authorization': 'Bearer $token',
        },
        body: jsonEncode({'action': 'userItems', 'targetId': target}),
      ).timeout(const Duration(seconds: 25));
      final value = jsonDecode(response.body);
      if (value is! Map || response.statusCode != 200 || value['ok'] != true ||
          value['searchedId'] != target || value['items'] is! List ||
          value['purchasingEnabled'] != false ||
          value['moreMayExist'] is! bool) {
        final code = value is Map ? value['code']?.toString() ?? '' : '';
        throw StateError(code.isEmpty ? 'request_failed' : code);
      }
      final records = value['items'] as List;
      if (records.length > 100 || records.any((x) => x is! Map)) {
        throw const FormatException('invalid_store_inventory_response');
      }
      if (!mounted || generation != _generation) return;
      setState(() {
        _target = target;
        _items = records.map(
          (item) => Map<String, dynamic>.from(item as Map),
        ).toList(growable: false);
        _more = value['moreMayExist'] as bool;
      });
    } catch (error) {
      if (!mounted || generation != _generation) return;
      final message = error.toString();
      setState(() {
        _error = message.contains('recent_auth_required')
            ? 'يلزم تسجيل دخول حديث لعرض مقتنيات المستخدم.'
            : message.contains('forbidden')
                ? 'لا تملك صلاحية الاطلاع على مقتنيات المستخدمين.'
                : message.contains('not_found')
                    ? 'لم يتم العثور على هذا الحساب.'
                    : 'تعذّر تحميل المقتنيات. تحقق من الاتصال وحاول ثانية.';
      });
    } finally {
      if (mounted && generation == _generation) {
        setState(() => _loading = false);
      }
    }
  }

  String _date(int? timestamp) {
    if (timestamp == null) return 'دائم';
    final date = DateTime.fromMillisecondsSinceEpoch(timestamp).toLocal();
    return '${date.day}/${date.month}/${date.year}';
  }

  Widget _image(String key) => FutureBuilder<Uri?>(
    future: ShadowAssetRegistry.remoteUrl(key),
    builder: (context, snapshot) {
      final url = snapshot.data?.toString();
      if (url == null || url.isEmpty) {
        return const Icon(Icons.image_not_supported_outlined, size: 35);
      }
      return Image.network(
        url, width: 58, height: 58, fit: BoxFit.contain,
        errorBuilder: (_, __, ___) =>
            const Icon(Icons.image_not_supported_outlined, size: 35),
      );
    },
  );

  Widget _item(Map<String, dynamic> item) {
    final active = item['active'] == true;
    final expired = item['expired'] == true;
    final source = switch (item['source']) {
      'purchase' => 'شراء',
      'admin_grant' => 'منحة',
      'reward' => 'مكافأة',
      _ => 'غير معروف',
    };
    final expires = item['expiresAtMs'] is int
        ? item['expiresAtMs'] as int : null;
    return Card(
      child: ListTile(
        leading: SizedBox(width: 58, height: 58,
          child: _image(item['assetKey']?.toString() ?? '')),
        title: Text(item['nameAr']?.toString().isNotEmpty == true
            ? item['nameAr'].toString() : 'منتج من المتجر'),
        subtitle: Text(
          'رقم المنتج: ${item['productId']} • المصدر: $source\n'
          'من: ${_date(item['acquiredAtMs'] is int ? item['acquiredAtMs'] as int : null)}'
          ' • حتى: ${_date(expires)}\n'
          '${active ? 'صالح' : expired ? 'منتهي الصلاحية' : 'غير صالح'}',
        ),
        isThreeLine: true,
      ),
    );
  }

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      const Card(child: ListTile(
        leading: Icon(Icons.lock_outline),
        title: Text('مقتنيات المستخدمين — عرض فقط'),
        subtitle: Text('لا يمكن منح أي منتج أو تعديل ملكيته من هذه الصفحة. '
            'يلزم إذن مستقل من المالك ودخول حديث.'),
      )),
      const SizedBox(height: 8),
      TextField(
        controller: _uid,
        enabled: !_loading,
        textDirection: TextDirection.ltr,
        decoration: const InputDecoration(
          labelText: 'معرّف المستخدم (ID)',
          hintText: 'رقم المستخدم الظاهر بالتطبيق أو UID',
          border: OutlineInputBorder(),
          prefixIcon: Icon(Icons.person_search_outlined),
        ),
        onSubmitted: (_) => _search(),
      ),
      const SizedBox(height: 8),
      Align(alignment: Alignment.centerRight, child: FilledButton.icon(
        onPressed: _loading ? null : _search,
        icon: const Icon(Icons.search),
        label: const Text('عرض المقتنيات'),
      )),
      if (_loading) const LinearProgressIndicator(),
      if (_error != null) Padding(
        padding: const EdgeInsets.all(10),
        child: Text(_error!, style: const TextStyle(color: Colors.orangeAccent)),
      ),
      if (_target != null) ...[
        const SizedBox(height: 12),
        Text('المقتنيات: ${_items.length} • الحساب: $_target'),
        if (_items.isEmpty) const Card(child: ListTile(
          title: Text('لا توجد مقتنيات متجر محفوظة لهذا الحساب.'),
        )),
        for (final item in _items) _item(item),
        if (_more) const Padding(
          padding: EdgeInsets.all(8),
          child: Text('تم عرض أول 100 مقتنى فقط. '
              'عرض بقية السجل يحتاج إضافة التصفح بالصفحات.'),
        ),
      ],
    ],
  );
}
