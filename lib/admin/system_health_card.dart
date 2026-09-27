import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import 'control_api_endpoints.dart';
import 'control_firebase.dart';

class _SystemHealthSnapshot {
  const _SystemHealthSnapshot({
    required this.windowMinutes,
    required this.score,
    required this.level,
    required this.reasons,
    required this.requestsPerMinute,
    required this.firestoreReads,
    required this.firestoreWrites,
    required this.firestoreReadsPerMinute,
    required this.firestoreWritesPerMinute,
    required this.p95Ms,
    required this.p99Ms,
    required this.status429,
    required this.status5xx,
    required this.retries,
    required this.reconnects,
    required this.quotaEvents,
    required this.loadRatio,
  });

  final int windowMinutes;
  final int score;
  final String level;
  final List<String> reasons;
  final double requestsPerMinute;
  final int firestoreReads;
  final int firestoreWrites;
  final double firestoreReadsPerMinute;
  final double firestoreWritesPerMinute;
  final double p95Ms;
  final double p99Ms;
  final int status429;
  final int status5xx;
  final int retries;
  final int reconnects;
  final int quotaEvents;
  final double loadRatio;

  factory _SystemHealthSnapshot.fromJson(Map<String, dynamic> json) {
    int i(dynamic value) => (num.tryParse('$value') ?? 0).round();
    double d(dynamic value) => (num.tryParse('$value') ?? 0).toDouble();
    return _SystemHealthSnapshot(
      windowMinutes: i(json['windowMinutes']),
      score: i(json['score']),
      level: '${json['level'] ?? 'unknown'}',
      reasons: json['reasons'] is List
          ? (json['reasons'] as List).map((e) => '$e').toList(growable: false)
          : const <String>[],
      requestsPerMinute: d(json['requestsPerMinute']),
      firestoreReads: i(json['firestoreReads']),
      firestoreWrites: i(json['firestoreWrites']),
      firestoreReadsPerMinute: d(json['firestoreReadsPerMinute']),
      firestoreWritesPerMinute: d(json['firestoreWritesPerMinute']),
      p95Ms: d(json['p95Ms']),
      p99Ms: d(json['p99Ms']),
      status429: i(json['status429']),
      status5xx: i(json['status5xx']),
      retries: i(json['retries']),
      reconnects: i(json['reconnects']),
      quotaEvents: i(json['quotaEvents']),
      loadRatio: d(json['loadRatio']),
    );
  }
}

class ControlSystemHealthCard extends StatefulWidget {
  const ControlSystemHealthCard({super.key});

  @override
  State<ControlSystemHealthCard> createState() => _ControlSystemHealthCardState();
}

class _ControlSystemHealthCardState extends State<ControlSystemHealthCard> {
  Timer? _timer;
  _SystemHealthSnapshot? _snapshot;
  bool _loading = true;
  String? _error;

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

  Future<_SystemHealthSnapshot> _fetch(int minutes) async {
    final user = controlAuth.currentUser;
    if (user == null) throw Exception('not_signed_in');
    final token = await user.getIdToken().timeout(const Duration(seconds: 12));
    if (token == null || token.isEmpty) throw Exception('empty_token');
    final response = await http.get(
      shadowApiEndpoint(
        'system-health',
        queryParameters: <String, String>{'minutes': '$minutes'},
      ),
      headers: <String, String>{'Authorization': 'Bearer $token'},
    ).timeout(const Duration(seconds: 20));
    final body = response.body.isEmpty
        ? <String, dynamic>{}
        : jsonDecode(response.body) as Map<String, dynamic>;
    if (response.statusCode < 200 || response.statusCode >= 300 || body['ok'] != true) {
      throw Exception('${body['code'] ?? 'system_health_failed'}');
    }
    return _SystemHealthSnapshot.fromJson(body);
  }

  Future<void> _refresh({bool silent = false}) async {
    if (!silent && mounted) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }
    try {
      final next = await _fetch(5);
      if (!mounted) return;
      setState(() {
        _snapshot = next;
        _loading = false;
        _error = null;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = error.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  Color _color(String level) => switch (level) {
        'green' => Colors.greenAccent,
        'yellow' => Colors.amberAccent,
        'red' => Colors.redAccent,
        _ => Colors.blueGrey,
      };

  String _label(String level) => switch (level) {
        'green' => 'طبيعي',
        'yellow' => 'ضغط متوسط',
        'red' => 'ضغط عالي',
        _ => 'غير متاح',
      };

  Widget _metric(String label, String value) => Container(
        constraints: const BoxConstraints(minWidth: 118),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: .035),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: Colors.white10),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label, style: const TextStyle(fontSize: 11, color: Color(0xFFAAA3B8))),
            const SizedBox(height: 3),
            Text(value, style: const TextStyle(fontWeight: FontWeight.w900)),
          ],
        ),
      );

  Future<void> _openDetails() async {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF0D0917),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(26)),
      ),
      builder: (sheetContext) => Directionality(
        textDirection: TextDirection.rtl,
        child: FutureBuilder<List<_SystemHealthSnapshot>>(
          future: Future.wait(<Future<_SystemHealthSnapshot>>[
            _fetch(5),
            _fetch(60),
            _fetch(1440),
          ]),
          builder: (context, snap) => SafeArea(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 14, 16, 24),
              child: SingleChildScrollView(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Center(
                      child: Container(
                        width: 44,
                        height: 4,
                        decoration: BoxDecoration(
                          color: Colors.white24,
                          borderRadius: BorderRadius.circular(99),
                        ),
                      ),
                    ),
                    const SizedBox(height: 14),
                    const Text(
                      'تفاصيل ضغط النظام',
                      style: TextStyle(fontSize: 21, fontWeight: FontWeight.w900),
                    ),
                    const SizedBox(height: 6),
                    const Text(
                      'قراءة من Pressure Analytics. لا توجد استعلامات Firestore عالية التكرار من هذه الواجهة.',
                      style: TextStyle(color: Color(0xFFAAA3B8)),
                    ),
                    const SizedBox(height: 14),
                    if (snap.connectionState == ConnectionState.waiting)
                      const Center(
                        child: Padding(
                          padding: EdgeInsets.all(28),
                          child: CircularProgressIndicator(),
                        ),
                      )
                    else if (snap.hasError)
                      Text(
                        'تعذر تحميل التفاصيل: ${snap.error}',
                        style: const TextStyle(color: Colors.orangeAccent),
                      )
                    else
                      ...?snap.data?.map(_detailsCard),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _detailsCard(_SystemHealthSnapshot s) {
    final title = s.windowMinutes == 5
        ? 'آخر 5 دقائق'
        : s.windowMinutes == 60
            ? 'آخر ساعة'
            : 'آخر 24 ساعة';
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              Icon(Icons.circle, size: 13, color: _color(s.level)),
              const SizedBox(width: 7),
              Expanded(child: Text(title, style: const TextStyle(fontWeight: FontWeight.w900))),
              Text('${s.score}/100', style: TextStyle(color: _color(s.level), fontWeight: FontWeight.w900)),
            ]),
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                _metric('Requests/min', s.requestsPerMinute.toStringAsFixed(2)),
                _metric('Reads/min', s.firestoreReadsPerMinute.toStringAsFixed(2)),
                _metric('Writes/min', s.firestoreWritesPerMinute.toStringAsFixed(2)),
                _metric('p95', '${s.p95Ms.toStringAsFixed(0)} ms'),
                _metric('p99', '${s.p99Ms.toStringAsFixed(0)} ms'),
                _metric('429', '${s.status429}'),
                _metric('5xx', '${s.status5xx}'),
                _metric('Retries', '${s.retries}'),
                _metric('Reconnects', '${s.reconnects}'),
                _metric('Quota', '${s.quotaEvents}'),
                _metric('Load/Baseline', '${s.loadRatio.toStringAsFixed(2)}×'),
              ],
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final snapshot = _snapshot;
    final color = snapshot == null ? Colors.blueGrey : _color(snapshot.level);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              Icon(Icons.monitor_heart_outlined, color: color),
              const SizedBox(width: 8),
              const Expanded(
                child: Text(
                  'حالة النظام',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900),
                ),
              ),
              if (_loading)
                const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              else
                IconButton(
                  tooltip: 'تحديث',
                  onPressed: () => unawaited(_refresh()),
                  icon: const Icon(Icons.refresh_rounded),
                ),
            ]),
            const SizedBox(height: 8),
            if (_error != null && snapshot == null)
              Text(
                _error == 'forbidden'
                    ? 'لا توجد صلاحية viewSystemHealth لهذا الحساب.'
                    : 'تعذر قراءة حالة النظام: $_error',
                style: const TextStyle(color: Colors.orangeAccent),
              )
            else if (snapshot != null) ...[
              Row(
                children: [
                  Container(
                    width: 18,
                    height: 18,
                    decoration: BoxDecoration(color: color, shape: BoxShape.circle),
                  ),
                  const SizedBox(width: 9),
                  Text(
                    _label(snapshot.level),
                    style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900, color: color),
                  ),
                  const Spacer(),
                  Text(
                    '${snapshot.score}/100',
                    style: TextStyle(fontSize: 25, fontWeight: FontWeight.w900, color: color),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Text(
                snapshot.reasons.join(' • '),
                style: const TextStyle(color: Color(0xFFCBC5D6)),
              ),
              const SizedBox(height: 12),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  _metric('Requests/min', snapshot.requestsPerMinute.toStringAsFixed(2)),
                  _metric('Reads/min', snapshot.firestoreReadsPerMinute.toStringAsFixed(2)),
                  _metric('Writes/min', snapshot.firestoreWritesPerMinute.toStringAsFixed(2)),
                  _metric('p95', '${snapshot.p95Ms.toStringAsFixed(0)} ms'),
                  _metric('429', '${snapshot.status429}'),
                  _metric('5xx', '${snapshot.status5xx}'),
                  _metric('Retries', '${snapshot.retries}'),
                  _metric('Reconnects', '${snapshot.reconnects}'),
                ],
              ),
              const SizedBox(height: 12),
              Row(children: [
                const Expanded(
                  child: Text(
                    'تحديث تلقائي كل 15 ثانية • نافذة 5 دقائق',
                    style: TextStyle(fontSize: 11, color: Color(0xFFAAA3B8)),
                  ),
                ),
                TextButton.icon(
                  onPressed: _openDetails,
                  icon: const Icon(Icons.analytics_outlined),
                  label: const Text('التفاصيل'),
                ),
              ]),
            ],
          ],
        ),
      ),
    );
  }
}
