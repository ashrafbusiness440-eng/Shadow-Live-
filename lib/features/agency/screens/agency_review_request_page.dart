import 'package:flutter/material.dart';

import '../../profile/screens/public_profile_screen.dart';
import '../services/agency_membership_service.dart';

class AgencyReviewRequestPage extends StatefulWidget {
  const AgencyReviewRequestPage({
    super.key,
    required this.requestId,
  });

  final String requestId;

  @override
  State<AgencyReviewRequestPage> createState() =>
      _AgencyReviewRequestPageState();
}

class _AgencyReviewRequestPageState extends State<AgencyReviewRequestPage> {
  final AgencyMembershipService _service = AgencyMembershipService();
  AgencyReviewRequestDetail? _detail;
  bool _loading = true;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _service.close();
    super.dispose();
  }

  Future<void> _load() async {
    if (_busy) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final detail = await _service.getReviewRequest(widget.requestId);
      if (!mounted) return;
      setState(() {
        _detail = detail;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error.toString();
        _loading = false;
      });
    }
  }

  Future<String?> _askReason(String requestType) async {
    final controller = TextEditingController();
    final value = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(
          requestType == 'leave'
              ? 'رفض طلب المغادرة'
              : 'رفض طلب الانضمام',
        ),
        content: TextField(
          controller: controller,
          maxLength: 500,
          decoration: const InputDecoration(
            labelText: 'السبب',
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
            child: const Text('تأكيد الرفض'),
          ),
        ],
      ),
    );
    controller.dispose();
    return value;
  }

  Future<void> _respond(String decision) async {
    final detail = _detail;
    if (_busy || detail == null || !detail.actionable) return;
    String? reason;
    if (decision == 'reject') {
      reason = await _askReason(detail.type);
      if (reason == null) return;
    }

    setState(() => _busy = true);
    try {
      final code = await _service.respondReview(
        requestId: detail.requestId,
        requestType: detail.type,
        decision: decision,
        idempotencyKey: 'notification_review_' +
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
      setState(() => _busy = false);
      await _load();
    } catch (error) {
      if (!mounted) return;
      final code = error.toString().replaceFirst('Bad state: ', '');
      final message = switch (code) {
        'forbidden' => 'لم تعد لديك صلاحية مراجعة هذا الطلب.',
        'cannot_review_own_request' =>
          'لا يمكن مراجعة طلبك من الحساب نفسه.',
        'membership_request_not_found' => 'الطلب غير موجود.',
        _ => 'تعذر حسم الطلب حاليًا.',
      };
      setState(() => _busy = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(message)),
      );
      await _load();
    }
  }

  @override
  Widget build(BuildContext context) {
    final detail = _detail;
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: const Color(0xFF070B16),
        appBar: AppBar(
          backgroundColor: const Color(0xFF11182A),
          title: Text(
            detail?.type == 'leave'
                ? 'طلب مغادرة الوكالة'
                : 'طلب انضمام للوكالة',
          ),
        ),
        body: _loading && detail == null
            ? const Center(child: CircularProgressIndicator())
            : _error != null && detail == null
                ? Center(
                    child: FilledButton.icon(
                      onPressed: _load,
                      icon: const Icon(Icons.refresh_rounded),
                      label: const Text('إعادة المحاولة'),
                    ),
                  )
                : detail == null
                    ? const SizedBox.shrink()
                    : ListView(
                        padding: const EdgeInsets.all(16),
                        children: [
                          _RequesterCard(detail: detail),
                          const SizedBox(height: 12),
                          Card(
                            color: const Color(0xFF11182A),
                            child: Padding(
                              padding: const EdgeInsets.all(14),
                              child: Column(
                                crossAxisAlignment:
                                    CrossAxisAlignment.stretch,
                                children: [
                                  Text(
                                    detail.type == 'leave'
                                        ? 'طلب مغادرة'
                                        : 'طلب انضمام',
                                    style: const TextStyle(
                                      color: Color(0xFFB99CFF),
                                      fontWeight: FontWeight.w900,
                                      fontSize: 17,
                                    ),
                                  ),
                                  const SizedBox(height: 10),
                                  Text(
                                    'الحالة: ' +
                                        (detail.actionable
                                            ? 'بانتظار القرار'
                                            : _statusLabel(detail.status)),
                                  ),
                                  Text(
                                    'حالة الحساب: ' +
                                        _accountStatusLabel(
                                          detail.accountStatus,
                                        ),
                                  ),
                                  Text(
                                    'حالة الارتباط: ' +
                                        _conflictLabel(
                                          detail.conflictStatus,
                                        ),
                                    style: TextStyle(
                                      color: detail.conflictStatus == 'none'
                                          ? Colors.white70
                                          : Colors.amberAccent,
                                    ),
                                  ),
                                  if (detail.reason?.isNotEmpty == true) ...[
                                    const SizedBox(height: 6),
                                    Text(
                                      'السبب: ' + detail.reason!,
                                      style: const TextStyle(
                                        color: Colors.white60,
                                      ),
                                    ),
                                  ],
                                ],
                              ),
                            ),
                          ),
                          const SizedBox(height: 14),
                          if (detail.actionable)
                            Row(
                              children: [
                                Expanded(
                                  child: OutlinedButton(
                                    onPressed: _busy
                                        ? null
                                        : () => _respond('reject'),
                                    child: const Text('رفض'),
                                  ),
                                ),
                                const SizedBox(width: 10),
                                Expanded(
                                  child: FilledButton(
                                    onPressed: _busy || !detail.canAccept
                                        ? null
                                        : () => _respond('accept'),
                                    child: _busy
                                        ? const SizedBox.square(
                                            dimension: 18,
                                            child: CircularProgressIndicator(
                                              strokeWidth: 2,
                                            ),
                                          )
                                        : const Text('قبول'),
                                  ),
                                ),
                              ],
                            )
                          else
                            const Card(
                              color: Color(0xFF11182A),
                              child: ListTile(
                                leading: Icon(
                                  Icons.check_circle_rounded,
                                  color: Colors.greenAccent,
                                ),
                                title: Text(
                                  'هذا الطلب محسوم ولا يقبل قرارًا ثانيًا.',
                                ),
                              ),
                            ),
                        ],
                      ),
      ),
    );
  }
}

class _RequesterCard extends StatelessWidget {
  const _RequesterCard({required this.detail});

  final AgencyReviewRequestDetail detail;

  @override
  Widget build(BuildContext context) {
    final image = detail.profileImageUrl?.trim() ?? '';
    final publicId = detail.userPublicId?.trim() ?? '';
    return Card(
      color: const Color(0xFF11182A),
      child: ListTile(
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        leading: CircleAvatar(
          radius: 30,
          backgroundColor: const Color(0xFF31204F),
          backgroundImage: image.isEmpty ? null : NetworkImage(image),
          child: image.isEmpty
              ? const Icon(Icons.person_rounded)
              : null,
        ),
        title: Text(
          detail.displayName ??
              (publicId.isEmpty ? 'مستخدم Shadow Live' : publicId),
          style: const TextStyle(fontWeight: FontWeight.w900),
        ),
        subtitle: publicId.isEmpty
            ? null
            : Text(
                'ID: ' + publicId,
                textDirection: TextDirection.ltr,
              ),
        trailing: detail.uid.isEmpty
            ? null
            : IconButton(
                tooltip: 'فتح الملف الشخصي',
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) =>
                        PublicProfileScreen(userId: detail.uid),
                  ),
                ),
                icon: const Icon(Icons.open_in_new_rounded),
              ),
      ),
    );
  }
}

String _statusLabel(String status) {
  switch (status) {
    case 'accepted':
      return 'مقبول';
    case 'rejected':
      return 'مرفوض';
    case 'cancelled':
      return 'ملغى';
    case 'pending':
      return 'بانتظار القرار';
    default:
      return status.isEmpty ? 'غير معروف' : status;
  }
}

String _accountStatusLabel(String status) {
  switch (status) {
    case 'active':
      return 'نشط';
    case 'suspended':
      return 'موقوف';
    case 'disabled':
      return 'معطّل';
    case 'banned':
      return 'محظور';
    default:
      return status.isEmpty ? 'غير متاح' : status;
  }
}

String _conflictLabel(String status) {
  switch (status) {
    case 'none':
      return 'سليم';
    case 'already_in_agency':
      return 'مرتبط بوكالة أخرى';
    case 'reserved_other_request':
      return 'محجوز بطلب آخر';
    case 'membership_changed':
      return 'تغيّرت العضوية';
    case 'user_missing':
      return 'المستخدم غير متاح';
    case 'account_inactive':
      return 'الحساب غير نشط';
    default:
      return status.isEmpty ? 'غير متاح' : status;
  }
}
