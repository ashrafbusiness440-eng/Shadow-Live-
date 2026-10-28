import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import 'control_api_endpoints.dart';
import 'control_firebase.dart';

/// Grant-preview screen only; intentionally offers NO submission or issue button.
class StoreGrantPreviewPanel extends StatefulWidget {
  const StoreGrantPreviewPanel({super.key, this.catalogItems = const []});

  final List<Map<String, dynamic>> catalogItems;

  @override
  State<StoreGrantPreviewPanel> createState() => _StoreGrantPreviewPanelState();
}

class _StoreGrantPreviewPanelState extends State<StoreGrantPreviewPanel> {
  final _userId = TextEditingController();
  final _productId = TextEditingController();
  bool _loading = false;
  String? _error;
  Map<String, dynamic>? _preview;
  int _generation = 0;

  @override
  void dispose() {
    _generation++;
    _userId.dispose();
    _productId.dispose();
    super.dispose();
  }

  void _resetPreview() {
    _generation++;
    if (mounted) setState(() { _preview = null; _error = null; });
  }

  Future<void> _check() async {
    if (_loading) return;
    final target = _userId.text.trim();
    final productId = _productId.text.trim();
    if (!RegExp(r'^[A-Za-z0-9_٠-٩۰-۹-]{1,128}$').hasMatch(target) ||
        !RegExp(r'^[1-9][0-9]{5,8}$').hasMatch(productId)) {
      setState(() => _error = 'أدخل رقم المستخدم ورقم المنتج الصحيحين.');
      return;
    }
    final generation = ++_generation;
    setState(() { _error = null; _preview = null; _loading = true; });
    try {
      final user = controlAuth.currentUser;
      if (user == null) throw StateError('unauthorized');
      final token = await user.getIdToken();
      if (token == null || token.isEmpty) throw StateError('unauthorized');
      final response = await http.post(
        shadowApiEndpoint('manage-store-grant-preview'),
        headers: {
          'authorization': 'Bearer $token',
          'content-type': 'application/json',
        },
        body: jsonEncode({
          'action': 'preview',
          'targetId': target,
          'productId': productId,
        }),
      ).timeout(const Duration(seconds: 25));
      final decoded = jsonDecode(response.body);
      if (decoded is! Map || response.statusCode != 200 ||
          decoded['ok'] != true || decoded['searchedId'] != target ||
          decoded['grantEnabled'] != false || decoded['canGrant'] != false ||
          decoded['note'] != 'grant_preview_only' ||
          decoded['product'] is! Map ||
          (decoded['product'] as Map)['id'] != productId ||
          decoded['alreadyHasProduct'] is! bool ||
          decoded['exclusiveRequirementsUnverified'] is! bool) {
        final code = decoded is Map ? decoded['code']?.toString() ?? '' : '';
        throw StateError(code.isEmpty ? 'invalid_grant_preview' : code);
      }
      if (!mounted || generation != _generation ||
          _userId.text.trim() != target || _productId.text.trim() != productId) {
        return;
      }
      setState(() => _preview = Map<String, dynamic>.from(decoded));
    } catch (error) {
      if (!mounted || generation != _generation) return;
      final code = error.toString();
      setState(() => _error = code.contains('recent_auth_required')
          ? 'يلزم تسجيل دخول حديث قبل معاينة المنح.'
          : code.contains('forbidden')
              ? 'لا تملك صلاحية معاينة منح المنتجات.'
              : code.contains('not_found') || code.contains('target_not_active')
                  ? 'المستخدم غير موجود أو حسابه غير نشط.'
                  : code.contains('store_asset_not_published')
                      ? 'صورة هذا المنتج لم تُنشر في الاستوديو بعد.'
                      : code.contains('store_product_unavailable')
                          ? 'المنتج غير ظاهر حالياً أو لم يحن موعده.'
                          : 'تعذّرت المعاينة. راجع الأرقام والاتصال.');
    } finally {
      if (mounted && generation == _generation) {
        setState(() => _loading = false);
      }
    }
  }

  Widget _previewCard(Map<String, dynamic> info) {
    final product = Map<String, dynamic>.from(info['product'] as Map);
    final alreadyOwned = info['alreadyHasProduct'] == true;
    final exclusive = info['exclusiveRequirementsUnverified'] == true;
    final days = product['durationDays'] as int? ?? 0;
    return Card(child: Padding(
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('معاينة الهدية الإدارية',
              style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          Text('المستخدم: ${info['searchedId']}'),
          Text('المنتج: ${product['nameAr']} • رقم ${product['id']}'),
          Text('الصلاحية: ${days == 0 ? 'دائم' : '$days أيام'}'),
          if (alreadyOwned)
            const Text('هذا المنتج مسجل بالفعل ضمن مقتنيات المستخدم.'),
          if (exclusive)
            const Text('هذا منتج حصري. يلزم فحص مستوى VIP أو الثروة '
                'من النظام قبل السماح بمنحه مستقبلاً.'),
          const SizedBox(height: 10),
          const Text('المعاينة لا ترسل المنتج. المنح الفعلي غير مفعّل '
              'ولا يمكن تأكيده من هذه الصفحة.'),
        ],
      ),
    ));
  }

  @override
  Widget build(BuildContext context) {
    final available = widget.catalogItems
        .where((item) => item['enabled'] == true).toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Card(child: ListTile(
          leading: Icon(Icons.lock_outline),
          title: Text('تجهيز منح منتج — معاينة فقط'),
          subtitle: Text('تحقق من المستخدم والمنتج والصورة ووجود مقتنى سابق. '
              'لا يوجد إرسال أو إضافة مقتنيات أو خصم كوينز حالياً.'),
        )),
        const SizedBox(height: 8),
        TextField(
          controller: _userId,
          enabled: !_loading,
          textDirection: TextDirection.ltr,
          onChanged: (_) => _resetPreview(),
          decoration: const InputDecoration(
            border: OutlineInputBorder(),
            labelText: 'معرّف المستخدم (ID)',
            hintText: 'رقم المستخدم الظاهر بالتطبيق أو UID',
          ),
        ),
        const SizedBox(height: 10),
        if (available.isNotEmpty) ...[
          DropdownButtonFormField<String>(
            isExpanded: true,
            decoration: const InputDecoration(
              labelText: 'اختيار من منتجات المتجر',
              border: OutlineInputBorder(),
            ),
            items: available.map((item) => DropdownMenuItem<String>(
              value: item['id'].toString(),
              child: Text('${item['nameAr']} — ${item['id']}',
                overflow: TextOverflow.ellipsis),
            )).toList(),
            onChanged: _loading ? null : (id) {
              if (id == null) return;
              _productId.text = id;
              _resetPreview();
            },
          ),
          const SizedBox(height: 10),
        ],
        TextField(
          controller: _productId,
          enabled: !_loading,
          keyboardType: TextInputType.number,
          textDirection: TextDirection.ltr,
          onChanged: (_) => _resetPreview(),
          decoration: const InputDecoration(
            border: OutlineInputBorder(),
            labelText: 'رقم المنتج',
            hintText: 'يمكنك أيضاً إدخاله مباشرة',
          ),
        ),
        const SizedBox(height: 10),
        Align(alignment: Alignment.centerRight, child: FilledButton.icon(
          onPressed: _loading ? null : _check,
          icon: const Icon(Icons.preview_outlined),
          label: const Text('معاينة بدون إرسال'),
        )),
        if (_loading) const LinearProgressIndicator(),
        if (_error != null) Padding(
          padding: const EdgeInsets.all(8),
          child: Text(_error!, style: const TextStyle(color: Colors.orangeAccent)),
        ),
        if (_preview != null) _previewCard(_preview!),
      ],
    );
  }
}
