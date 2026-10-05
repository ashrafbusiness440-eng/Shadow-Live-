import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import 'control_api_endpoints.dart';
import 'control_firebase.dart';

class _DiaryReportItem {
  const _DiaryReportItem({
    required this.reportId,
    required this.targetType,
    required this.targetId,
    required this.diaryId,
    required this.commentId,
    required this.targetOwnerUid,
    required this.targetAuthorUid,
    required this.reporterUid,
    required this.reasonLabel,
    required this.status,
    required this.evidence,
    required this.createdAtMs,
  });

  final String reportId;
  final String targetType;
  final String targetId;
  final String diaryId;
  final String commentId;
  final String targetOwnerUid;
  final String targetAuthorUid;
  final String reporterUid;
  final String reasonLabel;
  final String status;
  final Map<String, dynamic> evidence;
  final int createdAtMs;

  factory _DiaryReportItem.fromMap(Map<String, dynamic> data) {
    final rawEvidence = data['evidence'];
    return _DiaryReportItem(
      reportId: (data['reportId'] ?? '').toString().trim(),
      targetType: (data['targetType'] ?? '').toString().trim(),
      targetId: (data['targetId'] ?? '').toString().trim(),
      diaryId: (data['diaryId'] ?? '').toString().trim(),
      commentId: (data['commentId'] ?? '').toString().trim(),
      targetOwnerUid: (data['targetOwnerUid'] ?? '').toString().trim(),
      targetAuthorUid: (data['targetAuthorUid'] ?? '').toString().trim(),
      reporterUid: (data['reporterUid'] ?? '').toString().trim(),
      reasonLabel: (data['reasonLabel'] ?? data['reason'] ?? '').toString().trim(),
      status: (data['status'] ?? 'new').toString().trim(),
      evidence: rawEvidence is Map
          ? Map<String, dynamic>.from(rawEvidence)
          : const <String, dynamic>{},
      createdAtMs: (data['createdAtMs'] as num?)?.toInt() ?? 0,
    );
  }
}

class DiaryReportsControlPage extends StatefulWidget {
  const DiaryReportsControlPage({super.key, this.initialReportId});

  final String? initialReportId;

  @override
  State<DiaryReportsControlPage> createState() =>
      _DiaryReportsControlPageState();
}

class _DiaryReportsControlPageState extends State<DiaryReportsControlPage> {
  List<_DiaryReportItem> _items = const <_DiaryReportItem>[];
  String? _cursor;
  bool _hasMore = true;
  bool _loading = false;
  String? _busyId;
  Object? _error;
  Set<String> _capabilities = const <String>{};
  bool _owner = false;

  bool get _canReview =>
      _owner || _capabilities.contains('reviewReports');
  bool get _canDeleteDiary =>
      _owner || _capabilities.contains('manageDiaries');
  bool get _canDeleteComment =>
      _owner || _capabilities.contains('deleteDiaryComment');

  @override
  void initState() {
    super.initState();
    _loadAccess();
    _load(reset: true);
  }

  Future<void> _loadAccess() async {
    final uid = controlAuth.currentUser?.uid;
    if (uid == null) return;
    final snap = await controlFirestore.collection('users').doc(uid).get();
    if (!mounted) return;
    final data = snap.data() ?? <String, dynamic>{};
    final caps = data['capabilities'];
    setState(() {
      _owner = data['role'] == 'owner' && data['adminEnabled'] == true;
      _capabilities = caps is List
          ? caps.map((item) => item.toString()).toSet()
          : const <String>{};
    });
  }

  Future<Map<String, dynamic>> _post(
    String action, [
    Map<String, dynamic> payload = const <String, dynamic>{},
  ]) async {
    final token = await controlAuth.currentUser?.getIdToken(true);
    if (token == null || token.trim().isEmpty) {
      throw StateError('auth_required');
    }
    final response = await http.post(
      shadowApiEndpoint('diary-moderation'),
      headers: {
        'authorization': 'Bearer $token',
        'content-type': 'application/json',
      },
      body: jsonEncode({'action': action, ...payload}),
    );
    Map<String, dynamic> data = <String, dynamic>{};
    try {
      final decoded = jsonDecode(response.body);
      if (decoded is Map) data = Map<String, dynamic>.from(decoded);
    } catch (_) {}
    if (response.statusCode != 200 || data['ok'] != true) {
      throw StateError((data['code'] ?? 'diary_moderation_failed').toString());
    }
    return data;
  }

  String _operationKey(String action, String reportId) {
    final uid = controlAuth.currentUser?.uid ?? 'admin';
    final safeUid = uid.replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '_');
    final safeReport = reportId.replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '_');
    return 'diaryctl_${action}_${safeUid}_${safeReport}_${DateTime.now().microsecondsSinceEpoch}';
  }

  Future<void> _load({required bool reset}) async {
    if (_loading) return;
    setState(() {
      _loading = true;
      if (reset) _error = null;
    });
    try {
      _DiaryReportItem? focused;
      final focusId = widget.initialReportId?.trim() ?? '';
      if (reset && focusId.isNotEmpty) {
        try {
          final focusedData = await _post('getReport', {'reportId': focusId});
          if (focusedData['item'] is Map) {
            focused = _DiaryReportItem.fromMap(
              Map<String, dynamic>.from(focusedData['item'] as Map),
            );
          }
        } catch (_) {
          // If the report was already resolved/removed, fall back to the queue.
        }
      }
      final data = await _post('listReports', {
        'limit': 20,
        if (!reset && (_cursor?.isNotEmpty ?? false)) 'cursor': _cursor,
      });
      final raw = data['items'];
      final next = raw is List
          ? raw
              .whereType<Map>()
              .map((item) =>
                  _DiaryReportItem.fromMap(Map<String, dynamic>.from(item)))
              .where((item) => item.reportId.isNotEmpty)
              .toList(growable: false)
          : const <_DiaryReportItem>[];
      final merged = <String, _DiaryReportItem>{
        if (!reset) for (final item in _items) item.reportId: item,
        for (final item in next) item.reportId: item,
        if (focused != null && focused.reportId.isNotEmpty)
          focused.reportId: focused,
      }.values.toList(growable: false)
        ..sort((a, b) {
          final focusId = widget.initialReportId?.trim() ?? '';
          if (focusId.isNotEmpty) {
            if (a.reportId == focusId && b.reportId != focusId) return -1;
            if (b.reportId == focusId && a.reportId != focusId) return 1;
          }
          final time = b.createdAtMs.compareTo(a.createdAtMs);
          if (time != 0) return time;
          return b.reportId.compareTo(a.reportId);
        });
      if (!mounted) return;
      setState(() {
        _items = merged;
        _cursor = (data['nextCursor'] ?? '').toString().trim();
        _hasMore = data['hasMore'] == true;
        _error = null;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<String?> _reasonDialog(String title) async {
    final controller = TextEditingController(
      text: 'مراجعة بلاغ يوميات من Shadow Control',
    );
    final result = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(title),
        content: TextField(
          controller: controller,
          minLines: 2,
          maxLines: 4,
          maxLength: 200,
          decoration: const InputDecoration(
            labelText: 'سبب القرار',
            border: OutlineInputBorder(),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('إلغاء'),
          ),
          FilledButton(
            onPressed: () {
              final value = controller.text.trim();
              if (value.length >= 3) Navigator.pop(dialogContext, value);
            },
            child: const Text('تنفيذ'),
          ),
        ],
      ),
    );
    controller.dispose();
    return result;
  }

  Future<void> _review(_DiaryReportItem item, String status) async {
    if (!_canReview || _busyId != null) return;
    final reason = await _reasonDialog(
      status == 'rejected' ? 'رفض البلاغ' : 'بدء مراجعة البلاغ',
    );
    if (!mounted || reason == null) return;
    setState(() => _busyId = item.reportId);
    try {
      await _post('reviewReport', {
        'reportId': item.reportId,
        'status': status,
        'reason': reason,
        'idempotencyKey': _operationKey('review', item.reportId),
      });
      await _load(reset: true);
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('تعذر تحديث البلاغ: $error')),
        );
      }
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }

  Future<void> _deleteTarget(_DiaryReportItem item) async {
    final isComment = item.targetType == 'diary_comment';
    if (isComment ? !_canDeleteComment : !_canDeleteDiary) return;
    if (_busyId != null) return;

    final reason = await _reasonDialog(
      isComment ? 'حذف التعليق المبلّغ عنه' : 'حذف اليومية المبلّغ عنها',
    );
    if (!mounted || reason == null) return;
    setState(() => _busyId = item.reportId);
    try {
      await _post(isComment ? 'deleteDiaryComment' : 'deleteDiary', {
        'reportId': item.reportId,
        'diaryId': item.diaryId,
        if (isComment) 'commentId': item.commentId,
        'reason': reason,
        'idempotencyKey': _operationKey(
          isComment ? 'deletecomment' : 'deletediary',
          item.reportId,
        ),
      });
      await _load(reset: true);
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('تعذر تنفيذ الحذف: $error')),
        );
      }
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
  }

  String _statusLabel(String status) => switch (status) {
        'new' => 'جديد',
        'under_review' => 'قيد المراجعة',
        'actioned' => 'تم اتخاذ إجراء',
        'rejected' => 'مرفوض',
        _ => status,
      };

  String _targetLabel(_DiaryReportItem item) =>
      item.targetType == 'diary_comment' ? 'تعليق يومية' : 'يومية';

  Widget _reportCard(_DiaryReportItem item) {
    final evidenceText = (item.evidence['text'] ?? '').toString().trim();
    final busy = _busyId == item.reportId;
    final canDelete = item.targetType == 'diary_comment'
        ? _canDeleteComment
        : _canDeleteDiary;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                const Icon(Icons.flag_outlined, color: Color(0xFFFFD54A)),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    '${_targetLabel(item)} • ${item.reasonLabel}',
                    style: const TextStyle(fontWeight: FontWeight.w900),
                  ),
                ),
                Chip(label: Text(_statusLabel(item.status))),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              'Report ID: ${item.reportId}',
              textDirection: TextDirection.ltr,
              style: const TextStyle(color: Colors.white38, fontSize: 11),
            ),
            Text(
              'Diary: ${item.diaryId}${item.commentId.isNotEmpty ? ' • Comment: ${item.commentId}' : ''}',
              textDirection: TextDirection.ltr,
              style: const TextStyle(color: Colors.white38, fontSize: 11),
            ),
            if (evidenceText.isNotEmpty) ...[
              const SizedBox(height: 10),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: const Color(0xFF0D0917),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(
                  evidenceText,
                  style: const TextStyle(color: Colors.white70, height: 1.45),
                ),
              ),
            ],
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                if (_canReview && item.status == 'new')
                  OutlinedButton.icon(
                    onPressed: busy ? null : () => _review(item, 'under_review'),
                    icon: const Icon(Icons.visibility_outlined),
                    label: const Text('قيد المراجعة'),
                  ),
                if (_canReview &&
                    (item.status == 'new' || item.status == 'under_review'))
                  OutlinedButton.icon(
                    onPressed: busy ? null : () => _review(item, 'rejected'),
                    icon: const Icon(Icons.close_rounded),
                    label: const Text('رفض البلاغ'),
                  ),
                if (canDelete &&
                    item.status != 'actioned' &&
                    item.status != 'rejected')
                  FilledButton.icon(
                    onPressed: busy ? null : () => _deleteTarget(item),
                    icon: const Icon(Icons.delete_outline_rounded),
                    label: Text(
                      item.targetType == 'diary_comment'
                          ? 'حذف التعليق'
                          : 'حذف اليومية',
                    ),
                  ),
                if (busy)
                  const SizedBox(
                    width: 22,
                    height: 22,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('بلاغات اليوميات'),
        actions: [
          IconButton(
            onPressed: _loading ? null : () => _load(reset: true),
            icon: const Icon(Icons.refresh_rounded),
            tooltip: 'تحديث',
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () => _load(reset: true),
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            const Text(
              'مراجعة بلاغات اليوميات والتعليقات',
              style: TextStyle(fontSize: 22, fontWeight: FontWeight.w900),
            ),
            const SizedBox(height: 6),
            const Text(
              'راجع البلاغ واتخذ الإجراء المناسب.',
              style: TextStyle(color: Colors.white54),
            ),
            const SizedBox(height: 14),
            if (_error != null)
              Card(
                child: ListTile(
                  leading: const Icon(Icons.error_outline, color: Colors.redAccent),
                  title: const Text('تعذر تحميل البلاغات'),
                  subtitle: Text(_error.toString()),
                  trailing: IconButton(
                    onPressed: () => _load(reset: true),
                    icon: const Icon(Icons.refresh),
                  ),
                ),
              ),
            if (_items.isEmpty && _loading)
              const Padding(
                padding: EdgeInsets.all(40),
                child: Center(child: CircularProgressIndicator()),
              )
            else if (_items.isEmpty && _error == null)
              const Card(
                child: Padding(
                  padding: EdgeInsets.all(24),
                  child: Center(child: Text('لا توجد بلاغات يوميات حالياً.')),
                ),
              )
            else
              ..._items.map(_reportCard),
            if (_hasMore)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: OutlinedButton.icon(
                  onPressed: _loading ? null : () => _load(reset: false),
                  icon: _loading
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.expand_more_rounded),
                  label: const Text('تحميل المزيد'),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
