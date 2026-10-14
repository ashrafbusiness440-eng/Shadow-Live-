import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;

import 'admin_account_identity_tile.dart';
import 'control_api_endpoints.dart';
import 'control_firebase.dart';
import 'general_reports_history_page.dart';

String generalReportErrorMessage(Object error) {
  final raw = error.toString().replaceFirst('Bad state: ', '');
  return switch (raw) {
    'forbidden' => 'ما عندك صلاحية لمراجعة البلاغ.',
    'recent_auth_required' => 'سجّل الدخول من جديد لتأكيد الإجراء.',
    'report_not_found' => 'هذا البلاغ غير موجود. حدّث القائمة.',
    'reporter_unavailable' => 'لا توجد بيانات كافية لعرض سجل هذا المبلّغ.',
    'invalid_target_uid' => 'معرّف الحساب غير صالح. حدّث البلاغ.',

    'invalid_report_transition' => 'حالة البلاغ تغيرت. حدّث القائمة وحاول مجدداً.',
    'invalid_reason' => 'اكتب سبباً واضحاً بين 3 و200 حرف، أو اترك سبب الرفض فارغًا.',
    'invalid_idempotency_key' => 'تعذّر تسجيل العملية. أعد المحاولة.',
    'idempotency_key_conflict' =>
        'تعذّر تأكيد العملية بسبب تكرار مختلف. حدّث البلاغ وحاول مجددًا.',
    'invalid_report_type' => 'اختر نوع بلاغ صحيح.',
    'invalid_report_scope' => 'تعذّر فتح هذا القسم من البلاغات. حدّث الصفحة.',
    'invalid_report_priority' => 'اختر أولوية صحيحة للبلاغ.',
    'invalid_cursor' => 'تعذّر عرض هذه الصفحة. ارجع للصفحة الأولى.',
    'invalid_account_action' => 'تحقق من الإجراء وسبب القرار.',
    'warning_target_unavailable' => 'لا يمكن توجيه تحذير لهذا الحساب حاليًا.',
    'unverified_account_action' => 'تعذر تأكيد تنفيذ العقوبة؛ حدّث البلاغ.',
    'action_requires_execution' => 'لا يمكن تسجيل إجراء قبل تنفيذه. اختر العقوبة المناسبة أولًا.',
    'owner_protected' => 'حساب المالك محمي ولا يمكن حظره أو تعليقه.',
    'not_found' => 'الحساب المبلّغ عليه غير موجود.',
    'invalid_suspend_duration' => 'مدة التعليق غير صحيحة.',
    'invalid_restriction_duration' => 'اختر مدة صحيحة لتقييد الرسائل مؤقتًا.',
    'restriction_not_active' => 'هذا التقييد غير نشط أو انتهت مدته. حدّث بيانات المستخدم.',
    'restriction_target_unavailable' =>
        'لا يمكن رفع التقييد عن هذا الحساب حاليًا.',
    _ => 'تعذّر تنفيذ الطلب. تحقق من الاتصال وأعد المحاولة.',
  };
}

class GeneralReportItem {
  const GeneralReportItem(this.data);
  final Map<String, dynamic> data;
  String field(String key) => (data[key] ?? '').toString().trim();
  String get id => field('reportId');
  String get type => field('type');
  String get status => field('status');
  String get priorityLabel => switch (field('priority')) {
    'urgent' => 'عاجل',
    'high' => 'مهم',
    _ => 'عادي',
  };
  String get reporterUid => field('reporterUid');
  String get targetUid => field('targetUid');
  String get actionLabel => switch (field('moderationAction')) {
    'account_suspended' => 'القرار: تعليق الحساب',
    'account_banned' => 'القرار: حظر الحساب',
    'warning' => 'القرار: تحذير الحساب',
    'private_messages_restricted' => 'القرار: تقييد الرسائل الخاصة',
    'room_chat_restricted' => 'القرار: تقييد الكتابة في الغرف',
    'room_entry_restricted' => 'القرار: منع دخول الغرف مؤقتًا',
    'room_mic_restricted' => 'القرار: كتم المايكروفون مؤقتًا',
    _ => '',
  };
  Map<String, dynamic> mapField(String key) {
    final value = data[key];
    return value is Map ? Map<String, dynamic>.from(value) : <String, dynamic>{};
  }

  String get title => switch (type) {
    'user_report' => 'بلاغ عن مستخدم في محادثة خاصة',
    'account_report' => 'بلاغ مباشر عن حساب',
    'room_message_report' => 'بلاغ عن رسالة داخل غرفة',
    'room_report' => 'بلاغ عن غرفة',
    _ => 'بلاغ مستخدم',
  };
  String get statusLabel => switch (status) {
    'open' || 'new' => 'جديد',
    'under_review' => 'قيد المراجعة',
    'rejected' => 'مرفوض',
    'actioned' => 'تم تسجيل إجراء',
    'closed' => 'مغلق',
    _ => 'حالة غير معروفة',
  };
  String get reasonLabel => switch (field('reason')) {
    'spam' => 'إزعاج أو رسائل متكررة',
    'harassment' || 'abuse' => 'مضايقة أو إساءة',
    'abusive_content' || 'inappropriate_content' => 'محتوى غير مناسب',
    'scam' => 'احتيال أو تضليل',
    'hate' => 'تحريض أو كراهية',
    'sexual' => 'محتوى غير لائق',
    'other' => 'سبب آخر',
    _ => field('reason').isEmpty ? 'لم يُذكر سبب' : field('reason'),
  };
}

class GeneralReportsService {
  static Future<Map<String, dynamic>> _post(
      String action, [Map<String, dynamic> payload = const {}]) async {
    final user = controlAuth.currentUser;
    if (user == null) throw StateError('not_signed_in');
    final token = await user.getIdToken();
    if (token == null || token.isEmpty) throw StateError('not_signed_in');
    final response = await http.post(
      shadowApiEndpoint('general-reports'),
      headers: <String, String>{
        'authorization': 'Bearer ' + token,
        'content-type': 'application/json',
      },
      body: jsonEncode(<String, dynamic>{'action': action, ...payload}),
    );
    Map<String, dynamic> result = {};
    try {
      final parsed = jsonDecode(response.body);
      if (parsed is Map) result = Map<String, dynamic>.from(parsed);
    } catch (_) {}
    if (response.statusCode != 200 || result['ok'] != true) {
      throw StateError((result['code'] ?? 'request_failed').toString());
    }
    return result;
  }

  static Future<void> liftRestriction({
    required String targetUid,
    required String accountAction,
    required String reason,
  }) async {
    final user = controlAuth.currentUser;
    if (user == null) throw StateError('not_signed_in');
    final token = await user.getIdToken();
    if (token == null || token.isEmpty) throw StateError('not_signed_in');
    final response = await http.post(
      shadowApiEndpoint('manage-user-account'),
      headers: <String, String>{
        'authorization': 'Bearer $token',
        'content-type': 'application/json',
      },
      body: jsonEncode(<String, dynamic>{
        'targetUid': targetUid,
        'accountAction': accountAction,
        'reason': reason,
        'idempotencyKey': 'gr_lift_${DateTime.now().microsecondsSinceEpoch}',
      }),
    );
    Map<String, dynamic> result = {};
    try {
      final parsed = jsonDecode(response.body);
      if (parsed is Map) result = Map<String, dynamic>.from(parsed);
    } catch (_) {}
    if (response.statusCode != 200 || result['ok'] != true) {
      throw StateError((result['code'] ?? 'request_failed').toString());
    }
  }

  static Future<Map<String, dynamic>> load({String? reportId, String? scope}) =>
      reportId == null || reportId.isEmpty
          ? _post('listReports', <String, dynamic>{
              'limit': 25,
              if (scope != null) 'scope': scope,
            })
          : _post('getReport', <String, dynamic>{'reportId': reportId});

  static Future<Map<String, dynamic>> reporterContext(String reportId) =>
      _post('getReporterContext', <String, dynamic>{'reportId': reportId});

  // Actions already committed on the server, not accusations or a live feed.
  static Future<Map<String, dynamic>> accountHistory(
    String targetUid, {String? cursor}
  ) => _post('getAccountActionHistory', <String, dynamic>{
    'targetUid': targetUid,
    if (cursor != null && cursor.isNotEmpty) 'cursor': cursor,
  });

  static Future<Map<String, dynamic>> history({
    required String type, String? cursor,
  }) => _post('listHistory', <String, dynamic>{
    'type': type,
    if (cursor != null && cursor.isNotEmpty) 'cursor': cursor,
  });

  static Future<void> applyAccountAction(
    String reportId, String action, String reason, int durationMinutes,
  ) async {
    await _post('applyAccountAction', <String, dynamic>{
      'reportId': reportId,
      'accountAction': action,
      'reason': reason,
      if (action == 'suspend' || action == 'restrictPrivateMessages' ||
          action == 'restrictRoomChat' ||
          action == 'restrictRoomEntry' || action == 'restrictRoomMic')
        'durationMinutes': durationMinutes,
      'idempotencyKey': 'gr_action_${DateTime.now().microsecondsSinceEpoch}',
    });
  }

  static Future<void> setPriority(
    String reportId, String priority, String reason,
  ) async {
    await _post('setReportPriority', <String, dynamic>{
      'reportId': reportId,
      'priority': priority,
      'reason': reason,
      'idempotencyKey':
          'gr_priority_${DateTime.now().microsecondsSinceEpoch}',
    });
  }

  static Future<void> review(String reportId, String status, String reason) async {
    // Never append a potentially long report ID to the idempotency key.
    final key = 'grctl_' + DateTime.now().microsecondsSinceEpoch.toString();
    await _post('reviewReport', <String, dynamic>{
      'reportId': reportId,
      'status': status,
      'reason': reason,
      'idempotencyKey': key,
    });
  }
}

class GeneralReportsControlPage extends StatefulWidget {
  const GeneralReportsControlPage({
    super.key, this.initialReportId, this.scope, this.embedded = false,
  });
  final String? initialReportId;
  final String? scope;
  final bool embedded;
  @override
  State<GeneralReportsControlPage> createState() =>
      _GeneralReportsControlPageState();
}

class _GeneralReportsControlPageState extends State<GeneralReportsControlPage> {
  bool _loading = false;
  bool _canReview = false;
  bool _canWarn = false;
  bool _canSuspend = false;
  bool _canBan = false;
  bool _canRestrictPrivateMessages = false;
  bool _canRestrictRoomChat = false;
  bool _canRestrictRoomEntry = false;
  bool _canRestrictRoomMic = false;
  bool _capped = false;
  String? _error;
  List<GeneralReportItem> _items = [];
  final Set<String> _busy = {};

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (_loading) return;
    setState(() { _loading = true; _error = null; });
    try {
      final result = await GeneralReportsService.load(
        reportId: widget.initialReportId,
        scope: widget.scope,
      );
      if (!mounted) return;
      final rawList = result['items'];
      final items = rawList is List
          ? rawList.whereType<Map>().map((row) => GeneralReportItem(
              Map<String, dynamic>.from(row))).toList()
          : result['item'] is Map
              ? [GeneralReportItem(Map<String, dynamic>.from(result['item'] as Map))]
              : <GeneralReportItem>[];
      setState(() {
        _items = items;
        _canReview = result['canReview'] == true;
        _canWarn = result['canWarn'] == true;
        _canSuspend = result['canSuspend'] == true;
        _canBan = result['canBan'] == true;
        _canRestrictPrivateMessages = result['canRestrictPrivateMessages'] == true;
        _canRestrictRoomChat = result['canRestrictRoomChat'] == true;
        _canRestrictRoomEntry = result['canRestrictRoomEntry'] == true;
        _canRestrictRoomMic = result['canRestrictRoomMic'] == true;
        _capped = result['capped'] == true;
      });
    } catch (error) {
      if (mounted) setState(() => _error = generalReportErrorMessage(error));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _review(GeneralReportItem item, String nextStatus) async {
    if (_busy.contains(item.id)) return;
    final controller = TextEditingController();
    final label = switch (nextStatus) {
      'under_review' => 'وضع البلاغ قيد المراجعة',
      'rejected' => 'رفض البلاغ',
      'closed' => 'إغلاق البلاغ',
      _ => 'تحديث البلاغ',
    };
    final reason = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(label),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: controller,
              maxLength: 200,
              maxLines: 3,
              decoration: InputDecoration(
                labelText: nextStatus == 'rejected'
                    ? 'سبب الرفض — اختياري'
                    : 'سبب القرار',
                helperText: nextStatus == 'rejected'
                    ? 'إذا كتبت السبب، سيظهر لصاحب البلاغ في الإشعار.'
                    : 'سيصل إشعار لصاحب البلاغ بعد حفظ القرار.',
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
            onPressed: () {
              final value = controller.text.trim();
              if (nextStatus == 'rejected' && value.isEmpty ||
                  value.length >= 3) {
                Navigator.pop(dialogContext, value);
              }
            },
            child: const Text('تأكيد'),
          ),
        ],
      ),
    );
    controller.dispose();
    if (!mounted || reason == null) return;
    setState(() => _busy.add(item.id));
    try {
      await GeneralReportsService.review(item.id, nextStatus, reason);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text(
          'تم تحديث البلاغ وتسجيل إشعار لصاحب البلاغ.',
        )),
      );
      await _load();
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(generalReportErrorMessage(error))),
        );
      }
    } finally {
      if (mounted) setState(() => _busy.remove(item.id));
    }
  }

  Future<void> _showReporterContext(GeneralReportItem item) async {
    if (_busy.contains(item.id) || item.reporterUid.isEmpty) return;
    setState(() => _busy.add(item.id));
    try {
      final result = await GeneralReportsService.reporterContext(item.id);
      if (!mounted) return;
      final raw = result['counts'];
      final counts = raw is Map
          ? Map<String, dynamic>.from(raw)
          : <String, dynamic>{};
      int count(String key) => (counts[key] as num?)?.toInt() ?? 0;
      await showDialog<void>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: const Text('سياق بلاغات مقدّم البلاغ'),
          content: SizedBox(
            width: 420,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('تمت مراجعة عينة محدودة من ${result['sampled'] ?? 0} بلاغًا.'),
                const SizedBox(height: 12),
                Text('بلاغات مرفوضة: ${count('rejected')}'),
                Text('بلاغات اتُخذ بشأنها إجراء: ${count('actioned')}'),
                Text('بلاغات قيد المعالجة: ${count('pending')}'),
                Text('حالات أخرى أو مغلقة: ${count('other')}'),
                if (result['capped'] == true)
                  const Text('هذه عينة محدودة وليست إجمالي بلاغات الشخص.'),
                const SizedBox(height: 12),
                const Text(
                  'رفض بلاغ سابق لا يعني أنه بلاغ كيدي. هذه معلومات '
                  'للمراجعة البشرية فقط، ولا تُفرض أي عقوبة تلقائية.',
                ),
              ],
            ),
          ),
          actions: [
            FilledButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text('إغلاق'),
            ),
          ],
        ),
      );
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(generalReportErrorMessage(error))),
        );
      }
    } finally {
      if (mounted) setState(() => _busy.remove(item.id));
    }
  }


  String _accountActionName(String action) => switch (action) {
    'warn' => 'تحذير',
    'suspend' => 'تعليق الحساب',
    'ban' => 'حظر الحساب',
    'disable' => 'إيقاف الحساب',
    'enable' => 'إعادة تفعيل الحساب',
    'unban' => 'رفع الحظر',
    'restrictPrivateMessages' => 'تقييد الرسائل الخاصة',
    'restrictRoomChat' => 'تقييد الكتابة بالغرف',
    'restrictRoomEntry' => 'منع دخول الغرف',
    'restrictRoomMic' => 'كتم المايكروفون',
    'liftPrivateMessagesRestriction' => 'رفع تقييد الرسائل',
    'liftRoomChatRestriction' => 'رفع تقييد الشات بالغرف',
    'liftRoomEntryRestriction' => 'رفع منع دخول الغرف',
    'liftRoomMicRestriction' => 'رفع كتم المايكروفون',
    _ => 'إجراء إداري',
  };

  String _historyDate(dynamic timestamp) {
    final ms = (timestamp as num?)?.toInt() ?? 0;
    return ms <= 0 ? 'غير محدد'
        : DateTime.fromMillisecondsSinceEpoch(ms)
            .toLocal().toString().substring(0, 16);
  }

  Future<void> _showAccountHistory(GeneralReportItem item) async {
    if (_busy.contains(item.id) || item.targetUid.isEmpty) return;
    setState(() => _busy.add(item.id));
    try {
      Map<String, dynamic> page =
          await GeneralReportsService.accountHistory(item.targetUid);
      if (!mounted) return;
      final cursors = <String?>[null];
      var index = 0;
      var loadingPage = false;
      await showDialog<void>(
        context: context,
        builder: (dialogContext) => StatefulBuilder(
          builder: (context, update) {
            final records = (page['items'] as List? ?? const [])
                .whereType<Map>().map((entry) =>
                    Map<String, dynamic>.from(entry)).toList();
            Future<void> changePage(bool next) async {
              if (loadingPage) return;
              if (next && page['hasMore'] != true || !next && index == 0) {
                return;
              }
              final requested = next ? index + 1 : index - 1;
              final cursor = next
                  ? (page['nextCursor'] ?? '').toString()
                  : cursors[requested];
              if (next && (cursor == null || cursor.isEmpty)) return;
              update(() => loadingPage = true);
              try {
                final received = await GeneralReportsService.accountHistory(
                  item.targetUid, cursor: cursor,
                );
                if (!dialogContext.mounted) return;
                update(() {
                  page = received;
                  index = requested;
                  if (next && cursors.length <= index) cursors.add(cursor);
                  loadingPage = false;
                });
              } catch (error) {
                if (!dialogContext.mounted) return;
                update(() => loadingPage = false);
                ScaffoldMessenger.of(dialogContext).showSnackBar(
                  SnackBar(content: Text(generalReportErrorMessage(error))),
                );
              }
            }
            return AlertDialog(
              title: const Text('سجل إجراءات الحساب'),
              content: SizedBox(
                width: 530,
                height: 450,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const Text(
                      'الإجراءات المنفّذة من الإدارة فقط. البلاغ بحد ذاته ليس '
                      'مخالفة مثبتة، ولا يُحتسب في سجل المخالفات.',
                    ),
                    const SizedBox(height: 8),
                    if (loadingPage) const LinearProgressIndicator(),
                    Expanded(
                      child: records.isEmpty
                          ? const Center(child: Text('لا توجد إجراءات بهذه الصفحة.'))
                          : ListView.separated(
                              itemCount: records.length,
                              separatorBuilder: (_, __) => const Divider(height: 12),
                              itemBuilder: (context, i) {
                                final record = records[i];
                                final confirmed = record['caseVerified'] == true;
                                final reason = (record['reason'] ?? '').toString();
                                final linked = (record['reportId'] ?? '').toString();
                                final expiration = (record['expiresAtMs'] as num?)
                                    ?.toInt() ?? 0;
                                return ListTile(
                                  contentPadding: EdgeInsets.zero,
                                  title: Text(_accountActionName(
                                    (record['action'] ?? '').toString(),
                                  )),
                                  subtitle: Text(
                                    (confirmed
                                        ? 'مخالفة ثبتت بعد مراجعة البلاغ'
                                        : 'إجراء إداري دون إثبات مرتبط ببلاغ') +
                                    '\nالسبب: ' + (reason.isEmpty
                                        ? 'غير مدوّن' : reason) +
                                    '\nالمسؤول: ${record['actorUid'] ?? '—'}' +
                                    '\nالتاريخ: ' +
                                        _historyDate(record['createdAtMs']) +
                                    (expiration > 0 ? '\nانتهاء المدة: ' +
                                        _historyDate(expiration) +
                                        (record['expired'] == true
                                            ? ' (انتهت)' : '') : '') +
                                    (linked.isNotEmpty
                                        ? '\nرقم البلاغ المرتبط: ' + linked : '') +
                                    (record['liftedRestriction'] != null &&
                                        record['liftedRestriction'].toString().isNotEmpty
                                        ? '\nتم رفع التقييد بتاريخ: ' +
                                          _historyDate(record['restrictionLiftedAtMs'])
                                        : ''),
                                  ),
                                );
                              },
                            ),
                    ),
                    Wrap(
                      alignment: WrapAlignment.spaceBetween,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      spacing: 8,
                      children: [
                        Text('صفحة ${index + 1} — حتى 20 إجراء'),
                        TextButton(
                          onPressed: loadingPage || index == 0
                              ? null : () => changePage(false),
                          child: const Text('السابق'),
                        ),
                        TextButton(
                          onPressed: loadingPage || page['hasMore'] != true
                              ? null : () => changePage(true),
                          child: const Text('التالي'),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              actions: [
                FilledButton(
                  onPressed: () => Navigator.pop(dialogContext),
                  child: const Text('إغلاق'),
                ),
              ],
            );
          },
        ),
      );
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(generalReportErrorMessage(error))),
        );
      }
    } finally {
      if (mounted) setState(() => _busy.remove(item.id));
    }
  }

  Future<void> _changePriority(GeneralReportItem item) async {
    if (!_canReview || _busy.contains(item.id)) return;
    final reason = TextEditingController();
    var priority = item.field('priority');
    if (!const ['urgent', 'high', 'normal'].contains(priority)) {
      priority = 'normal';
    }
    final selected = await showDialog<Map<String, String>>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, update) => AlertDialog(
          title: const Text('تعديل أولوية البلاغ'),
          content: SizedBox(
            width: 380,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text('يغيّر ترتيب المراجعة فقط، ولا يفرض عقوبة على المستخدم.'),
                DropdownButtonFormField<String>(
                  initialValue: priority,
                  decoration: const InputDecoration(labelText: 'الأولوية'),
                  items: const [
                    DropdownMenuItem(value: 'urgent', child: Text('عاجل')),
                    DropdownMenuItem(value: 'high', child: Text('مهم')),
                    DropdownMenuItem(value: 'normal', child: Text('عادي')),
                  ],
                  onChanged: (value) {
                    if (value != null) update(() => priority = value);
                  },
                ),
                TextField(
                  controller: reason,
                  maxLength: 200,
                  maxLines: 2,
                  decoration: const InputDecoration(
                    labelText: 'سبب تغيير الأولوية — مطلوب',
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text('إلغاء'),
            ),
            FilledButton(
              onPressed: () {
                if (reason.text.trim().length >= 3) {
                  Navigator.pop(dialogContext, <String, String>{
                    'priority': priority, 'reason': reason.text.trim(),
                  });
                }
              },
              child: const Text('حفظ الأولوية'),
            ),
          ],
        ),
      ),
    );
    reason.dispose();
    if (!mounted || selected == null) return;
    setState(() => _busy.add(item.id));
    try {
      await GeneralReportsService.setPriority(
        item.id, selected['priority']!, selected['reason']!,
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تم تحديث أولوية المراجعة وتوثيق السبب.')),
      );
      await _load();
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(generalReportErrorMessage(error))),
        );
      }
    } finally {
      if (mounted) setState(() => _busy.remove(item.id));
    }
  }

  Future<void> _takeAccountAction(
    GeneralReportItem item, String action,
  ) async {
    if (_busy.contains(item.id) || item.targetUid.isEmpty ||
        item.status != 'under_review') return;
    if (action == 'warn' && !_canWarn ||
        action == 'suspend' && !_canSuspend ||
        action == 'ban' && !_canBan ||
        action == 'restrictPrivateMessages' && !_canRestrictPrivateMessages ||
        action == 'restrictRoomChat' && !_canRestrictRoomChat ||
        action == 'restrictRoomEntry' && !_canRestrictRoomEntry ||
        action == 'restrictRoomMic' && !_canRestrictRoomMic) {
      return;
    }
    final reason = TextEditingController();
    var minutes = 1440;
    final confirmed = await showDialog<String>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, update) => AlertDialog(
          title: Text(action == 'warn' ? 'تحذير الحساب المبلّغ عليه'
              : action == 'suspend'
                ? 'تعليق الحساب المبلّغ عليه'
                : action == 'restrictPrivateMessages'
                  ? 'تقييد الرسائل الخاصة مؤقتًا'
                  : action == 'restrictRoomChat'
                    ? 'تقييد الكتابة في الغرف مؤقتًا'
                    : action == 'restrictRoomEntry'
                      ? 'منع دخول الغرف مؤقتًا'
                      : action == 'restrictRoomMic'
                        ? 'كتم المايكروفون في الغرف مؤقتًا'
                        : 'حظر الحساب المبلّغ عليه'),
          content: SizedBox(
            width: 400,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(action == 'warn'
                    ? 'سيصل تحذير واضح وسببه إلى الحساب، دون إيقافه أو قطع جلسته. '
                      'وسيصل لصاحب البلاغ إشعار بالقرار فقط بعد تسجيله بنجاح.'
                    : 'سيتم تنفيذ العقوبة فعلًا، ولن يصلك تأكيد حتى ينجح الخادم. '
                      'عندها سيتلقى صاحب البلاغ إشعارًا بنتيجة المراجعة.'),
                if (action == 'suspend' || action == 'restrictPrivateMessages' ||
                    action == 'restrictRoomChat' ||
                    action == 'restrictRoomEntry' || action == 'restrictRoomMic')
                  DropdownButtonFormField<int>(
                    initialValue: minutes,
                    isExpanded: true,
                    decoration: InputDecoration(
                      labelText: action == 'restrictPrivateMessages'
                          ? 'مدة تقييد الرسائل الخاصة'
                          : action == 'restrictRoomChat'
                            ? 'مدة تقييد الكتابة في الغرف'
                            : action == 'restrictRoomEntry'
                              ? 'مدة منع دخول الغرف'
                              : action == 'restrictRoomMic'
                                ? 'مدة كتم المايكروفون'
                                : 'مدة التعليق',
                    ),
                    items: const [
                      DropdownMenuItem(value: 60, child: Text('ساعة')),
                      DropdownMenuItem(value: 1440, child: Text('يوم')),
                      DropdownMenuItem(value: 10080, child: Text('أسبوع')),
                      DropdownMenuItem(value: 43200, child: Text('30 يومًا')),
                    ],
                    onChanged: (value) {
                      if (value != null) update(() => minutes = value);
                    },
                  ),
                TextField(
                  controller: reason,
                  maxLength: 160,
                  maxLines: 3,
                  decoration: const InputDecoration(
                    labelText: 'سبب إجراء الحساب — مطلوب',
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text('إلغاء'),
            ),
            FilledButton(
              onPressed: () {
                if (reason.text.trim().length >= 3) {
                  Navigator.pop(dialogContext, reason.text.trim());
                }
              },
              child: const Text('تأكيد التنفيذ'),
            ),
          ],
        ),
      ),
    );
    reason.dispose();
    if (!mounted || confirmed == null) return;
    setState(() => _busy.add(item.id));
    try {
      await GeneralReportsService.applyAccountAction(
        item.id, action, confirmed, minutes);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text(
          'تم تنفيذ الإجراء وتسجيل إشعار لصاحب البلاغ.',
        )),
      );
      await _load();
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(generalReportErrorMessage(error))),
        );
      }
    } finally {
      if (mounted) setState(() => _busy.remove(item.id));
    }
  }

  Future<void> _liftRestriction(GeneralReportItem item) async {
    if (_busy.contains(item.id) || !_canSuspend || item.targetUid.isEmpty) {
      return;
    }
    final reason = TextEditingController();
    var action = 'liftPrivateMessagesRestriction';
    final selected = await showDialog<Map<String, String>>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, update) => AlertDialog(
          title: const Text('رفع تقييد عن المستخدم'),
          content: SizedBox(
            width: 420,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text('اختر تقييدًا واحدًا لرفعه. لن تتغير بقية القيود '
                    'أو قرار البلاغ، وسيصل إشعار إلى المستخدم بعد التنفيذ.'),
                DropdownButtonFormField<String>(
                  initialValue: action,
                  isExpanded: true,
                  decoration: const InputDecoration(labelText: 'التقييد المطلوب رفعه'),
                  items: const [
                    DropdownMenuItem(
                      value: 'liftPrivateMessagesRestriction',
                      child: Text('الرسائل الخاصة'),
                    ),
                    DropdownMenuItem(
                      value: 'liftRoomChatRestriction',
                      child: Text('الكتابة في الغرف'),
                    ),
                    DropdownMenuItem(
                      value: 'liftRoomEntryRestriction',
                      child: Text('دخول الغرف'),
                    ),
                    DropdownMenuItem(
                      value: 'liftRoomMicRestriction',
                      child: Text('المايكروفون في الغرف'),
                    ),
                  ],
                  onChanged: (value) {
                    if (value != null) update(() => action = value);
                  },
                ),
                TextField(
                  controller: reason,
                  maxLength: 160,
                  maxLines: 3,
                  decoration: const InputDecoration(
                    labelText: 'سبب رفع التقييد — مطلوب',
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text('إلغاء'),
            ),
            FilledButton(
              onPressed: () {
                if (reason.text.trim().length >= 3) {
                  Navigator.pop(dialogContext, <String, String>{
                    'action': action,
                    'reason': reason.text.trim(),
                  });
                }
              },
              child: const Text('تأكيد رفع التقييد'),
            ),
          ],
        ),
      ),
    );
    reason.dispose();
    if (!mounted || selected == null) return;
    setState(() => _busy.add(item.id));
    try {
      await GeneralReportsService.liftRestriction(
        targetUid: item.targetUid,
        accountAction: selected['action']!,
        reason: selected['reason']!,
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text(
          'تم رفع التقييد المحدد وإشعار المستخدم، دون تغيير بقية القيود.',
        )),
      );
      await _load();
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(generalReportErrorMessage(error))),
        );
      }
    } finally {
      if (mounted) setState(() => _busy.remove(item.id));
    }
  }

  Widget _identity(String label, String uid, Map<String, dynamic> profile) =>
      AdminAccountIdentityTile(
        roleLabel: label,
        identity: AdminAccountIdentity.fromProfile(uid, profile),
      );

  Widget _card(GeneralReportItem item) {
    final isNew = item.status == 'new' || item.status == 'open';
    final inReview = item.status == 'under_review';
    final evidence = item.mapField('evidence');
    final message = evidence['message'] is Map
        ? Map<String, dynamic>.from(evidence['message'] as Map)
        : <String, dynamic>{};
    final contextEntries = evidence['context'] is List
        ? (evidence['context'] as List).take(7).whereType<Map>()
            .map((m) => Map<String, dynamic>.from(m)).toList()
        : <Map<String, dynamic>>[];
    final details = item.field('details');
    final roomState = evidence['roomState'] is Map
        ? Map<String, dynamic>.from(evidence['roomState'] as Map)
        : <String, dynamic>{};
    final reportedSeats = roomState['occupiedSeats'] is List
        ? (roomState['occupiedSeats'] as List).take(22).whereType<Map>()
            .map((seat) => Map<String, dynamic>.from(seat)).toList()
        : <Map<String, dynamic>>[];
    final roomId = item.field('roomId');
    final conversationId = item.field('conversationId');

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      color: const Color(0xFF171123),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(children: [
              const Icon(Icons.flag_outlined, color: Color(0xFFFFD54A)),
              const SizedBox(width: 8),
              Expanded(child: Text(item.title,
                  style: const TextStyle(fontWeight: FontWeight.w900))),
              Chip(label: Text(item.statusLabel)),
            ]),
            const SizedBox(height: 8),
            if (item.data['createdAtMs'] is num &&
                (item.data['createdAtMs'] as num) > 0)
              Text(
                'تاريخ البلاغ: ' + DateTime.fromMillisecondsSinceEpoch(
                  (item.data['createdAtMs'] as num).toInt(),
                ).toLocal().toString().substring(0, 16),
                style: const TextStyle(color: Colors.white70, fontSize: 12),
              ),
            Text('السبب: ' + item.reasonLabel),
            Text('الأولوية: ' + item.priorityLabel +
                (item.field('priorityOverride').isNotEmpty
                    ? ' — تعديل إداري' : ' — ترتيب تلقائي')),
            if (item.field('priorityReason').isNotEmpty)
              Text('سبب تعديل الأولوية: ' + item.field('priorityReason')),
            if (details.isNotEmpty) Text('التفاصيل: ' + details),
            const SizedBox(height: 10),
            _identity('مقدّم البلاغ', item.reporterUid,
                item.mapField('reporterProfile')),
            if (item.reporterUid.isNotEmpty)
              Align(
                alignment: Alignment.centerRight,
                child: TextButton.icon(
                  onPressed: _busy.contains(item.id)
                      ? null : () => _showReporterContext(item),
                  icon: const Icon(Icons.manage_search_rounded),
                  label: const Text('سياق البلاغات السابقة'),
                ),
              ),
            const SizedBox(height: 8),
            _identity(
              item.type == 'room_report'
                  ? 'صاحب الغرفة المبلّغ عنها' : 'الحساب المبلّغ عليه',
              item.targetUid,
              item.mapField('targetProfile'),
            ),
            if (item.targetUid.isNotEmpty)
              Align(
                alignment: Alignment.centerRight,
                child: TextButton.icon(
                  onPressed: _busy.contains(item.id)
                      ? null : () => _showAccountHistory(item),
                  icon: const Icon(Icons.history_rounded),
                  label: const Text('سجل مخالفات وإجراءات الحساب'),
                ),
              ),
            if (roomState.isNotEmpty)
              ExpansionTile(
                tilePadding: EdgeInsets.zero,
                title: const Text('لقطة موثقة لحالة الغرفة وقت البلاغ'),
                subtitle: const Text(
                  'بيانات الغرفة والمايكات محفوظة من الخادم، وليست تسجيلًا صوتيًا.',
                ),
                children: [
                  ListTile(
                    dense: true,
                    title: Text('اسم الغرفة: ' +
                        (roomState['name'] ?? 'غير محدد').toString()),
                    subtitle: Text('نوع الغرفة: ' +
                        (roomState['type'] ?? 'غير محدد').toString()),
                  ),
                  ListTile(
                    dense: true,
                    title: Text('المايكات المشغولة: ${reportedSeats.length}'),
                    subtitle: Text('مالك الغرفة وقت البلاغ: ' +
                        (roomState['ownerUid'] ?? 'غير محدد').toString()),
                  ),
                  for (final seat in reportedSeats)
                    ListTile(
                      dense: true,
                      title: Text('مايك ${seat['seatIndex'] ?? '—'} — ' +
                          (seat['uid'] ?? '').toString()),
                      subtitle: Text(seat['muted'] == true
                          ? 'الميكروفون مكتوم' : 'الميكروفون مفتوح'),
                    ),
                ],
              ),
            if (roomId.isNotEmpty)
              ListTile(
                dense: true,
                title: const Text('الغرفة المرتبطة'),
                subtitle: Text(roomId, maxLines: 1,
                    overflow: TextOverflow.ellipsis),
              ),
            if (conversationId.isNotEmpty)
              ListTile(
                dense: true,
                title: const Text('المحادثة المرتبطة'),
                subtitle: Text(conversationId, maxLines: 1,
                    overflow: TextOverflow.ellipsis),
              ),
            if ((message['text'] ?? '').toString().isNotEmpty)
              SelectableText('الرسالة المبلّغ عنها: ' +
                  (message['text'] ?? '').toString()),
            if (contextEntries.isNotEmpty)
              ExpansionTile(
                tilePadding: EdgeInsets.zero,
                title: const Text('الدليل المحفوظ من سياق الرسالة'),
                children: [
                  for (final entry in contextEntries)
                    ListTile(
                      dense: true,
                      title: Text((entry['displayName'] ?? 'مستخدم').toString()),
                      subtitle: SelectableText((entry['text'] ?? '').toString()),
                    ),
                ],
              ),
            if (item.actionLabel.isNotEmpty) Text(item.actionLabel),
            if (item.field('reviewReason').isNotEmpty)
              Text('قرار سابق: ' + item.field('reviewReason')),
            Row(
              children: [
                Expanded(
                  child: Text(
                    'مرجع: ' + (item.id.length <= 18
                        ? item.id
                        : '…' + item.id.substring(item.id.length - 15)),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 11, color: Colors.white54),
                  ),
                ),
                IconButton(
                  tooltip: 'نسخ رقم البلاغ',
                  onPressed: () async {
                    await Clipboard.setData(ClipboardData(text: item.id));
                    if (mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('تم نسخ رقم البلاغ')),
                      );
                    }
                  },
                  icon: const Icon(Icons.copy_rounded),
                ),
              ],
            ),
            if (_canReview && (isNew || inReview))
              Align(
                alignment: Alignment.centerRight,
                child: OutlinedButton.icon(
                  onPressed: _busy.contains(item.id)
                      ? null : () => _changePriority(item),
                  icon: const Icon(Icons.low_priority_rounded),
                  label: const Text('تعديل الأولوية'),
                ),
              ),
            if (_canReview && (isNew || inReview || item.status == 'actioned'))
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  if (isNew)
                    OutlinedButton(
                      onPressed: _busy.contains(item.id)
                          ? null : () => _review(item, 'under_review'),
                      child: const Text('قيد المراجعة'),
                    ),
                  if (isNew || inReview)
                    OutlinedButton(
                      onPressed: _busy.contains(item.id)
                          ? null : () => _review(item, 'rejected'),
                      child: const Text('رفض البلاغ'),
                    ),
                  if (inReview && item.targetUid.isNotEmpty &&
                      _canWarn)
                    OutlinedButton.icon(
                      onPressed: _busy.contains(item.id)
                          ? null : () => _takeAccountAction(item, 'warn'),
                      icon: const Icon(Icons.warning_amber_rounded),
                      label: const Text('توجيه تحذير'),
                    ),
                  if (inReview && item.targetUid.isNotEmpty &&
                      _canRestrictPrivateMessages)
                    OutlinedButton.icon(
                      onPressed: _busy.contains(item.id)
                          ? null : () => _takeAccountAction(item, 'restrictPrivateMessages'),
                      icon: const Icon(Icons.mark_chat_unread_outlined),
                      label: const Text('تقييد الرسائل الخاصة'),
                    ),
                  if (inReview && item.targetUid.isNotEmpty &&
                      _canRestrictRoomChat)
                    OutlinedButton.icon(
                      onPressed: _busy.contains(item.id)
                          ? null : () => _takeAccountAction(item, 'restrictRoomChat'),
                      icon: const Icon(Icons.comments_disabled_outlined),
                      label: const Text('تقييد الكتابة في الغرف'),
                    ),
                  if (inReview && item.targetUid.isNotEmpty &&
                      _canRestrictRoomEntry)
                    OutlinedButton.icon(
                      onPressed: _busy.contains(item.id)
                          ? null : () => _takeAccountAction(item, 'restrictRoomEntry'),
                      icon: const Icon(Icons.no_meeting_room_outlined),
                      label: const Text('منع دخول الغرف مؤقتًا'),
                    ),
                  if (inReview && item.targetUid.isNotEmpty &&
                      _canRestrictRoomMic)
                    OutlinedButton.icon(
                      onPressed: _busy.contains(item.id)
                          ? null : () => _takeAccountAction(item, 'restrictRoomMic'),
                      icon: const Icon(Icons.mic_off_outlined),
                      label: const Text('كتم المايكروفون'),
                    ),
                  if (inReview && item.targetUid.isNotEmpty &&
                      _canSuspend)
                    FilledButton.icon(
                      onPressed: _busy.contains(item.id)
                          ? null : () => _takeAccountAction(item, 'suspend'),
                      icon: const Icon(Icons.pause_circle_outline),
                      label: const Text('تعليق الحساب'),
                    ),
                  if (inReview && item.targetUid.isNotEmpty &&
                      _canBan)
                    OutlinedButton.icon(
                      onPressed: _busy.contains(item.id)
                          ? null : () => _takeAccountAction(item, 'ban'),
                      icon: const Icon(Icons.block_rounded),
                      label: const Text('حظر الحساب'),
                    ),
                  if (item.status == 'actioned' && item.targetUid.isNotEmpty &&
                      _canSuspend)
                    OutlinedButton.icon(
                      onPressed: _busy.contains(item.id)
                          ? null : () => _liftRestriction(item),
                      icon: const Icon(Icons.lock_open_rounded),
                      label: const Text('رفع تقييد'),
                    ),
                  if (inReview || item.status == 'actioned')
                    OutlinedButton(
                      onPressed: _busy.contains(item.id)
                          ? null : () => _review(item, 'closed'),
                      child: const Text('إغلاق البلاغ'),
                    ),
                ],
              ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: widget.embedded ? null : AppBar(
      title: const Text('بلاغات المستخدمين والغرف'),
      actions: [
        if (widget.initialReportId == null)
          IconButton(
            tooltip: 'سجل البلاغات السابقة',
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => const GeneralReportsHistoryPage(),
              ),
            ),
            icon: const Icon(Icons.history_rounded),
          ),
        IconButton(
          tooltip: 'تحديث',
          onPressed: _loading ? null : _load,
          icon: const Icon(Icons.refresh_rounded),
        ),
      ],
    ),
    body: RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (!widget.embedded)
            const Text('بلاغات المحادثات والغرف',
                style: TextStyle(fontSize: 22, fontWeight: FontWeight.w900)),
          if (!widget.embedded && widget.initialReportId == null)
            Align(
              alignment: Alignment.centerRight,
              child: TextButton.icon(
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => const GeneralReportsHistoryPage(),
                  ),
                ),
                icon: const Icon(Icons.history_rounded),
                label: const Text('البلاغات السابقة والمغلقة'),
              ),
            ),
          const SizedBox(height: 6),
          const Text(
            'اضغط على بيانات الحساب لعرض الهوية العامة ونسخ ID. '
            'كل تغيير حالة ينفذه الخادم ويُسجل في سجل الإدارة.',
            style: TextStyle(color: Colors.white70),
          ),
          if (_capped)
            const Text(
              'تظهر أحدث البلاغات فقط؛ قد تحتاج البلاغات الأقدم مراجعة إضافية.',
              style: TextStyle(color: Colors.amber),
            ),
          if (_loading && _items.isEmpty)
            const Padding(
              padding: EdgeInsets.all(30),
              child: Center(child: CircularProgressIndicator()),
            ),
          if (_error != null)
            ListTile(
              title: const Text('تعذر تحميل البلاغات'),
              subtitle: Text(_error!),
              trailing: IconButton(onPressed: _load,
                  icon: const Icon(Icons.refresh_rounded)),
            ),
          if (!_loading && _error == null && _items.isEmpty)
            const Card(
              child: Padding(
                padding: EdgeInsets.all(30),
                child: Center(child: Text('لا توجد بلاغات قيد المراجعة.')),
              ),
            ),
          for (final item in _items) _card(item),
        ],
      ),
    ),
  );
}
