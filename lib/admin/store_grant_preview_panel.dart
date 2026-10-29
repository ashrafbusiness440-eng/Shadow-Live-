import 'dart:convert';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import 'control_api_endpoints.dart';
import 'control_firebase.dart';

/// Grant preview with Owner-only confirmation when the server release gate opens.
class StoreGrantPreviewPanel extends StatefulWidget {
  const StoreGrantPreviewPanel({super.key, this.catalogItems = const []});

  final List<Map<String, dynamic>> catalogItems;

  @override
  State<StoreGrantPreviewPanel> createState() => _StoreGrantPreviewPanelState();
}

class _StoreGrantPreviewPanelState extends State<StoreGrantPreviewPanel> {
  final _userId = TextEditingController();
  final _productId = TextEditingController();
  final _reason = TextEditingController();
  bool _issuing = false;
  String? _pendingOperationId;
  bool _loading = false;
  String? _error;
  Map<String, dynamic>? _preview;
  int _generation = 0;

  @override
  void dispose() {
    _generation++;
    _userId.dispose();
    _productId.dispose();
    _reason.dispose();
    super.dispose();
  }

  void _resetPreview() {
    _generation++;
    _pendingOperationId = null;
    if (mounted) setState(() { _preview = null; _error = null; });
  }

  Future<void> _check() async {
    if (_loading || _issuing) return;
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
          decoded['grantEnabled'] is! bool || decoded['canGrant'] is! bool ||
          decoded['note'] != 'grant_preview_only' ||
          decoded['product'] is! Map ||
          (decoded['product'] as Map)['id'] != productId ||
          decoded['alreadyHasProduct'] is! bool ||
          decoded['vipRequirementMet'] is! bool ||
          decoded['wealthRequirementMet'] is! bool ||
          decoded['meetsExclusiveRequirements'] is! bool ||
          decoded['exclusiveRequirementsUnverified'] != false) {
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
                       : code.contains('invalid_target_level_data')
                          ? 'تعذّر التحقق من نقاط الثروة الحالية للمستخدم.'
                          : code.contains('store_product_unavailable')
                          ? 'المنتج غير ظاهر حالياً أو لم يحن موعده.'
                          : 'تعذّرت المعاينة. راجع الأرقام والاتصال.');
    } finally {
      if (mounted && generation == _generation) {
        setState(() => _loading = false);
      }
    }
  }

  String _newOperationId() {
    final random = Random.secure();
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-';
    return 'grant_${List.generate(24, (_) => chars[random.nextInt(chars.length)]).join()}';
  }

  Future<void> _issueGrant(Map<String, dynamic> info) async {
    if (_loading || _issuing || info['canGrant'] != true ||
        info['grantEnabled'] != true || !identical(_preview, info)) return;
    final product = Map<String, dynamic>.from(info['product'] as Map);
    final target = _userId.text.trim();
    final productId = _productId.text.trim();
    final reason = _reason.text.trim();
    if (reason.length < 5 || reason.length > 200) {
      setState(() => _error = 'اكتب سبب المنح من 5 إلى 200 حرف.');
      return;
    }
    if (info['searchedId'] != target || product['id'] != productId ||
        info['alreadyHasProduct'] == true ||
        info['meetsExclusiveRequirements'] != true) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('تأكيد منح المنتج'),
        content: Text('هل تريد منح ${product['nameAr']} للمستخدم $target؟ '
            'لن يتم خصم كوينز من أي حساب.\nسبب المنح: $reason'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false),
              child: const Text('إلغاء')),
          FilledButton(onPressed: () => Navigator.pop(context, true),
              child: const Text('تأكيد المنح')),
        ],
      ),
    );
    if (!mounted || confirmed != true || _preview != info ||
        _userId.text.trim() != target || _productId.text.trim() != productId ||
        _reason.text.trim() != reason) return;
    final operationId = _pendingOperationId ??= _newOperationId();
    setState(() { _issuing = true; _error = null; });
    try {
      final user = controlAuth.currentUser;
      if (user == null) throw StateError('unauthorized');
      final token = await user.getIdToken();
      if (token == null || token.isEmpty) throw StateError('unauthorized');
      final response = await http.post(
        shadowApiEndpoint('manage-store-grant-issue'),
        headers: {
          'authorization': 'Bearer $token',
          'content-type': 'application/json',
        },
        body: jsonEncode({
          'action': 'issue',
          'confirmation': 'confirmed',
          'targetId': target,
          'productId': productId,
          'reason': reason,
          'operationId': operationId,
        }),
      ).timeout(const Duration(seconds: 25));
      final decoded = jsonDecode(response.body);
      if (decoded is! Map || response.statusCode != 200 ||
          decoded['ok'] != true || decoded['operationId'] != operationId ||
          decoded['productId'] != productId) {
        final code = decoded is Map ? decoded['code']?.toString() ?? '' : '';
        throw StateError(code.isEmpty ? 'issue_unavailable' : code);
      }
      if (!mounted) return;
      setState(() {
        _preview = null;
        _pendingOperationId = null;
        _error = null;
        _reason.clear();
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تم منح المنتج وتسجيل العملية بنجاح.')),
      );
    } catch (error) {
      if (!mounted) return;
      final code = error.toString();
      setState(() => _error = code.contains('store_grants_disabled')
          ? 'منح المنتجات غير مفعّل حاليًا.'
          : code.contains('recent_auth_required')
              ? 'يلزم تسجيل دخول جديد قبل المنح.'
              : code.contains('store_item_already_owned')
                  ? 'المستخدم يمتلك المنتج بالفعل.'
                  : code.contains('emergency_locked')
                      ? 'العمليات متوقفة مؤقتًا لأسباب أمنية.'
                      : code.contains('forbidden')
                          ? 'هذه العملية متاحة للمالك فقط.'
                          : 'لم نتأكد من نتيجة المنح. أعد المحاولة دون تغيير البيانات.');
    } finally {
      if (mounted) setState(() => _issuing = false);
    }
  }

  Widget _previewCard(Map<String, dynamic> info) {
    final product = Map<String, dynamic>.from(info['product'] as Map);
    final alreadyOwned = info['alreadyHasProduct'] == true;
    final minVip = product['minVipLevel'] as int? ?? 0;
    final minWealth = product['minWealthLevel'] as int? ?? 0;
    final vipMet = info['vipRequirementMet'] == true;
    final wealthMet = info['wealthRequirementMet'] == true;
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
          if (minVip > 0)
            Text(vipMet
                ? 'شرط VIP المستوى $minVip: مستوفى'
                : 'شرط VIP المستوى $minVip: غير مستوفى'),
          if (minWealth > 0)
            Text(wealthMet
                ? 'شرط الثروة المستوى $minWealth: مستوفى'
                : 'شرط الثروة المستوى $minWealth: غير مستوفى'),
          if (!vipMet || !wealthMet)
            const Text('شروط المنتج الحصري غير مكتملة لهذا المستخدم.'),
          const SizedBox(height: 10),
          if (info['canGrant'] == true) ...[
            TextField(
              controller: _reason,
              enabled: !_issuing,
              minLines: 2,
              maxLines: 3,
              maxLength: 200,
              onChanged: (_) => _pendingOperationId = null,
              decoration: const InputDecoration(
                labelText: 'سبب المنح',
                hintText: 'اكتب سبب المنحة لتسجيله في السجل',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 8),
            FilledButton.icon(
              onPressed: _issuing ? null : () => _issueGrant(info),
              icon: const Icon(Icons.card_giftcard),
              label: const Text('منح المنتج بعد التأكيد'),
            ),
            if (_issuing) const LinearProgressIndicator(),
          ] else
            const Text('هذه معاينة فقط. منح المنتج غير متاح '
                'لهذا الحساب أو لم تُفعّل صلاحية الإصدار بعد.'),
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
          title: Text('منح منتج للمستخدم'),
          subtitle: Text('تحقق من المستخدم والمنتج وشروط الأهلية أولًا. '
              'لن يظهر تأكيد المنح إلا للمالك عند تفعيل الإصدار، '
              'والمنح لا يخصم كوينز.'),
        )),
        const SizedBox(height: 8),
        TextField(
          controller: _userId,
          enabled: !_loading && !_issuing,
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
            onChanged: _loading || _issuing ? null : (id) {
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
          onPressed: _loading || _issuing ? null : _check,
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
