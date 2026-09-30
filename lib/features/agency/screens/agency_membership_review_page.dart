import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../profile/screens/public_profile_screen.dart';
import '../services/host_my_agency_service.dart';
import '../services/owner_agency_service.dart';

class AgencyMembershipReviewPage extends StatefulWidget {
  const AgencyMembershipReviewPage({
    super.key,
    required this.initialCore,
  });

  final HostMyAgencyCoreData initialCore;

  @override
  State<AgencyMembershipReviewPage> createState() =>
      _AgencyMembershipReviewPageState();
}

class _AgencyMembershipReviewPageState
    extends State<AgencyMembershipReviewPage> {
  final OwnerAgencyService _service = OwnerAgencyService();

  List<OwnerAgencyPendingRequest>? _requests;
  int? _nextOffset;
  bool _hasMore = false;
  bool _truncated = false;
  bool _loading = true;
  bool _loadingMore = false;
  bool _busy = false;
  String? _error;

  String get _agencyId => widget.initialCore.agency.agencyId;

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

  String _operationKey(String prefix) =>
      '${prefix}_${DateTime.now().microsecondsSinceEpoch}';

  Future<void> _load() async {
    if (_loading && _requests != null) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final page = await _service.loadPendingPage(_agencyId);
      if (!mounted) return;
      setState(() {
        _requests = page.requests;
        _nextOffset = page.nextOffset;
        _hasMore = page.hasMore;
        _truncated = page.truncated;
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

  Future<void> _loadMore() async {
    final offset = _nextOffset;
    if (_loadingMore || !_hasMore || offset == null) return;
    setState(() => _loadingMore = true);
    try {
      final page = await _service.loadPendingPage(
        _agencyId,
        offset: offset,
      );
      if (!mounted) return;
      final byId = <String, OwnerAgencyPendingRequest>{
        for (final request
            in _requests ?? const <OwnerAgencyPendingRequest>[])
          request.requestId: request,
      };
      for (final request in page.requests) {
        byId[request.requestId] = request;
      }
      final merged = byId.values.toList()
        ..sort((left, right) {
          final l = left.createdAt?.millisecondsSinceEpoch ?? 0;
          final r = right.createdAt?.millisecondsSinceEpoch ?? 0;
          return r.compareTo(l);
        });
      setState(() {
        _requests = merged;
        _nextOffset = page.nextOffset;
        _hasMore = page.hasMore;
        _truncated = page.truncated;
        _loadingMore = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error.toString();
        _loadingMore = false;
      });
    }
  }

  Future<String?> _rejectReason(OwnerAgencyPendingRequest request) async {
    final controller = TextEditingController();
    final value = await showDialog<String>(
      context: context,
      builder: (dialogContext) => Directionality(
        textDirection: TextDirection.rtl,
        child: AlertDialog(
          title: Text(
            request.type == 'leave'
                ? 'رفض طلب المغادرة'
                : 'رفض طلب الانضمام',
          ),
          content: TextField(
            controller: controller,
            maxLength: 500,
            decoration: const InputDecoration(hintText: 'سبب الرفض'),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text('إلغاء'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(
                dialogContext,
                controller.text.trim(),
              ),
              child: const Text('رفض'),
            ),
          ],
        ),
      ),
    );
    controller.dispose();
    return value;
  }

  Future<void> _respond(
    OwnerAgencyPendingRequest request,
    String decision,
  ) async {
    if (_busy) return;
    final reason =
        decision == 'reject' ? await _rejectReason(request) : null;
    if (decision == 'reject' && reason == null) return;

    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      if (request.type == 'leave') {
        await _service.respondLeave(
          requestId: request.requestId,
          decision: decision,
          idempotencyKey: _operationKey('agency_review_leave'),
          reason: reason,
        );
      } else {
        await _service.respondJoin(
          requestId: request.requestId,
          decision: decision,
          idempotencyKey: _operationKey('agency_review_join'),
          reason: reason,
        );
      }
      if (!mounted) return;
      setState(() => _busy = false);
      await _load();
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = error.toString();
      });
    }
  }

  Future<void> _cancelInvite(OwnerAgencyPendingRequest request) async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await _service.cancelRequest(
        requestId: request.requestId,
        idempotencyKey: _operationKey('agency_review_invite_cancel'),
        reason: 'agency_manager_cancelled_invite',
      );
      if (!mounted) return;
      setState(() => _busy = false);
      await _load();
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = error.toString();
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final requests = _requests ?? const <OwnerAgencyPendingRequest>[];
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: const Color(0xFF070914),
        appBar: AppBar(
          backgroundColor: const Color(0xFF0B1020),
          title: const Text('إدارة الوكالة'),
        ),
        body: RefreshIndicator(
          onRefresh: _load,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 18, 16, 28),
            children: [
              Row(
                children: [
                  const Expanded(
                    child: Text(
                      'الطلبات المعلّقة',
                      style: TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.w800,
                        fontSize: 20,
                      ),
                    ),
                  ),
                  if (requests.isNotEmpty)
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 9,
                        vertical: 3,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.redAccent,
                        borderRadius: BorderRadius.circular(14),
                      ),
                      child: Text(
                        '${requests.length}',
                        style: const TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                ],
              ),
              const SizedBox(height: 6),
              Text(
                widget.initialCore.agency.name,
                style: const TextStyle(color: Colors.white54),
              ),
              const SizedBox(height: 14),
              if (_loading && _requests == null)
                const Center(
                  child: Padding(
                    padding: EdgeInsets.all(30),
                    child: CircularProgressIndicator(),
                  ),
                )
              else if (_error != null && _requests == null)
                FilledButton.icon(
                  onPressed: _load,
                  icon: const Icon(Icons.refresh_rounded),
                  label: const Text('تعذر التحميل — إعادة المحاولة'),
                )
              else if (requests.isEmpty)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 40),
                  child: Center(
                    child: Text(
                      'لا توجد طلبات معلّقة.',
                      style: TextStyle(color: Colors.white54),
                    ),
                  ),
                )
              else
                ...requests.map(
                  (request) => _ReviewRequestCard(
                    request: request,
                    busy: _busy,
                    onRespond: _respond,
                    onCancelInvite: _cancelInvite,
                  ),
                ),
              if (_hasMore) ...[
                const SizedBox(height: 8),
                OutlinedButton.icon(
                  onPressed: _loadingMore || _busy ? null : _loadMore,
                  icon: _loadingMore
                      ? const SizedBox.square(
                          dimension: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.expand_more_rounded),
                  label: Text(
                    _loadingMore ? 'جارٍ التحميل…' : 'تحميل المزيد',
                  ),
                ),
              ],
              if (_truncated) ...[
                const SizedBox(height: 8),
                const Text(
                  'تم الوصول إلى حد نافذة الطلبات الآمنة. حدّث بعد حسم الطلبات الحالية.',
                  style: TextStyle(
                    color: Colors.amberAccent,
                    fontSize: 12,
                  ),
                ),
              ],
              if (_error != null && _requests != null) ...[
                const SizedBox(height: 10),
                const Text(
                  'آخر عملية لم تكتمل. حدّث القائمة قبل المحاولة مجددًا.',
                  style: TextStyle(color: Colors.redAccent, fontSize: 12),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _ReviewRequestCard extends StatelessWidget {
  const _ReviewRequestCard({
    required this.request,
    required this.busy,
    required this.onRespond,
    required this.onCancelInvite,
  });

  final OwnerAgencyPendingRequest request;
  final bool busy;
  final Future<void> Function(OwnerAgencyPendingRequest, String) onRespond;
  final Future<void> Function(OwnerAgencyPendingRequest) onCancelInvite;

  @override
  Widget build(BuildContext context) {
    final publicId = request.userPublicId?.trim() ?? '';
    final image = request.profileImageUrl?.trim() ?? '';
    final typeLabel = switch (request.type) {
      'leave' => 'طلب مغادرة',
      'join' => 'طلب انضمام',
      _ => 'دعوة معلّقة',
    };
    final conflict = _conflictLabel(request);

    return Card(
      color: const Color(0xFF11182A),
      margin: const EdgeInsets.only(bottom: 9),
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
        onTap: request.uid.isEmpty
            ? null
            : () => Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => PublicProfileScreen(userId: request.uid),
                  ),
                ),
        leading: CircleAvatar(
          backgroundColor: const Color(0xFF31204F),
          backgroundImage: image.isEmpty ? null : NetworkImage(image),
          child: image.isEmpty
              ? const Icon(Icons.person_rounded, color: Colors.white70)
              : null,
        ),
        title: Row(
          children: [
            Expanded(
              child: Text(
                request.displayName ??
                    (publicId.isEmpty ? request.uid : publicId),
                style: const TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            if (publicId.isNotEmpty)
              IconButton(
                tooltip: 'نسخ ID',
                onPressed: () async {
                  await Clipboard.setData(ClipboardData(text: publicId));
                  if (!context.mounted) return;
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('تم نسخ ID المستخدم.')),
                  );
                },
                icon: const Icon(Icons.copy_rounded, size: 18),
              ),
          ],
        ),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (publicId.isNotEmpty)
              Text(
                'ID: $publicId',
                textDirection: TextDirection.ltr,
                style: const TextStyle(color: Colors.white54),
              ),
            Text(
              '$typeLabel • ${_roleLabel(request.targetRole)} • ${_waitLabel(request.createdAt)}',
              style: const TextStyle(color: Colors.white54),
            ),
            if (conflict != null)
              Text(
                conflict,
                style: const TextStyle(
                  color: Colors.amberAccent,
                  fontSize: 12,
                ),
              ),
          ],
        ),
        trailing: request.type == 'invite'
            ? TextButton(
                onPressed: busy ? null : () => onCancelInvite(request),
                child: const Text('إلغاء'),
              )
            : Wrap(
                spacing: 4,
                children: [
                  TextButton(
                    onPressed: busy ? null : () => onRespond(request, 'reject'),
                    child: const Text('رفض'),
                  ),
                  FilledButton(
                    onPressed: busy || !request.canAccept
                        ? null
                        : () => onRespond(request, 'accept'),
                    child: const Text('قبول'),
                  ),
                ],
              ),
      ),
    );
  }
}

String _roleLabel(String role) {
  switch (role) {
    case 'senior_manager':
      return 'مدير أول';
    case 'manager':
      return 'مدير';
    case 'owner':
      return 'مالك الوكالة';
    default:
      return 'مضيف';
  }
}

String _waitLabel(DateTime? createdAt) {
  if (createdAt == null) return 'وقت الإرسال غير متاح';
  final diff = DateTime.now().difference(createdAt.toLocal());
  if (diff.isNegative || diff.inMinutes < 1) return 'الآن';
  if (diff.inHours < 1) return 'منذ ${diff.inMinutes} د';
  if (diff.inDays < 1) return 'منذ ${diff.inHours} س';
  return 'منذ ${diff.inDays} ي';
}

String? _conflictLabel(OwnerAgencyPendingRequest request) {
  switch (request.conflictStatus) {
    case 'account_inactive':
      return 'الحساب غير نشط.';
    case 'user_missing':
      return 'الحساب غير متاح.';
    case 'already_in_agency':
      return 'المستخدم مرتبط بوكالة حاليًا.';
    case 'reserved_other_request':
      return 'لدى المستخدم طلب/دعوة وكالة أخرى محجوزة.';
    case 'membership_changed':
      return 'حالة العضوية تغيّرت منذ إرسال الطلب.';
    default:
      return request.accountStatus == 'active'
          ? null
          : 'حالة الحساب: ${request.accountStatus}';
  }
}
