import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import 'control_api_endpoints.dart';
import 'control_firebase.dart';

class SystemHealthCard extends StatefulWidget {
  const SystemHealthCard({super.key});

  @override
  State<SystemHealthCard> createState() => _SystemHealthCardState();
}

class _SystemHealthCardState extends State<SystemHealthCard> {
  Timer? _timer;
  Map<String, dynamic>? _data;
  Object? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    unawaited(_refresh());
    _timer = Timer.periodic(
      const Duration(seconds: 15),
      (_) => unawaited(_refresh(silent: true)),
    );
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Map<String, dynamic> _map(dynamic value) =>
      value is Map ? Map<String, dynamic>.from(value) : <String, dynamic>{};

  num _num(dynamic value) => value is num ? value : num.tryParse('$value') ?? 0;

  Future<void> _refresh({bool silent = false}) async {
    if (!silent && mounted) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }
    try {
      final user = controlAuth.currentUser;
      if (user == null) throw Exception('not_signed_in');
      final token = await user.getIdToken();
      if (token == null || token.isEmpty) throw Exception('empty_token');
      final response = await http.get(
        shadowApiEndpoint('system-health'),
        headers: {'Authorization': 'Bearer $token'},
      ).timeout(const Duration(seconds: 20));
      final body = response.body.isEmpty
          ? <String, dynamic>{}
          : jsonDecode(response.body) as Map<String, dynamic>;
      if (response.statusCode == 403) throw Exception('forbidden');
      if (response.statusCode < 200 ||
          response.statusCode >= 300 ||
          body['ok'] != true) {
        throw Exception((body['code'] ?? 'request_failed').toString());
      }
      if (!mounted) return;
      setState(() {
        _data = body;
        _error = null;
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

  Color _statusColor(String state) => switch (state) {
        'green' => Colors.greenAccent,
        'yellow' => Colors.amberAccent,
        'red' => Colors.redAccent,
        _ => Colors.blueGrey,
      };

  String _statusEmoji(String state) => switch (state) {
        'green' => '🟢',
        'yellow' => '🟡',
        'red' => '🔴',
        _ => '⚪',
      };

  Widget _metric(String label, String value) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: .04),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: Colors.white12),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              value,
              style: const TextStyle(
                fontWeight: FontWeight.w900,
                fontSize: 16,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              label,
              style: const TextStyle(
                color: Color(0xFFAAA3B8),
                fontSize: 11,
              ),
            ),
          ],
        ),
      );

  String _fmt(num value, {int decimals = 0}) {
    if (decimals <= 0) return value.round().toString();
    return value.toStringAsFixed(decimals);
  }

  Future<void> _showDetails() async {
    final data = _data;
    if (data == null) return;
    final windows = _map(data['windows']);
    final endpoints = (data['topEndpoints'] is List)
        ? (data['topEndpoints'] as List)
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList(growable: false)
        : <Map<String, dynamic>>[];
    final firestore = (data['topFirestore'] is List)
        ? (data['topFirestore'] as List)
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList(growable: false)
        : <Map<String, dynamic>>[];

    if (!mounted) return;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF0D0917),
      builder: (sheetContext) => Directionality(
        textDirection: TextDirection.rtl,
        child: SafeArea(
          child: DraggableScrollableSheet(
            expand: false,
            initialChildSize: .82,
            minChildSize: .55,
            maxChildSize: .96,
            builder: (context, controller) => ListView(
              controller: controller,
              padding: const EdgeInsets.all(16),
              children: [
                const Text(
                  'تفاصيل حالة النظام',
                  style: TextStyle(fontSize: 22, fontWeight: FontWeight.w900),
                ),
                const SizedBox(height: 12),
                for (final entry in const [
                  ('5m', 'آخر 5 دقائق'),
                  ('1h', 'آخر ساعة'),
                  ('24h', 'آخر 24 ساعة'),
                ]) ...[
                  _WindowHealthCard(
                    label: entry.$2,
                    data: _map(windows[entry.$1]),
                  ),
                  const SizedBox(height: 8),
                ],
                const SizedBox(height: 8),
                const Text(
                  'أكثر المسارات نشاطًا',
                  style: TextStyle(fontSize: 17, fontWeight: FontWeight.w900),
                ),
                const SizedBox(height: 6),
                if (endpoints.isEmpty)
                  const Text(
                    'لا توجد بيانات كافية ضمن النافذة الحالية.',
                    style: TextStyle(color: Color(0xFFAAA3B8)),
                  )
                else
                  for (final endpoint in endpoints.take(8))
                    ListTile(
                      dense: true,
                      leading: const Icon(Icons.route_outlined),
                      title: Text(
                        (endpoint['route'] ?? '—').toString(),
                        overflow: TextOverflow.ellipsis,
                      ),
                      subtitle: Text(
                        (endpoint['action'] ?? '').toString() +
                            ' • p95 ' +
                            _fmt(_num(endpoint['p95Ms'])) +
                            ' ms',
                      ),
                      trailing: Text(
                        _fmt(_num(endpoint['requests'])) + ' req',
                        style: const TextStyle(fontWeight: FontWeight.w800),
                      ),
                    ),
                const Divider(height: 28),
                const Text(
                  'Firestore — أعلى الموارد',
                  style: TextStyle(fontSize: 17, fontWeight: FontWeight.w900),
                ),
                const SizedBox(height: 6),
                if (firestore.isEmpty)
                  const Text(
                    'لا توجد عمليات Firestore ضمن النافذة الحالية.',
                    style: TextStyle(color: Color(0xFFAAA3B8)),
                  )
                else
                  for (final row in firestore.take(10))
                    ListTile(
                      dense: true,
                      leading: const Icon(Icons.storage_outlined),
                      title: Text(
                        (row['resource'] ?? 'unknown').toString(),
                        overflow: TextOverflow.ellipsis,
                      ),
                      subtitle: Text(
                        (row['operation'] ?? '').toString() +
                            ' • ' +
                            (row['outcome'] ?? '').toString(),
                      ),
                      trailing: Text(
                        'R ' +
                            _fmt(_num(row['reads'])) +
                            ' / W ' +
                            _fmt(_num(row['writes'])),
                      ),
                    ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_loading && _data == null) {
      return const Card(
        child: Padding(
          padding: EdgeInsets.all(18),
          child: Row(
            children: [
              SizedBox(
                width: 22,
                height: 22,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
              SizedBox(width: 12),
              Text('جار قراءة حالة النظام...'),
            ],
          ),
        ),
      );
    }

    final error = _error?.toString() ?? '';
    if (_data == null && error.contains('forbidden')) {
      return const Card(
        child: ListTile(
          leading: Icon(Icons.lock_outline, color: Colors.amberAccent),
          title: Text(
            'حالة النظام',
            style: TextStyle(fontWeight: FontWeight.w900),
          ),
          subtitle: Text(
            'تحتاج صلاحية viewSystemHealth لعرض مقياس الضغط.',
          ),
        ),
      );
    }
    if (_data == null) {
      return Card(
        child: ListTile(
          leading: const Icon(Icons.cloud_off_outlined, color: Colors.orangeAccent),
          title: const Text(
            'حالة النظام غير متاحة',
            style: TextStyle(fontWeight: FontWeight.w900),
          ),
          subtitle: Text(error.isEmpty ? 'تعذر تحميل القياسات.' : error),
          trailing: IconButton(
            tooltip: 'إعادة المحاولة',
            onPressed: () => unawaited(_refresh()),
            icon: const Icon(Icons.refresh_rounded),
          ),
        ),
      );
    }

    final data = _data!;
    final health = _map(data['health']);
    final windows = _map(data['windows']);
    final current = _map(windows['5m']);
    final state = (health['state'] ?? 'unknown').toString();
    final label = (health['label'] ?? 'غير معروف').toString();
    final score = _num(health['score']).round();
    final reasons = health['reasons'] is List
        ? (health['reasons'] as List).map((e) => '$e').toList(growable: false)
        : const <String>[];
    final color = _statusColor(state);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text(
                  _statusEmoji(state),
                  style: const TextStyle(fontSize: 30),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'حالة النظام',
                        style: TextStyle(
                          fontSize: 19,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      Text(
                        '$label • Health Score $score/100',
                        style: TextStyle(
                          color: color,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  tooltip: 'تحديث',
                  onPressed: () => unawaited(_refresh()),
                  icon: const Icon(Icons.refresh_rounded),
                ),
              ],
            ),
            if (reasons.isNotEmpty) ...[
              const SizedBox(height: 8),
              Text(
                reasons.first,
                style: const TextStyle(color: Color(0xFFCBC5D6)),
              ),
            ],
            const SizedBox(height: 14),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                _metric(
                  'Requests/min',
                  _fmt(_num(current['requestsPerMinute']), decimals: 1),
                ),
                _metric(
                  'FS Reads/5m',
                  _fmt(_num(current['firestoreReads'])),
                ),
                _metric(
                  'FS Writes/5m',
                  _fmt(_num(current['firestoreWrites'])),
                ),
                _metric('p95', _fmt(_num(current['p95Ms'])) + ' ms'),
                _metric('429', _fmt(_num(current['status429']))),
                _metric('5xx', _fmt(_num(current['status5xx']))),
                _metric(
                  'Reconnects',
                  _fmt(_num(current['realtimeReconnects'])),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: Text(
                    'تحديث شبه لحظي كل 15 ثانية • بدون Firestore polling للقياسات',
                    style: TextStyle(
                      color: Colors.white.withValues(alpha: .55),
                      fontSize: 11,
                    ),
                  ),
                ),
                TextButton.icon(
                  onPressed: _showDetails,
                  icon: const Icon(Icons.analytics_outlined),
                  label: const Text('التفاصيل'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _WindowHealthCard extends StatelessWidget {
  const _WindowHealthCard({required this.label, required this.data});

  final String label;
  final Map<String, dynamic> data;

  num _num(dynamic value) => value is num ? value : num.tryParse('$value') ?? 0;

  @override
  Widget build(BuildContext context) => Card(
        color: const Color(0xFF151022),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label, style: const TextStyle(fontWeight: FontWeight.w900)),
              const SizedBox(height: 8),
              Wrap(
                spacing: 12,
                runSpacing: 7,
                children: [
                  Text('Req/min ' + _num(data['requestsPerMinute']).toStringAsFixed(1)),
                  Text('p95 ' + _num(data['p95Ms']).round().toString() + 'ms'),
                  Text('p99 ' + _num(data['p99Ms']).round().toString() + 'ms'),
                  Text('429 ' + _num(data['status429']).round().toString()),
                  Text('5xx ' + _num(data['status5xx']).round().toString()),
                  Text('Reads ' + _num(data['firestoreReads']).round().toString()),
                  Text('Writes ' + _num(data['firestoreWrites']).round().toString()),
                  Text('Retries ' + _num(data['firestoreRetries']).round().toString()),
                  Text('Reconnects ' + _num(data['realtimeReconnects']).round().toString()),
                ],
              ),
            ],
          ),
        ),
      );
}
