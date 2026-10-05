import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import 'agency_control_page.dart';
import 'control_api_endpoints.dart';
import 'control_firebase.dart';
import 'diary_reports_control_page.dart';

class AdminInboxItem {
  const AdminInboxItem({
    required this.key,
    required this.type,
    required this.title,
    required this.body,
    required this.targetId,
    required this.route,
    required this.read,
    required this.createdAtMs,
    required this.priority,
  });

  final String key;
  final String type;
  final String title;
  final String body;
  final String targetId;
  final String route;
  final bool read;
  final int createdAtMs;
  final String priority;

  factory AdminInboxItem.fromMap(Map<String, dynamic> data) => AdminInboxItem(
        key: (data['key'] ?? '').toString().trim(),
        type: (data['type'] ?? '').toString().trim(),
        title: (data['title'] ?? 'طلب إداري').toString().trim(),
        body: (data['body'] ?? '').toString().trim(),
        targetId: (data['targetId'] ?? '').toString().trim(),
        route: (data['route'] ?? '').toString().trim(),
        read: data['read'] == true,
        createdAtMs: (data['createdAtMs'] as num?)?.toInt() ?? 0,
        priority: (data['priority'] ?? 'normal').toString().trim(),
      );
}

class AdminInboxSnapshot {
  const AdminInboxSnapshot({
    required this.items,
    required this.unreadCount,
    required this.capped,
  });

  final List<AdminInboxItem> items;
  final int unreadCount;
  final bool capped;
}

class AdminInboxService {
  static Future<Map<String, dynamic>> _post(
    String action, [
    Map<String, dynamic> payload = const <String, dynamic>{},
  ]) async {
    final user = controlAuth.currentUser;
    if (user == null) throw StateError('not_signed_in');
    final token = await user.getIdToken();
    if (token == null || token.trim().isEmpty) {
      throw StateError('empty_token');
    }
    final response = await http.post(
      shadowApiEndpoint('admin-inbox'),
      headers: <String, String>{
        'authorization': 'Bearer $token',
        'content-type': 'application/json',
      },
      body: jsonEncode(<String, dynamic>{
        'action': action,
        ...payload,
      }),
    );
    Map<String, dynamic> data = <String, dynamic>{};
    try {
      final decoded = jsonDecode(response.body);
      if (decoded is Map) data = Map<String, dynamic>.from(decoded);
    } catch (_) {}
    if (response.statusCode != 200 || data['ok'] != true) {
      throw StateError((data['code'] ?? 'admin_inbox_failed').toString());
    }
    return data;
  }

  static Future<AdminInboxSnapshot> load() async {
    final data = await _post('list');
    final raw = data['items'];
    final items = raw is List
        ? raw
            .whereType<Map>()
            .map((item) =>
                AdminInboxItem.fromMap(Map<String, dynamic>.from(item)))
            .where((item) => item.key.isNotEmpty && item.targetId.isNotEmpty)
            .toList(growable: false)
        : const <AdminInboxItem>[];
    return AdminInboxSnapshot(
      items: items,
      unreadCount: (data['unreadCount'] as num?)?.toInt() ?? 0,
      capped: data['capped'] == true,
    );
  }

  static Future<void> markRead(String key) async {
    await _post('markRead', <String, dynamic>{'key': key});
  }

  static Future<void> markVisibleRead() async {
    await _post('markVisibleRead');
  }
}

class AdminNotificationsPage extends StatefulWidget {
  const AdminNotificationsPage({super.key});

  @override
  State<AdminNotificationsPage> createState() => _AdminNotificationsPageState();
}

class _AdminNotificationsPageState extends State<AdminNotificationsPage> {
  AdminInboxSnapshot? _snapshot;
  Object? _error;
  bool _loading = false;
  bool _markingAll = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (_loading) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final snapshot = await AdminInboxService.load();
      if (!mounted) return;
      setState(() => _snapshot = snapshot);
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _markAllRead() async {
    if (_markingAll) return;
    setState(() => _markingAll = true);
    try {
      await AdminInboxService.markVisibleRead();
      await _load();
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('تعذر تحديث الإشعارات: ' + error.toString())),
        );
      }
    } finally {
      if (mounted) setState(() => _markingAll = false);
    }
  }

  Future<void> _open(AdminInboxItem item) async {
    try {
      if (!item.read) {
        await AdminInboxService.markRead(item.key);
      }
      if (!mounted) return;

      Widget? page;
      if (item.route == 'diary_reports') {
        page = DiaryReportsControlPage(initialReportId: item.targetId);
      } else if (item.route == 'agency_control') {
        page = AgencyControlPage(
          focusType: item.type,
          focusId: item.targetId,
        );
      }
      if (page == null) return;

      await Navigator.of(context).push(
        MaterialPageRoute<void>(builder: (_) => page!),
      );
      await _load();
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('تعذر فتح الطلب: ' + error.toString())),
        );
      }
    }
  }

  String _timeLabel(int ms) {
    if (ms <= 0) return '';
    final date = DateTime.fromMillisecondsSinceEpoch(ms).toLocal();
    final now = DateTime.now();
    final diff = now.difference(date);
    if (diff.inMinutes < 1) return 'الآن';
    if (diff.inHours < 1) return 'منذ ' + diff.inMinutes.toString() + ' د';
    if (diff.inDays < 1) return 'منذ ' + diff.inHours.toString() + ' س';
    if (diff.inDays < 7) return 'منذ ' + diff.inDays.toString() + ' ي';
    return date.year.toString() + '/' + date.month.toString() + '/' + date.day.toString();
  }

  IconData _iconFor(String type) => switch (type) {
        'diary_report' => Icons.flag_outlined,
        'agency_application' => Icons.apartment_outlined,
        'agency_identity_change' => Icons.edit_location_alt_outlined,
        'agency_ownership_transfer' => Icons.swap_horiz_rounded,
        'agency_cooldown_exception' => Icons.timer_off_outlined,
        _ => Icons.notifications_outlined,
      };

  @override
  Widget build(BuildContext context) {
    final snapshot = _snapshot;
    final items = snapshot?.items ?? const <AdminInboxItem>[];

    return Scaffold(
      appBar: AppBar(
        title: const Text('إشعارات الإدارة'),
        actions: [
          if ((snapshot?.unreadCount ?? 0) > 0)
            TextButton.icon(
              onPressed: _markingAll ? null : _markAllRead,
              icon: const Icon(Icons.done_all_rounded),
              label: const Text('قراءة الكل'),
            ),
          IconButton(
            onPressed: _loading ? null : _load,
            tooltip: 'تحديث',
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            const Text(
              'الطلبات التي تحتاج انتباه الإدارة',
              style: TextStyle(fontSize: 22, fontWeight: FontWeight.w900),
            ),
            const SizedBox(height: 6),
            const Text(
              'اضغط على أي إشعار لفتح صفحة المراجعة المرتبطة به مباشرة.',
              style: TextStyle(color: Colors.white54),
            ),
            if (snapshot?.capped == true) ...[
              const SizedBox(height: 10),
              const Text(
                'يعرض المركز أحدث الطلبات للتنبيه السريع؛ القوائم الكاملة موجودة في صفحات الإدارة الأصلية.',
                style: TextStyle(color: Color(0xFFD7B85A), fontSize: 12),
              ),
            ],
            const SizedBox(height: 14),
            if (_error != null)
              Card(
                child: ListTile(
                  leading:
                      const Icon(Icons.error_outline, color: Colors.redAccent),
                  title: const Text('تعذر تحميل إشعارات الإدارة'),
                  subtitle: Text(_error.toString()),
                  trailing: IconButton(
                    onPressed: _load,
                    icon: const Icon(Icons.refresh),
                  ),
                ),
              ),
            if (_loading && items.isEmpty)
              const Padding(
                padding: EdgeInsets.all(40),
                child: Center(child: CircularProgressIndicator()),
              )
            else if (items.isEmpty && _error == null)
              const Card(
                child: Padding(
                  padding: EdgeInsets.all(28),
                  child: Center(
                    child: Text('ما في طلبات إدارية معلقة حالياً.'),
                  ),
                ),
              )
            else
              ...items.map(
                (item) => Card(
                  child: ListTile(
                    onTap: () => _open(item),
                    leading: Stack(
                      clipBehavior: Clip.none,
                      children: [
                        Icon(
                          _iconFor(item.type),
                          color: item.priority == 'high'
                              ? const Color(0xFFFFD54A)
                              : Colors.white70,
                        ),
                        if (!item.read)
                          const Positioned(
                            top: -4,
                            right: -5,
                            child: DecoratedBox(
                              decoration: BoxDecoration(
                                color: Colors.redAccent,
                                shape: BoxShape.circle,
                              ),
                              child: SizedBox(width: 9, height: 9),
                            ),
                          ),
                      ],
                    ),
                    title: Text(
                      item.title,
                      style: TextStyle(
                        fontWeight:
                            item.read ? FontWeight.w600 : FontWeight.w900,
                      ),
                    ),
                    subtitle: Text(
                      [
                        if (item.body.isNotEmpty) item.body,
                        if (_timeLabel(item.createdAtMs).isNotEmpty)
                          _timeLabel(item.createdAtMs),
                      ].join(' • '),
                    ),
                    trailing: const Icon(Icons.chevron_left_rounded),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
