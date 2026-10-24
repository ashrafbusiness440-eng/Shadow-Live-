import 'package:flutter/material.dart';

/// Reuses AdminInboxService and the owner-only /api/admin-inbox route.
/// No direct Firestore access, no account deletion, no background listeners.
typedef AccountDeletionReviewRequest = Future<Map<String, dynamic>> Function(
  String action,
  String targetUid,
  String requestId,
  String reason,
);

class AccountDeletionOwnerReviewPage extends StatefulWidget {
  const AccountDeletionOwnerReviewPage({
    required this.targetUid,
    required this.requestId,
    required this.request,
    super.key,
  });

  final String targetUid;
  final String requestId;
  final AccountDeletionReviewRequest request;

  @override
  State<AccountDeletionOwnerReviewPage> createState() =>
      _AccountDeletionOwnerReviewPageState();
}

class _AccountDeletionOwnerReviewPageState
    extends State<AccountDeletionOwnerReviewPage> {
  final _reason = TextEditingController();
  Map<String, dynamic>? _details;
  String? _error;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final data = await widget.request(
        'accountDeletionDetails', widget.targetUid, widget.requestId, '',
      );
      if (!mounted) return;
      if (data['requestId'] != widget.requestId ||
          data['targetUid'] != widget.targetUid ||
          data['status'] != 'review_ready') {
        throw StateError('الطلب تغيّر أو تم إلغاؤه. حدّث صندوق الإشعارات.');
      }
      setState(() => _details = data);
    } catch (error) {
      if (mounted) {
        setState(() => _error = 'تعذر تحميل المراجعة: ${error.toString()}');
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _changeHold(bool hold) async {
    if (_busy || _details == null) return;
    final reason = _reason.text.trim();
    if (hold && reason.length < 8) {
      setState(() => _error = 'اكتب سبب الإيقاف بوضوح (8 أحرف على الأقل).');
      return;
    }
    final confirm = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(hold ? 'إيقاف مراجعة الحذف' : 'رفع إيقاف المراجعة'),
        content: Text(hold
            ? 'سيُسجّل سبب إيقاف المراجعة لحفظ المستندات أو الحقوق. '
              'لن تُحذف بيانات الحساب، ويبقى حق المستخدم في إلغاء الطلب.'
            : 'رفع الإيقاف لا يحذف الحساب ولا يمنح إذن حذف تلقائي. '
              'تحتاج إجراءات التصفية إلى مراجعة منفصلة.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('تراجع'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: Text(hold ? 'إيقاف المراجعة' : 'رفع الإيقاف'),
          ),
        ],
      ),
    );
    if (confirm != true || !mounted) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    var saved = false;
    try {
      await widget.request(
        hold ? 'accountDeletionHold' : 'accountDeletionReleaseHold',
        widget.targetUid, widget.requestId, reason,
      );
      saved = true;
    } catch (error) {
      if (mounted) {
        setState(() => _error = 'تعذر تعديل المراجعة: ${error.toString()}');
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
    if (mounted && saved) await _load();
  }

  @override
  Widget build(BuildContext context) {
    final details = _details;
    final signals = details?['signals'] is Map
        ? Map<String, dynamic>.from(details!['signals'] as Map)
        : const <String, dynamic>{};
    final hold = details?['reviewHold'] == true;
    final checks = <String, String>{
      'ownerAccount': 'حساب أونر محمي',
      'adminAccount': 'حساب مسؤول',
      'legalHold': 'حجز أو احتفاظ قانوني',
      'balanceDetected': 'يوجد رصيد ظاهر يحتاج مراجعة',
      'balanceUnknown': 'تعذر التحقق من الرصيد',
      'agencyMembershipPresent': 'ارتباط بوكالة',
      'ledgersAndReportsNotVerified': 'السجل المالي والبلاغات غير مفحوصين',
      'roomOwnershipNotVerified': 'ملكية الغرف غير مفحوصة',
      'privateMessagesNotVerified': 'الرسائل الخاصة غير مفحوصة',
      'storageEvidenceNotVerified': 'ملفات R2 والأدلة غير مفحوصة',
    };

    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('مراجعة حذف الحساب'),
          actions: [
            IconButton(
              tooltip: 'تحديث',
              onPressed: _busy ? null : _load,
              icon: const Icon(Icons.refresh),
            ),
          ],
        ),
        body: ListView(
          padding: const EdgeInsets.all(18),
          children: [
            const Text(
              'هذه شاشة مراجعة للأونر فقط. لا تحتوي على زر حذف نهائي '
              'ولا تغيّر الرصيد أو الأدلة أو هوية Firebase.',
              style: TextStyle(fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 14),
            SelectableText('معرّف صاحب الطلب: ${widget.targetUid}'),
            const SizedBox(height: 10),
            if (_busy) const LinearProgressIndicator(),
            if (_error != null) ...[
              const SizedBox(height: 10),
              Text(_error!, style: const TextStyle(color: Colors.redAccent)),
            ],
            if (details != null) ...[
              const SizedBox(height: 14),
              Text(
                hold ? 'المراجعة موقوفة' : 'الطلب مستحق لمراجعة الاحتفاظ',
                style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
              ),
              if (hold) Text(
                'سبب الإيقاف: ${details['reviewHoldReason'] ?? ''}',
              ),
              const SizedBox(height: 8),
              const Text('إشارات أولية — لا تعادل فحصًا ماليًا أو قانونيًا مكتملًا:'),
              ...checks.entries.map((entry) => ListTile(
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    leading: Icon(signals[entry.key] == true
                        ? Icons.warning_amber_rounded
                        : Icons.check_circle_outline,
                      color: signals[entry.key] == true
                          ? Colors.amber : Colors.grey),
                    title: Text(entry.value),
                    subtitle: Text(signals[entry.key] == true
                        ? 'يتطلب متابعة' : 'غير ظاهر في البيانات المختصرة'),
                  )),
              const SizedBox(height: 14),
              TextField(
                controller: _reason,
                enabled: !_busy,
                maxLength: 250,
                decoration: const InputDecoration(
                  labelText: 'سبب الإيقاف أو رفعه',
                  hintText: 'مثال: توجد مستندات مالية قيد التسوية',
                  border: OutlineInputBorder(),
                ),
                maxLines: 2,
              ),
              const SizedBox(height: 8),
              if (!hold)
                FilledButton.icon(
                  onPressed: _busy ? null : () => _changeHold(true),
                  icon: const Icon(Icons.pause_circle_outline),
                  label: const Text('إيقاف مراجعة الحذف'),
                )
              else
                OutlinedButton.icon(
                  onPressed: _busy ? null : () => _changeHold(false),
                  icon: const Icon(Icons.play_circle_outline),
                  label: const Text('رفع الإيقاف بعد المراجعة'),
                ),
            ],
          ],
        ),
      ),
    );
  }
}
