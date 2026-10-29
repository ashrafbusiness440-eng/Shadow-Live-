import 'dart:convert';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import 'control_api_endpoints.dart';
import 'control_firebase.dart';

/// Only rendered when the Worker says Owner + independent revocation release
/// gate are both allowed. The Worker still verifies these on every request.
class StoreGrantRevokeAction extends StatefulWidget {
  const StoreGrantRevokeAction({
    super.key,
    required this.targetUid,
    required this.item,
    required this.onRevoked,
  });

  final String targetUid;
  final Map<String, dynamic> item;
  final Future<void> Function() onRevoked;

  @override
  State<StoreGrantRevokeAction> createState() =>
      _StoreGrantRevokeActionState();
}

class _StoreGrantRevokeActionState extends State<StoreGrantRevokeAction> {
  bool _sending = false;
  bool _dialogOpen = false;
  String? _pendingSignature;
  String? _pendingOperationId;

  String _newOperationId() {
    final random = Random.secure();
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-';
    return 'store_revoke_${List.generate(
      24, (_) => chars[random.nextInt(chars.length)],
    ).join()}';
  }

  @override
  void didUpdateWidget(covariant StoreGrantRevokeAction oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.targetUid != widget.targetUid ||
        oldWidget.item['productId'] != widget.item['productId']) {
      _pendingSignature = null;
      _pendingOperationId = null;
    }
  }

  Future<void> _confirmAndRevoke() async {
    if (_sending || _dialogOpen || widget.item['source'] != 'admin_grant' ||
        widget.item['lifecycleState'] == 'revoked') return;
    final productId = widget.item['productId']?.toString() ?? '';
    if (!RegExp(r'^[1-9][0-9]{5,8}$').hasMatch(productId)) return;
    final targetUid = widget.targetUid;
    final reasonInput = TextEditingController();
    _dialogOpen = true;
    String? reason;
    try {
      reason = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('سحب منحة المتجر'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('سيتم سحب منحة ${widget.item['nameAr']} من هذا المستخدم. '
                'لن يتم حذف المشتريات أو تغيير رصيد الكوينز.'),
            const SizedBox(height: 12),
            TextField(
              controller: reasonInput,
              minLines: 2, maxLines: 3, maxLength: 200,
              decoration: const InputDecoration(
                labelText: 'سبب السحب',
                hintText: 'السبب مطلوب لتوثيق العملية',
                border: OutlineInputBorder(),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('إلغاء'),
          ),
          FilledButton(
            onPressed: () =>
                Navigator.pop(dialogContext, reasonInput.text.trim()),
            child: const Text('تأكيد السحب'),
          ),
        ],
      ),
    );
    } finally {
      _dialogOpen = false;
      reasonInput.dispose();
    }
    if (!mounted || reason == null || _sending ||
        targetUid != widget.targetUid ||
        productId != widget.item['productId']?.toString()) return;
    if (reason.length < 5 || reason.length > 200) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('اكتب سبب السحب من 5 إلى 200 حرف.'),
      ));
      return;
    }
    final signature = '$targetUid|$productId|$reason';
    if (signature != _pendingSignature) {
      _pendingSignature = signature;
      _pendingOperationId = _newOperationId();
    }
    final operationId = _pendingOperationId!;
    setState(() => _sending = true);
    var confirmed = false;
    try {
      final user = controlAuth.currentUser;
      if (user == null) throw StateError('unauthorized');
      final token = await user.getIdToken();
      if (token == null || token.isEmpty) throw StateError('unauthorized');
      final response = await http.post(
        shadowApiEndpoint('manage-store-grant-revoke'),
        headers: {
          'authorization': 'Bearer $token',
          'content-type': 'application/json',
        },
        body: jsonEncode({
          'action': 'revoke',
          'confirmation': 'confirmed',
          'targetUid': targetUid,
          'productId': productId,
          'operationId': operationId,
          'reason': reason,
        }),
      ).timeout(const Duration(seconds: 25));
      final result = jsonDecode(response.body);
      if (result is! Map || response.statusCode != 200 ||
          result['ok'] != true || result['revoked'] != true ||
          result['operationId'] != operationId ||
          result['targetUid'] != targetUid ||
          result['productId'] != productId) {
        final code = result is Map ? result['code']?.toString() ?? '' : '';
        throw StateError(code.isEmpty ? 'revoke_unavailable' : code);
      }
      confirmed = true;
      _pendingOperationId = null;
      _pendingSignature = null;
      if (mounted) {
        final liveStatus = (result['liveRefresh'] ?? '').toString();
        final pendingLive = liveStatus == 'pending_refresh' ||
            liveStatus == 'unavailable';
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(pendingLive
              ? 'تم سحب المنحة. تحديث مؤثراتها داخل الغرفة لم يتأكد بعد؛ '
                  'سيُعاد التحقق عند إعادة الدخول.'
              : 'تم سحب المنحة وتسجيل العملية بنجاح.'),
        ));
      }
    } catch (error) {
      if (!mounted) return;
      final code = error.toString();
      final message = code.contains('store_grant_revocation_disabled')
          ? 'سحب المنح غير مفعّل حاليًا.'
          : code.contains('recent_auth_required')
              ? 'يلزم تسجيل دخول حديث قبل سحب المنحة.'
              : code.contains('forbidden')
                  ? 'سحب المنح متاح للمالك فقط.'
                  : code.contains('store_entitlement_not_revocable')
                      ? 'هذه المنحة غير قابلة للسحب أو سبق إلغاؤها.'
                      : 'لم نتأكد من نتيجة السحب. يمكنك إعادة المحاولة بنفس السبب.';
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(message)),
      );
    } finally {
      if (mounted) setState(() => _sending = false);
    }
    if (confirmed && mounted) await widget.onRevoked();
  }

  @override
  Widget build(BuildContext context) => TextButton.icon(
    onPressed: _sending ? null : _confirmAndRevoke,
    icon: _sending
        ? const SizedBox(width: 16,height: 16,
            child: CircularProgressIndicator(strokeWidth: 2))
        : const Icon(Icons.block_outlined),
    label: const Text('سحب المنحة'),
  );
}
