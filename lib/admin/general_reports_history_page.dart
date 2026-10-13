import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'admin_account_identity_tile.dart';
import 'general_reports_control_page.dart';

/// Historical case browsing lives under the existing Reports entry.
//// Only one bounded 20-document category page is held in memory at a time.
class GeneralReportsHistoryPage extends StatefulWidget {
  const GeneralReportsHistoryPage({super.key});

  @override
  State<GeneralReportsHistoryPage> createState() =>
      _GeneralReportsHistoryPageState();
}

class _GeneralReportsHistoryPageState
    extends State<GeneralReportsHistoryPage> {
  final _search = TextEditingController();
  final List<String?> _back = <String?>[];
  List<GeneralReportItem> _items = <GeneralReportItem>[];
  String _category = 'user_report';
  String? _cursor;
  String? _nextCursor;
  String? _lookupId;
  String? _error;
  bool _loading = false;
  bool _canReview = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    if (_loading) return;
    setState(() { _loading = true; _error = null; });
    try {
      final data = _lookupId != null
          ? await GeneralReportsService.load(reportId: _lookupId)
          : await GeneralReportsService.history(
              type: _category, cursor: _cursor,
            );
      if (!mounted) return;
      final raw = data['items'] is List ? data['items'] as List : [];
      setState(() {
        _items = _lookupId == null
            ? raw.whereType<Map>()
                .map((v) => GeneralReportItem(Map<String, dynamic>.from(v)))
                .toList()
            : data['item'] is Map
                ? [GeneralReportItem(
                    Map<String, dynamic>.from(data['item'] as Map))]
                : <GeneralReportItem>[];
        _canReview = data['canReview'] == true;
        _nextCursor = (data['nextCursor'] ?? '').toString().trim();
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = generalReportErrorMessage(error);
        _items = [];
        _nextCursor = null;
      });
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _chooseCategory(String type) {
    if (_loading || _category == type) return;
    setState(() {
      _category = type;
      _lookupId = null;
      _cursor = null;
      _nextCursor = null;
      _back.clear();
      _items = [];
    });
    _load();
  }

  void _lookup() {
    if (_loading) return;
    final id = _search.text.trim();
    if (!RegExp(r'^[A-Za-z0-9_-]{1,180}$').hasMatch(id)) {
      setState(() => _error = 'اكتب رقم البلاغ الصحيح ثم اضغط بحث.');
      return;
    }
    setState(() {
      _lookupId = id;
      _items = [];
      _nextCursor = null;
      _error = null;
    });
    _load();
  }

  void _backToHistory() {
    if (_loading) return;
    setState(() {
      _lookupId = null;
      _items = [];
      _error = null;
      _nextCursor = null;
    });
    _load();
  }

  void _next() {
    if (_loading || _nextCursor == null || _nextCursor!.isEmpty) return;
    setState(() {
      if (_back.length >= 12) _back.removeAt(0);
      _back.add(_cursor);
      _cursor = _nextCursor;
      _nextCursor = null;
      _items = [];
    });
    _load();
  }

  void _previous() {
    if (_loading || _back.isEmpty) return;
    setState(() {
      _cursor = _back.removeLast();
      _nextCursor = null;
      _items = [];
    });
    _load();
  }

  String _date(int millis) {
    if (millis <= 0) return 'غير محدد';
    final time = DateTime.fromMillisecondsSinceEpoch(millis).toLocal();
    return time.toString().substring(0, 16);
  }

  Widget _caseCard(GeneralReportItem report) {
    final reporter = AdminAccountIdentity.fromProfile(
      report.reporterUid, report.mapField('reporterProfile'));
    final target = AdminAccountIdentity.fromProfile(
      report.targetUid, report.mapField('targetProfile'));
    final evidence = report.mapField('evidence');
    final message = evidence['message'] is Map
        ? Map<String, dynamic>.from(evidence['message'] as Map)
        : const <String, dynamic>{};
    final created = (report.data['createdAtMs'] as num?)?.toInt() ?? 0;
    final details = report.field('details');
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
              Expanded(child: Text(report.title,
                style: const TextStyle(fontWeight: FontWeight.w800))),
              Chip(label: Text(report.statusLabel)),
            ]),
            const SizedBox(height: 7),
            Text('وقت البلاغ: ${_date(created)}',
              style: const TextStyle(color: Colors.white70)),
            Text('السبب: ${report.reasonLabel}'),
            if (details.isNotEmpty) Text('التفاصيل: $details'),
            const SizedBox(height: 10),
            AdminAccountIdentityTile(
              roleLabel: 'مقدّم البلاغ', identity: reporter),
            const SizedBox(height: 8),
            AdminAccountIdentityTile(
              roleLabel: report.type == 'room_report'
                  ? 'صاحب الغرفة المبلّغ عنها'
                  : 'الحساب المبلّغ عليه',
              identity: target,
            ),
            if (report.field('roomId').isNotEmpty)
              ListTile(
                dense: true,
                title: const Text('الغرفة المرتبطة'),
                subtitle: SelectableText(report.field('roomId')),
              ),
            if (report.field('conversationId').isNotEmpty)
              ListTile(
                dense: true,
                title: const Text('المحادثة المرتبطة'),
                subtitle: SelectableText(report.field('conversationId')),
              ),
            if ((message['text'] ?? '').toString().isNotEmpty)
              SelectableText('الرسالة المبلّغ عنها: ${message['text']}'),
            if (report.actionLabel.isNotEmpty)
              Text(report.actionLabel),
            if (report.field('reviewReason').isNotEmpty)
              Text('قرار الإدارة: ${report.field('reviewReason')}'),
            Row(children: [
              Expanded(child: SelectableText(
                'رقم البلاغ: ${report.id.length <= 20 ? report.id : '…${report.id.substring(report.id.length - 16)}'}',
                style: const TextStyle(fontSize: 11, color: Colors.white70),
              )),
              IconButton(
                tooltip: 'نسخ رقم البلاغ',
                onPressed: () => Clipboard.setData(
                  ClipboardData(text: report.id)),
                icon: const Icon(Icons.copy_rounded),
              ),
            ]),
            if (_canReview && report.status == 'actioned')
              const Text('هذا البلاغ سبق تسجيل إجراء له. '
                  'فتح السجل لا ينفذ أي عقوبة جديدة.',
                style: TextStyle(color: Colors.white70, fontSize: 12)),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: const Text('سجل البلاغات السابقة'),
      actions: [
        IconButton(
          tooltip: 'تحديث القائمة',
          onPressed: _loading ? null : _load,
          icon: const Icon(Icons.refresh_rounded),
        ),
      ],
    ),
    body: ListView(
      padding: const EdgeInsets.all(14),
      children: [
        const Text('البلاغات القديمة والمغلقة',
          style: TextStyle(fontSize: 19, fontWeight: FontWeight.w800)),
        const SizedBox(height: 6),
        const Text(
          'بتقدر تراجع البلاغات القديمة، مين قدّمها وعلى مين، '
          'والسبب والقرار السابق، بدون تعديل سجلها.',
          style: TextStyle(color: Colors.white70),
        ),
        const SizedBox(height: 12),
        DropdownButtonFormField<String>(
          key: ValueKey(_category),
          initialValue: _category,
          isExpanded: true,
          decoration: const InputDecoration(
            labelText: 'نوع البلاغ',
            border: OutlineInputBorder(),
          ),
          items: const [
            DropdownMenuItem(value: 'user_report',
                child: Text('بلاغات المحادثات الخاصة')),
            DropdownMenuItem(value: 'room_message_report',
                child: Text('بلاغات رسائل الغرف')),
            DropdownMenuItem(value: 'room_report',
                child: Text('بلاغات الغرف')),
          ],
          onChanged: _loading ? null : (v) {
            if (v != null) _chooseCategory(v);
          },
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _search,
          maxLength: 180,
          onSubmitted: (_) => _lookup(),
          textInputAction: TextInputAction.search,
          decoration: InputDecoration(
            labelText: 'البحث عن بلاغ برقم البلاغ',
            hintText: 'الصق الرقم الموجود بالإشعار',
            border: const OutlineInputBorder(),
            suffixIcon: IconButton(
              tooltip: 'بحث',
              onPressed: _loading ? null : _lookup,
              icon: const Icon(Icons.search_rounded),
            ),
          ),
        ),
        if (_lookupId != null)
          Align(
            alignment: Alignment.centerRight,
            child: TextButton.icon(
              onPressed: _loading ? null : _backToHistory,
              icon: const Icon(Icons.arrow_back_rounded),
              label: const Text('الرجوع لسجل البلاغات'),
            ),
          ),
        if (_lookupId == null)
          const Text(
            'نعرض عددًا محدودًا بكل صفحة؛ الانتقال بحسب مرجع البلاغ، '
            'مو بالضرورة من الأحدث للأقدم حسب الوقت.',
            style: TextStyle(color: Colors.white70, fontSize: 12),
          ),
        if (_loading)
          const Padding(
            padding: EdgeInsets.all(18),
            child: Center(child: CircularProgressIndicator()),
          ),
        if (_error != null)
          Card(
            child: ListTile(
              title: const Text('تعذّر عرض البلاغات'),
              subtitle: Text(_error!),
              trailing: IconButton(
                tooltip: 'إعادة المحاولة',
                onPressed: _loading ? null : _load,
                icon: const Icon(Icons.refresh_rounded),
              ),
            ),
          ),
        if (!_loading && _error == null && _items.isEmpty)
          const Card(child: Padding(
            padding: EdgeInsets.all(20),
            child: Text('ما في بلاغات ضمن هذه الصفحة.'),
          )),
        for (final report in _items) _caseCard(report),
        if (_lookupId == null)
          Wrap(
            alignment: WrapAlignment.center,
            spacing: 8,
            runSpacing: 8,
            children: [
              OutlinedButton(
                onPressed: _loading || _back.isEmpty ? null : _previous,
                child: const Text('الصفحة السابقة'),
              ),
              FilledButton(
                onPressed: _loading || _nextCursor == null ||
                    _nextCursor!.isEmpty ? null : _next,
                child: const Text('الصفحة التالية'),
              ),
            ],
          ),
      ],
    ),
  );
}
