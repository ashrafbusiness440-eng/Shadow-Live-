import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../agency/services/agency_membership_service.dart';
import '../../profile/screens/public_profile_screen.dart';
import '../services/notification_service.dart';

class NotificationsPage extends StatefulWidget {
  const NotificationsPage({super.key});

  @override
  State<NotificationsPage> createState() => _NotificationsPageState();
}

class _NotificationsPageState extends State<NotificationsPage> {
  final NotificationService _service = NotificationService();
  final AgencyMembershipService _membershipService = AgencyMembershipService();
  final List<AppNotification> _items = [];
  NotificationPage? _page;
  bool _loading = true;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  @override
  void dispose() {
    _membershipService.close();
    super.dispose();
  }

  Future<void> _refresh() async {
    await _reload();
  }

  Future<void> _reload() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final page = await _service.load();
      if (!mounted) return;
      setState(() {
        _items
          ..clear()
          ..addAll(page.items);
        _page = page;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error;
        _loading = false;
      });
    }
  }

  Future<void> _loadMore() async {
    final page = _page;
    if (_loading || page?.cursor == null || page?.hasMore != true) return;
    setState(() => _loading = true);
    try {
      final next = await _service.load(after: page!.cursor);
      if (!mounted) return;
      setState(() {
        _items.addAll(next.items);
        _items.sort((a, b) => (b.createdAt?.millisecondsSinceEpoch ?? 0)
            .compareTo(a.createdAt?.millisecondsSinceEpoch ?? 0));
        _page = next;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error;
        _loading = false;
      });
    }
  }

  Future<void> _open(AppNotification item) async {
    if (!item.read) {
      await _service.markRead(item.id);
      if (!mounted) return;
      final index = _items.indexWhere((entry) => entry.id == item.id);
      if (index >= 0) {
        setState(() {
          _items[index] = AppNotification(
            id: item.id,
            title: item.title,
            body: item.body,
            type: item.type,
            read: true,
            createdAt: item.createdAt,
            requestId: item.requestId,
            agencyId: item.agencyId,
            requestType: item.requestType,
            applicantUid: item.applicantUid,
            actionState: item.actionState,
            finalStatus: item.finalStatus,
            finalDecision: item.finalDecision,
            resolvedBy: item.resolvedBy,
            resolvedByName: item.resolvedByName,
            resolvedAt: item.resolvedAt,
          );
        });
      }
    }

    if (item.agencyReviewAction && (item.requestId?.isNotEmpty ?? false)) {
      await _openAgencyReview(item.requestId!);
      return;
    }

    if (item.type == 'agency_membership_invite' &&
        (item.requestId?.isNotEmpty ?? false)) {
      await _openAgencyInvitation(item.requestId!);
    }
  }

  Future<String?> _optionalRejectReason() async {
    final controller = TextEditingController();
    final reason = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('سبب الرفض — اختياري'),
        content: TextField(
          controller: controller,
          maxLength: 500,
          maxLines: 3,
          decoration: const InputDecoration(
            hintText: 'يمكن تركه فارغًا.',
            border: OutlineInputBorder(),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('إلغاء'),
          ),
          FilledButton(
            onPressed: () =>
                Navigator.pop(dialogContext, controller.text.trim()),
            child: const Text('متابعة'),
          ),
        ],
      ),
    );
    controller.dispose();
    return reason;
  }

  Future<void> _openAgencyReview(String requestId) async {
    try {
      final detail = await _membershipService.getReviewRequest(requestId);
      if (!mounted) return;
      final publicId = detail.userPublicId?.trim() ?? '';
      final image = detail.profileImageUrl?.trim() ?? '';

      final decision = await showModalBottomSheet<String>(
        context: context,
        isScrollControlled: true,
        backgroundColor: const Color(0xFF0D1220),
        showDragHandle: true,
        builder: (sheetContext) => Directionality(
          textDirection: TextDirection.rtl,
          child: SafeArea(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(18, 4, 18, 22),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      CircleAvatar(
                        radius: 30,
                        backgroundColor: const Color(0xFF31204F),
                        backgroundImage:
                            image.isEmpty ? null : NetworkImage(image),
                        child: image.isEmpty
                            ? const Icon(Icons.person_rounded)
                            : null,
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              detail.displayName ??
                                  (publicId.isEmpty
                                      ? 'Shadow Live'
                                      : publicId),
                              style: const TextStyle(
                                fontSize: 18,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                            if (publicId.isNotEmpty)
                              Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Text(
                                    'ID: ' + publicId,
                                    textDirection: TextDirection.ltr,
                                    style: const TextStyle(
                                      color: Colors.white60,
                                    ),
                                  ),
                                  IconButton(
                                    tooltip: 'نسخ ID',
                                    visualDensity: VisualDensity.compact,
                                    onPressed: () async {
                                      await Clipboard.setData(
                                        ClipboardData(text: publicId),
                                      );
                                      if (!sheetContext.mounted) return;
                                      ScaffoldMessenger.of(sheetContext)
                                          .showSnackBar(
                                        const SnackBar(
                                          content: Text('تم نسخ ID المستخدم.'),
                                        ),
                                      );
                                    },
                                    icon: const Icon(
                                      Icons.copy_rounded,
                                      size: 17,
                                    ),
                                  ),
                                ],
                              ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 14),
                  _ReviewInfoRow(
                    label: 'نوع الطلب',
                    value: detail.type == 'leave'
                        ? 'طلب مغادرة'
                        : 'طلب انضمام',
                  ),
                  _ReviewInfoRow(
                    label: 'الدور',
                    value: _reviewRoleLabel(detail.targetRole),
                  ),
                  _ReviewInfoRow(
                    label: 'الحساب',
                    value: _reviewAccountLabel(detail.accountStatus),
                  ),
                  _ReviewInfoRow(
                    label: 'حالة الطلب',
                    value: _requestStatusLabel(detail.status),
                  ),
                  _ReviewInfoRow(
                    label: 'وقت الطلب',
                    value: _reviewDateLabel(detail.createdAt),
                  ),
                  if (detail.conflictStatus != 'none')
                    _ReviewInfoRow(
                      label: 'ملاحظة',
                      value: _reviewConflictLabel(detail.conflictStatus),
                    ),
                  if ((detail.reason?.isNotEmpty ?? false))
                    _ReviewInfoRow(
                      label: 'السبب',
                      value: detail.reason!,
                    ),
                  const SizedBox(height: 12),
                  OutlinedButton.icon(
                    onPressed: detail.uid.isEmpty
                        ? null
                        : () => Navigator.of(sheetContext).push(
                              MaterialPageRoute<void>(
                                builder: (_) => PublicProfileScreen(
                                  userId: detail.uid,
                                ),
                              ),
                            ),
                    icon: const Icon(Icons.person_search_rounded),
                    label: const Text('فتح الملف الشخصي'),
                  ),
                  const SizedBox(height: 10),
                  if (detail.actionable)
                    Row(
                      children: [
                        Expanded(
                          child: OutlinedButton(
                            onPressed: () =>
                                Navigator.pop(sheetContext, 'reject'),
                            child: const Text('رفض'),
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: FilledButton(
                            onPressed: detail.canAccept
                                ? () => Navigator.pop(
                                      sheetContext,
                                      'accept',
                                    )
                                : null,
                            child: const Text('قبول'),
                          ),
                        ),
                      ],
                    )
                  else
                    FilledButton(
                      onPressed: () => Navigator.pop(sheetContext),
                      child: const Text('إغلاق'),
                    ),
                ],
              ),
            ),
          ),
        ),
      );

      if (decision == null || !detail.actionable) return;
      String? reason;
      if (decision == 'reject') {
        reason = await _optionalRejectReason();
        if (!mounted || reason == null) return;
      }
      final code = await _membershipService.respondReview(
        requestId: detail.requestId,
        requestType: detail.type,
        decision: decision,
        idempotencyKey: 'review_' +
            decision +
            '_' +
            DateTime.now().microsecondsSinceEpoch.toString(),
        reason: reason,
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            code == 'already_processed'
                ? 'تم حسم الطلب مسبقًا من مراجع آخر.'
                : decision == 'accept'
                    ? 'تم قبول الطلب.'
                    : 'تم رفض الطلب.',
          ),
        ),
      );
      await _reload();
    } catch (error) {
      if (!mounted) return;
      final code = error.toString().replaceFirst('Bad state: ', '');
      final message = switch (code) {
        'membership_request_not_found' => 'لم يعد الطلب متاحًا.',
        'forbidden' => 'لم تعد لديك صلاحية مراجعة هذا الطلب.',
        'cannot_review_own_request' => 'لا يمكن مراجعة طلبك الشخصي.',
        _ => 'تعذر فتح طلب الوكالة: ' + code,
      };
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(message)),
      );
    }
  }

  Future<void> _openAgencyInvitation(String requestId) async {
    try {
      final detail = await _membershipService.getMyRequest(requestId);
      if (!mounted) return;

      final decision = await showModalBottomSheet<String>(
        context: context,
        backgroundColor: const Color(0xFF0D1220),
        showDragHandle: true,
        builder: (sheetContext) {
          final agency = detail.agency;
          final logo = agency.logoUrl?.trim() ?? '';
          return Directionality(
            textDirection: TextDirection.rtl,
            child: SafeArea(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(18, 4, 18, 22),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Row(
                      children: [
                        CircleAvatar(
                          radius: 30,
                          backgroundColor: const Color(0xFF6E49D8),
                          backgroundImage:
                              logo.isEmpty ? null : NetworkImage(logo),
                          child: logo.isEmpty
                              ? const Icon(
                                  Icons.apartment_rounded,
                                  color: Colors.white,
                                )
                              : null,
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                agency.name,
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontWeight: FontWeight.w800,
                                  fontSize: 18,
                                ),
                              ),
                              const SizedBox(height: 4),
                              Text(
                                'ID: ${agency.publicId}',
                                textDirection: TextDirection.ltr,
                                style: const TextStyle(
                                  color: Colors.white60,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),
                    Text(
                      _countryLabel(agency.country),
                      style: const TextStyle(color: Colors.white70),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'الأعضاء: ${agency.memberCount}',
                      style: const TextStyle(color: Colors.white70),
                    ),
                    const SizedBox(height: 6),
                    const Text(
                      'الدور بعد القبول: مضيف',
                      style: TextStyle(color: Colors.white70),
                    ),
                    if (!detail.isPendingInvitation) ...[
                      const SizedBox(height: 14),
                      Text(
                        'حالة الدعوة: ${_requestStatusLabel(detail.status)}',
                        style: const TextStyle(
                          color: Colors.amberAccent,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                    const SizedBox(height: 18),
                    if (detail.isPendingInvitation)
                      Row(
                        children: [
                          Expanded(
                            child: OutlinedButton(
                              onPressed: () =>
                                  Navigator.pop(sheetContext, 'reject'),
                              child: const Text('رفض'),
                            ),
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: FilledButton(
                              onPressed: () =>
                                  Navigator.pop(sheetContext, 'accept'),
                              child: const Text('قبول'),
                            ),
                          ),
                        ],
                      )
                    else
                      FilledButton(
                        onPressed: () => Navigator.pop(sheetContext),
                        child: const Text('إغلاق'),
                      ),
                  ],
                ),
              ),
            ),
          );
        },
      );

      if (decision == null || !detail.isPendingInvitation) return;
      await _membershipService.respond(
        requestId: detail.requestId,
        decision: decision,
        idempotencyKey:
            'invite_${decision}_${DateTime.now().microsecondsSinceEpoch}',
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            decision == 'accept'
                ? 'تم قبول دعوة الوكالة وتفعيل عضويتك كمضيف.'
                : 'تم رفض دعوة الوكالة.',
          ),
        ),
      );
      await _reload();
    } catch (error) {
      if (!mounted) return;
      final code = error.toString().replaceFirst('Bad state: ', '');
      final message = switch (code) {
        'membership_request_not_pending' =>
          'تم حسم هذه الدعوة مسبقًا.',
        'user_already_in_agency' =>
          'تعذر القبول لأنك مرتبط بوكالة أخرى.',
        'membership_acceptance_conflict' =>
          'يوجد طلب وكالة آخر متعارض مع هذه الدعوة.',
        _ => 'تعذر فتح أو معالجة دعوة الوكالة حاليًا.',
      };
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(message)),
      );
    }
  }

  @override
  Widget build(BuildContext context) => Directionality(
        textDirection: TextDirection.rtl,
        child: Scaffold(
          backgroundColor: const Color(0xFF070B16),
          appBar: AppBar(
            backgroundColor: const Color(0xFF11182A),
            title: const Text('الإشعارات'),
          ),
          body: Builder(
            builder: (context) {
              if (_loading && _items.isEmpty) {
                return const Center(child: CircularProgressIndicator());
              }
              if (_error != null && _items.isEmpty) {
                return Center(
                  child: FilledButton.icon(
                    onPressed: _refresh,
                    icon: const Icon(Icons.refresh_rounded),
                    label: const Text('تعذر تحميل الإشعارات — إعادة المحاولة'),
                  ),
                );
              }
              if (_items.isEmpty) {
                return RefreshIndicator(
                  onRefresh: _refresh,
                  child: ListView(
                    children: const [
                      SizedBox(height: 180),
                      Icon(Icons.notifications_none_rounded,
                          size: 58, color: Colors.white38),
                      SizedBox(height: 12),
                      Center(child: Text('لا توجد إشعارات حالياً')),
                    ],
                  ),
                );
              }
              return RefreshIndicator(
                onRefresh: _refresh,
                child: ListView.separated(
                  padding: const EdgeInsets.all(14),
                  itemCount: _items.length + (_page?.hasMore == true ? 1 : 0),
                  separatorBuilder: (_, __) => const SizedBox(height: 9),
                  itemBuilder: (context, index) {
                    if (index == _items.length) {
                      return Center(
                        child: OutlinedButton.icon(
                          onPressed: _loading ? null : _loadMore,
                          icon: _loading
                              ? const SizedBox.square(
                                  dimension: 16,
                                  child: CircularProgressIndicator(strokeWidth: 2),
                                )
                              : const Icon(Icons.expand_more_rounded),
                          label: const Text('تحميل المزيد'),
                        ),
                      );
                    }
                    final item = _items[index];
                    return Card(
                      color: item.read
                          ? const Color(0xFF11182A)
                          : const Color(0xFF202344),
                      child: ListTile(
                        onTap: () => _open(item),
                        leading: Icon(
                          item.read
                              ? Icons.notifications_none_rounded
                              : Icons.notifications_active_rounded,
                          color: item.read
                              ? Colors.white54
                              : const Color(0xFFFFD54F),
                        ),
                        title: Text(item.title,
                            style:
                                const TextStyle(fontWeight: FontWeight.w700)),
                        subtitle: item.agencyReviewResolved
                            ? Text(
                                _resolvedNotificationText(item),
                              )
                            : item.body.isEmpty
                                ? null
                                : Text(item.body),
                        trailing: item.agencyReviewResolved
                            ? const Icon(
                                Icons.check_circle_outline_rounded,
                                color: Colors.greenAccent,
                              )
                            : item.read
                                ? null
                                : const Icon(
                                    Icons.circle,
                                    size: 9,
                                    color: Color(0xFFFFD54F),
                                  ),
                      ),
                    );
                  },
                ),
              );
            },
          ),
        ),
      );
}


String _resolvedNotificationText(AppNotification item) {
  final accepted =
      item.finalDecision == 'accept' || item.finalStatus == 'accepted';
  final reviewer = item.resolvedByName?.trim().isNotEmpty == true
      ? item.resolvedByName!.trim()
      : item.resolvedBy?.trim().isNotEmpty == true
          ? item.resolvedBy!.trim()
          : 'مراجع مخوّل';
  final resolvedAt = item.resolvedAt?.toLocal();
  final time = resolvedAt == null
      ? ''
      : ' • ${resolvedAt.year.toString().padLeft(4, '0')}/'
          '${resolvedAt.month.toString().padLeft(2, '0')}/'
          '${resolvedAt.day.toString().padLeft(2, '0')} '
          '${resolvedAt.hour.toString().padLeft(2, '0')}:'
          '${resolvedAt.minute.toString().padLeft(2, '0')}';
  return accepted
      ? 'تم قبول الطلب بواسطة $reviewer$time.'
      : 'تم رفض الطلب بواسطة $reviewer$time.';
}

class _ReviewInfoRow extends StatelessWidget {
  const _ReviewInfoRow({
    required this.label,
    required this.value,
  });

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              width: 92,
              child: Text(
                label,
                style: const TextStyle(color: Colors.white54),
              ),
            ),
            Expanded(
              child: Text(
                value,
                style: const TextStyle(fontWeight: FontWeight.w700),
              ),
            ),
          ],
        ),
      );
}

String _reviewRoleLabel(String role) {
  if (role == 'owner') return 'مالك الوكالة';
  if (role == 'senior_manager') return 'مدير أول';
  if (role == 'manager') return 'مدير';
  return 'مضيف';
}

String _reviewAccountLabel(String status) {
  if (status == 'active') return 'نشط';
  if (status == 'suspended') return 'موقوف';
  if (status == 'disabled') return 'معطّل';
  if (status == 'banned') return 'محظور';
  return status.isEmpty ? 'غير متاح' : status;
}

String _reviewConflictLabel(String status) {
  if (status == 'already_in_agency') return 'مرتبط بوكالة أخرى';
  if (status == 'reserved_other_request') return 'محجوز بطلب وكالة آخر';
  if (status == 'membership_changed') return 'تغيّرت العضوية منذ الطلب';
  if (status == 'account_inactive') return 'الحساب غير نشط';
  if (status == 'user_missing') return 'الحساب غير متاح';
  return status;
}

String _reviewDateLabel(DateTime? value) {
  if (value == null) return '—';
  final local = value.toLocal();
  String two(int n) => n.toString().padLeft(2, '0');
  return two(local.day) +
      '/' +
      two(local.month) +
      '/' +
      local.year.toString() +
      ' ' +
      two(local.hour) +
      ':' +
      two(local.minute);
}

String _countryLabel(String? country) {
  final value = country?.trim() ?? '';
  if (value.isEmpty) return 'الدولة: —';
  if (RegExp(r'^[A-Za-z]{2}$').hasMatch(value)) {
    final flag = String.fromCharCodes(
      value.toUpperCase().codeUnits.map((code) => 0x1F1E6 + code - 65),
    );
    return '$flag  $value';
  }
  return '🌐  $value';
}

String _requestStatusLabel(String status) {
  switch (status) {
    case 'accepted':
      return 'مقبولة';
    case 'rejected':
      return 'مرفوضة';
    case 'cancelled':
      return 'ملغاة';
    default:
      return status.isEmpty ? 'غير معروفة' : status;
  }
}
