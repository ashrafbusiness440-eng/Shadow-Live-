import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import 'account_deletion_request_service.dart';

/// Opt-in account deletion request. It does not delete personal data locally,
/// bypass authentication, or silently erase wallets and legal audit records.
class AccountDeletionRequestScreen extends StatefulWidget {
  const AccountDeletionRequestScreen({super.key});

  @override
  State<AccountDeletionRequestScreen> createState() =>
      _AccountDeletionRequestScreenState();
}

class _AccountDeletionRequestScreenState
    extends State<AccountDeletionRequestScreen> {
  final _service = const AccountDeletionRequestService();
  late final String? _openedUid;
  AccountDeletionRequestState? _state;
  bool _loading = true;
  bool _busy = false;
  String? _message;

  bool get _sameAccount =>
      mounted &&
      _openedUid != null &&
      FirebaseAuth.instance.currentUser?.uid == _openedUid;

  @override
  void initState() {
    super.initState();
    _openedUid = FirebaseAuth.instance.currentUser?.uid;
    _refresh();
  }

  Future<void> _refresh() async {
    if (!_sameAccount || _busy) {
      if (mounted) setState(() => _loading = false);
      return;
    }
    setState(() {
      _loading = true;
      _message = null;
    });
    try {
      final state = await _service.send('status');
      if (!_sameAccount) return;
      setState(() => _state = state);
    } on AccountDeletionRequestException catch (error) {
      if (_sameAccount) setState(() => _message = error.userMessage);
    } catch (_) {
      if (_sameAccount) {
        setState(() => _message = 'تعذر تحميل حالة طلب الحذف.');
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _format(DateTime? date) {
    if (date == null) return 'غير محدد';
    final local = date.toLocal();
    String two(int value) => value.toString().padLeft(2, '0');
    return '${two(local.day)}/${two(local.month)}/${local.year} '
        '${two(local.hour)}:${two(local.minute)}';
  }

  Future<bool> _confirm(String title, String message,
      String action, {bool destructive = false}) async {
    if (!mounted) return false;
    return await showDialog<bool>(
          context: context,
          builder: (dialogContext) => AlertDialog(
            title: Text(title),
            content: Text(message),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(dialogContext, false),
                child: const Text('رجوع'),
              ),
              TextButton(
                onPressed: () => Navigator.pop(dialogContext, true),
                style: destructive
                    ? TextButton.styleFrom(foregroundColor: Colors.redAccent)
                    : null,
                child: Text(action),
              ),
            ],
          ),
        ) ??
        false;
  }

  Future<void> _change(String action) async {
    if (_busy || _loading || !_sameAccount) return;
    final requesting = action == 'request';
    final confirmed = await _confirm(
      requesting ? 'تأكيد طلب حذف الحساب' : 'إلغاء طلب الحذف',
      requesting
          ? 'سيتم تسجيل طلب حذف حسابك، مع مهلة 30 يومًا يمكن خلالها '
              'إلغاء الطلب. تنفيذ إزالة البيانات يحتاج إنهاء إجراءات '
              'الاحتفاظ القانوني والتصفية الآمنة. هل تريد المتابعة؟'
          : 'هل تريد إلغاء طلب حذف الحساب الحالي؟',
      requesting ? 'إرسال طلب الحذف' : 'إلغاء الطلب',
      destructive: requesting,
    );
    if (!confirmed || !_sameAccount) return;
    setState(() {
      _busy = true;
      _message = null;
    });
    try {
      final newState = await _service.send(action);
      if (!_sameAccount) return;
      setState(() {
        _state = newState;
        _message = requesting
            ? 'تم تسجيل طلب الحذف. يمكنك إلغاؤه قبل بدء المعالجة.'
            : 'تم إلغاء طلب الحذف.';
      });
    } on AccountDeletionRequestException catch (error) {
      if (_sameAccount) setState(() => _message = error.userMessage);
    } catch (_) {
      if (_sameAccount) {
        setState(() => _message = 'تعذر إرسال الطلب. جرّب لاحقًا.');
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final status = _state?.status ?? 'none';
    final pending = status == 'pending';
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: const Color(0xFF080916),
        appBar: AppBar(
          backgroundColor: const Color(0xFF1A1031),
          title: const Text('طلب حذف الحساب'),
          actions: [
            IconButton(
              tooltip: 'تحديث',
              onPressed: _loading || _busy ? null : _refresh,
              icon: const Icon(Icons.refresh),
            ),
          ],
        ),
        body: ListView(
          padding: const EdgeInsets.all(18),
          children: [
            const Icon(Icons.manage_accounts_outlined,
                size: 54, color: Color(0xFFFFD166)),
            const SizedBox(height: 16),
            const Text(
              'التحكم بحذف حسابك',
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.white, fontSize: 23,
                  fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 12),
            const Text(
              'يمكنك إرسال طلب حذف حساب Shadow Live من هنا. '
              'لحماية الحساب يُشترط تسجيل دخول حديث قبل إرسال الطلب أو إلغائه. '
              'توجد مهلة 30 يومًا للتراجع قبل أن يصبح الطلب مؤهلًا للمعالجة. '
              'لا تُزال السجلات المالية أو الأدلة المطلوب حفظها قانونيًا '
              'قبل مراجعة متطلبات الاحتفاظ.',
              style: TextStyle(color: Colors.white70, height: 1.65),
            ),
            const SizedBox(height: 20),
            if (_loading) const LinearProgressIndicator(),
            if (!_loading)
              Card(
                color: const Color(0xFF201430),
                child: Padding(
                  padding: const EdgeInsets.all(18),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(
                        pending
                            ? 'طلب الحذف مسجّل'
                            : status == 'cancelled'
                                ? 'طلب الحذف مُلغى'
                                : status == 'processing'
                                    ? 'الحذف قيد المعالجة'
                                    : status == 'completed'
                                        ? 'اكتملت معالجة الطلب'
                                        : 'لا يوجد طلب حذف نشط',
                        style: const TextStyle(
                            color: Color(0xFFFFD166), fontSize: 18,
                            fontWeight: FontWeight.bold),
                      ),
                      if (pending) ...[
                        const SizedBox(height: 12),
                        Text('تاريخ الطلب: ${_format(_state?.requestedAt)}',
                            style: const TextStyle(color: Colors.white70)),
                        Text('بعد انتهاء المهلة: ${_format(_state?.eligibleAt)}',
                            style: const TextStyle(color: Colors.white70)),
                        const SizedBox(height: 6),
                        const Text(
                          'الطلب في انتظار إتمام التصفية والتحقق من قواعد '
                          'الاحتفاظ بالبيانات؛ انتهاء المهلة ليس إثباتًا '
                          'لإتمام حذف الحساب.',
                          style: TextStyle(color: Colors.white70),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            if (_message != null) ...[
              const SizedBox(height: 14),
              Text(_message!, style: const TextStyle(color: Colors.amberAccent)),
            ],
            const SizedBox(height: 20),
            if (!_loading && !pending && status != 'processing' &&
                status != 'completed')
              FilledButton.icon(
                onPressed: _busy ? null : () => _change('request'),
                style: FilledButton.styleFrom(backgroundColor:
                    const Color(0xFF8B3040)),
                icon: const Icon(Icons.delete_outline),
                label: const Text('طلب حذف حسابي'),
              ),
            if (!_loading && pending && _state?.cancellationAvailable == true)
              OutlinedButton.icon(
                onPressed: _busy ? null : () => _change('cancel'),
                icon: const Icon(Icons.undo_rounded),
                label: const Text('إلغاء طلب الحذف'),
              ),
            const SizedBox(height: 15),
            const Text(
              'إذا ظهرت رسالة تطلب تسجيل دخول حديث، سجّل خروجك '
              'ثم ادخل إلى الحساب مرة أخرى بالطريقة المعتادة.',
              style: TextStyle(color: Colors.white54, fontSize: 13),
            ),
          ],
        ),
      ),
    );
  }
}
