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
  Map<String, dynamic>? _inventory;
  Map<String, dynamic>? _closure;
  String? _error;
  String? _inventoryError;
  String? _closureError;
  bool _busy = false;
  bool _inventoryBusy = false;
  bool _closureBusy = false;

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

  Future<void> _inspectInventory() async {
    if (_busy || _inventoryBusy || _details == null) return;
    setState(() {
      _inventoryBusy = true;
      _inventoryError = null;
      _inventory = null;
    });
    try {
      final result = await widget.request(
        'accountDeletionInventory', widget.targetUid, widget.requestId, '',
      );
      if (!mounted) return;
      if (result['targetUid'] != widget.targetUid ||
          result['requestId'] != widget.requestId ||
          result['erasureAllowed'] != false ||
          result['erasureExecuted'] != false) {
        throw StateError('نتيجة جرد غير صالحة. لم تُنفّذ أي عملية حذف.');
      }
      setState(() => _inventory = result);
    } catch (error) {
      if (mounted) {
        setState(() => _inventoryError =
            'تعذر إكمال جرد البيانات: ${error.toString()}');
      }
    } finally {
      if (mounted) setState(() => _inventoryBusy = false);
    }
  }

  Future<void> _inspectClosure() async {
    if (_busy || _closureBusy || _details == null) return;
    setState(() {
      _closureBusy = true;
      _closureError = null;
      _closure = null;
    });
    try {
      final result = await widget.request(
        'accountDeletionClosureReadiness', widget.targetUid,
        widget.requestId, '',
      );
      if (!mounted) return;
      if (result['ok'] != true || result['erasureAllowed'] != false ||
          result['destructiveAllowed'] != false ||
          result['processingAdmitted'] != false ||
          result['completionVerified'] != false ||
          result['independentEvidenceVerified'] != false ||
          result['totalRequiredDomains'] != 6 ||
          result['domains'] is! List ||
          (result['domains'] as List).length != 6) {
        throw StateError('نتيجة مراجعة الاعتمادات غير صالحة.');
      }
      setState(() => _closure = result);
    } catch (error) {
      if (mounted) {
        setState(() => _closureError =
          'تعذر فحص جاهزية الإغلاق: ${error.toString()}');
      }
    } finally {
      if (mounted) setState(() => _closureBusy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final details = _details;
    final signals = details?['signals'] is Map
        ? Map<String, dynamic>.from(details!['signals'] as Map)
        : const <String, dynamic>{};
    final hold = details?['reviewHold'] == true;
    final erasureDomains = _inventory?['domains'] is Map
        ? Map<String, dynamic>.from(_inventory!['domains'] as Map)
        : const <String, dynamic>{};
    final domainTitles = <String, String>{
      'diaries': 'اليوميات المرتبطة بالحساب',
      'storage': 'الملفات المخزنة باسم المستخدم في R2',
      'rooms': 'الغرف المسجّلة بصفة المالك',
      'legacyRooms': 'ملكية غرف بالنظام القديم',
      'conversations': 'المحادثات المرتبطة بالمستخدم',
      'financialLedger': 'سجلات الحركات المالية',
      'googlePlayPurchases': 'مشتريات Google Play',
      'reportedByUser': 'البلاغات المقدّمة من المستخدم',
      'reportsOnUser': 'البلاغات المرتبطة بالمستخدم كطرف مُبلّغ عنه',
      'giftSender': 'هدايا الغرف التي أرسلها المستخدم',
      'giftRecipient': 'هدايا الغرف التي استلمها المستخدم',
      'ledgerCounterparty': 'ارتباط المستخدم بطرف مقابل في السجل المالي',
      'ledgerGroupCounterparty': 'سجلات مالية بهدايا جماعية مرتبطة بالمستخدم',
      'walletTransferSender': 'تحويلات المحفظة الصادرة من الحساب',
      'walletTransferRecipient': 'تحويلات المحفظة الواردة إلى الحساب',
      'legacyReporter': 'بلاغات قديمة مقدمة من الحساب (حسب UID)',
      'legacyReportedUser': 'بلاغات قديمة ضد الحساب (حسب UID)',
    };
    final closureTitles = <String, String>{
      'financial_settlement': 'تسوية المحفظة والهدايا والوكالات',
      'play_billing': 'مشتريات Google Play والاستردادات',
      'moderation_legal': 'البلاغات والأدلة والاعتراضات القانونية',
      'shared_assets': 'ملكية الغرف والوكالات والأصول المشتركة',
      'content_storage_inventory': 'جرد البيانات القديمة والصور والملفات',
      'retention_policy': 'سياسة الاحتفاظ ومددها وأسبابها',
    };
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
                        : Icons.help_outline,
                      color: signals[entry.key] == true
                          ? Colors.amber : Colors.grey),
                    title: Text(entry.value),
                    subtitle: Text(signals[entry.key] == true
                        ? 'يتطلب متابعة' : 'غير مؤكد من الفحص المختصر'),
                  )),
              const SizedBox(height: 14),
              const Text(
                'فحص ارتباطات الحساب — قراءة فقط. '
                'عدم ظهور مستند في استعلام محدود لا يعني أن كل بياناته حُذفت.',
              ),
              OutlinedButton.icon(
                onPressed: (_busy || _inventoryBusy)
                    ? null : _inspectInventory,
                icon: const Icon(Icons.fact_check_outlined),
                label: const Text('فحص البيانات المرتبطة (دون حذف)'),
              ),
              if (_inventoryBusy) const LinearProgressIndicator(),
              if (_inventoryError != null)
                Text(_inventoryError!,
                    style: const TextStyle(color: Colors.redAccent)),
              if (_inventory != null) ...[
                ...domainTitles.entries.map((entry) {
                  final state = erasureDomains[entry.key]?.toString() ?? '';
                  return ListTile(
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    leading: Icon(state == 'found'
                        ? Icons.warning_amber_rounded
                        : Icons.info_outline,
                        color: state == 'found' ? Colors.amber : Colors.grey),
                    title: Text(entry.value),
                    subtitle: Text(state == 'found'
                        ? 'تم العثور على ارتباط؛ يحتاج معالجة'
                        : state == 'not_seen'
                            ? 'لم يظهر ارتباط ضمن البحث المحدود — ليس إثبات حذف'
                            : 'لم يكتمل التحقق؛ لا يمكن اعتبار البيانات محذوفة'),
                  );
                }),
                const Text(
                  'فحص وجود سجل مالي أو بلاغ لا يكشف كل تفاصيله، '
                  'كما أن غياب النتيجة لا يؤكد خلو الحساب. ما زالت '
                  'الهدايا وأدلة البلاغات والتعليقات والرسائل والمرفقات '
                  'والبيانات القديمة تحتاج مراجعة مستقلة. '
                  'لا يوجد سماح بالحذف النهائي.',
                  style: TextStyle(color: Colors.amber),
                ),
              ],
              const SizedBox(height: 14),
              const Text(
                'اعتمادات إغلاق حذف الحساب — ستة مجالات مستقلة. '
                'مطابقة وثائق المراجعة لا تعني إكمال التسويات أو السماح بالحذف.',
                style: TextStyle(fontWeight: FontWeight.w600),
              ),
              OutlinedButton.icon(
                onPressed: (_busy || _closureBusy || _inventoryBusy)
                    ? null : _inspectClosure,
                icon: const Icon(Icons.fact_check_outlined),
                label: const Text('فحص حالة الاعتمادات الستة (دون حذف)'),
              ),
              if (_closureBusy) const LinearProgressIndicator(),
              if (_closureError != null)
                Text(_closureError!,
                    style: const TextStyle(color: Colors.redAccent)),
              if (_closure != null) ...[
                ...(_closure!['domains'] as List).map((raw) {
                  final domain = Map<String, dynamic>.from(raw as Map);
                  final key = domain['domain']?.toString() ?? '';
                  final valid = domain['certificateDocumentsValid'] == true;
                  return ListTile(
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    leading: const Icon(Icons.info_outline, color: Colors.amber),
                    title: Text(closureTitles[key] ?? 'اعتماد غير معروف'),
                    subtitle: Text(valid
                        ? 'وثائق الاعتماد متطابقة شكليًا — التحقق الفعلي مستقل'
                        : 'الاعتماد ناقص أو غير صالح — يتطلب مراجعة'),
                  );
                }),
                const Text(
                  'حتى لو ظهرت الوثائق الست كلها متطابقة، الحذف النهائي '
                  'موقوف حتى التحقق المالي والقانوني والتقني '
                  'والاختبارات العملية. لا توجد موافقة تلقائية.',
                  style: TextStyle(color: Colors.amber),
                ),
              ],
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
