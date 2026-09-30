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

  Color _statusColor(String state) {
    if (state == 'green') return Colors.greenAccent;
    if (state == 'yellow') return Colors.amberAccent;
    if (state == 'red') return Colors.redAccent;
    return Colors.blueGrey;
  }

  String _statusEmoji(String state) {
    if (state == 'green') return '🟢';
    if (state == 'yellow') return '🟡';
    if (state == 'red') return '🔴';
    return '⚪';
  }

  String _statusHeadline(String state) {
    if (state == 'green') return 'لا يوجد ضغط حاليًا';
    if (state == 'yellow') return 'يوجد بطء يحتاج مراقبة';
    if (state == 'red') return 'يوجد ضغط يحتاج تدخل';
    return 'الحالة غير واضحة حاليًا';
  }

  String _statusAction(String state) {
    if (state == 'green') {
      return 'لا تحتاج لأي إجراء الآن. فقط راقب المؤشر العام.';
    }
    if (state == 'yellow') {
      return 'راقب زمن الاستجابة والأخطاء. إذا بقيت الحالة صفراء افتح التفاصيل.';
    }
    if (state == 'red') {
      return 'افتح التفاصيل الآن وحدد أبطأ مسار وأي أخطاء 5xx أو 429.';
    }
    return 'حدّث القياسات ثم راجع التفاصيل إذا استمرت الحالة غير واضحة.';
  }

  String _humanReason(String reason) {
    final value = reason.trim();
    if (value.isEmpty) return 'لا توجد ملاحظة إضافية.';
    if (value == 'All monitored pressure indicators are within target') {
      return 'كل مؤشرات الضغط التي نراقبها ضمن الحدود الطبيعية.';
    }
    if (value.startsWith('slowest active path:')) {
      return 'أبطأ مسار حاليًا: ' +
          value.substring('slowest active path:'.length).trim();
    }
    if (value.startsWith('p95 high at ')) {
      return 'زمن الاستجابة مرتفع حاليًا: ' +
          value.substring('p95 high at '.length);
    }
    if (value.startsWith('p95 elevated at ')) {
      return 'زمن الاستجابة أعلى من المعتاد: ' +
          value.substring('p95 elevated at '.length);
    }
    if (value.startsWith('p95 above target at ')) {
      return 'زمن الاستجابة فوق الهدف قليلًا: ' +
          value.substring('p95 above target at '.length);
    }
    if (value.startsWith('p99 high at ')) {
      return 'أبطأ الطلبات مرتفعة جدًا: ' +
          value.substring('p99 high at '.length);
    }
    if (value.startsWith('p99 elevated at ')) {
      return 'أبطأ الطلبات أعلى من المعتاد: ' +
          value.substring('p99 elevated at '.length);
    }
    if (value.startsWith('HTTP 429 detected')) {
      return 'ظهر تقييد 429؛ هذا يعني ضغطًا أو بلوغ حد مؤقت.';
    }
    if (value.contains('HTTP 5xx') || value.startsWith('5xx rate ')) {
      return 'ظهرت أخطاء من الخادم وتحتاج متابعة.';
    }
    if (value.startsWith('retry rate ')) {
      return 'زادت إعادة المحاولة عن الطبيعي.';
    }
    if (value.startsWith('reconnect rate ')) {
      return 'إعادة الاتصال أعلى من الطبيعي.';
    }
    if (value.startsWith('traffic ')) {
      return 'حجم الطلبات أعلى من المعدل المعتاد: ' +
          value.substring('traffic '.length);
    }
    if (value.startsWith('Firestore reads ')) {
      return 'قراءات Firestore أعلى من المعدل المعتاد: ' +
          value.substring('Firestore reads '.length);
    }
    if (value.startsWith('Firestore writes ')) {
      return 'كتابات Firestore أعلى من المعدل المعتاد: ' +
          value.substring('Firestore writes '.length);
    }
    return value;
  }

  String _latencyHint(num p95) {
    if (p95 <= 0) return 'لا توجد طلبات كافية للقياس الآن';
    if (p95 < 800) return 'سريع وضمن الهدف';
    if (p95 < 1500) return 'أعلى من الهدف قليلًا';
    if (p95 < 3000) return 'بطيء ويحتاج مراقبة';
    return 'بطيء جدًا ويحتاج انتباه';
  }

  Color _latencyColor(num p95) {
    if (p95 <= 0 || p95 < 800) return Colors.greenAccent;
    if (p95 < 3000) return Colors.amberAccent;
    return Colors.redAccent;
  }

  Widget _metric(
    String label,
    String value,
    String help, {
    Color? valueColor,
  }) =>
      Container(
        constraints: const BoxConstraints(minWidth: 128),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: .04),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: Colors.white12),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              label,
              style: const TextStyle(
                color: Color(0xFFAAA3B8),
                fontSize: 11,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 3),
            Text(
              value,
              style: TextStyle(
                color: valueColor,
                fontWeight: FontWeight.w900,
                fontSize: 17,
              ),
            ),
            const SizedBox(height: 3),
            Text(
              help,
              style: TextStyle(
                color: Colors.white.withValues(alpha: .58),
                fontSize: 10.5,
                height: 1.25,
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
            initialChildSize: .9,
            minChildSize: .6,
            maxChildSize: .97,
            builder: (context, controller) => ListView(
              controller: controller,
              padding: const EdgeInsets.all(16),
              children: [
                const Text(
                  'تقرير حالة النظام',
                  style: TextStyle(fontSize: 22, fontWeight: FontWeight.w900),
                ),
                const SizedBox(height: 6),
                const Text(
                  'اقرأ اللون أولًا: الأخضر طبيعي، الأصفر يحتاج مراقبة، '
                  'والأحمر يحتاج تدخل. ركّز على زمن الاستجابة و5xx و429 '
                  'وإعادة الاتصال؛ أما عدد الطلبات والقراءات والكتابات فهو '
                  'حجم استخدام ولا يعني وجود مشكلة لوحده.',
                  style: TextStyle(
                    color: Color(0xFFCBC5D6),
                    height: 1.45,
                  ),
                ),
                const SizedBox(height: 14),
                const _GuideCard(),
                const SizedBox(height: 14),
                const Text(
                  'ماذا حدث عبر الوقت؟',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900),
                ),
                const SizedBox(height: 8),
                for (final entry in const [
                  ('5m', 'الآن — آخر 5 دقائق'),
                  ('1h', 'آخر ساعة'),
                  ('24h', 'آخر 24 ساعة'),
                ]) ...[
                  _WindowHealthCard(
                    label: entry.$2,
                    data: _map(windows[entry.$1]),
                  ),
                  const SizedBox(height: 8),
                ],
                const SizedBox(height: 10),
                const Text(
                  'أكثر المسارات نشاطًا',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900),
                ),
                const SizedBox(height: 4),
                const Text(
                  'هذا القسم يساعدك تعرف أي مسار كان أبطأ أو أكثر استخدامًا. '
                  'وجود مسار هنا لا يعني أنه مشكلة تلقائيًا.',
                  style: TextStyle(color: Color(0xFFAAA3B8), height: 1.35),
                ),
                const SizedBox(height: 8),
                if (endpoints.isEmpty)
                  const _InfoMessage(
                    icon: Icons.check_circle_outline,
                    text:
                        'النشاط الحالي منخفض، لذلك لا يوجد مسار بارز يحتاج مراقبة الآن.',
                  )
                else
                  for (final endpoint in endpoints.take(8))
                    ListTile(
                      dense: true,
                      contentPadding: EdgeInsets.zero,
                      leading: const Icon(Icons.route_outlined),
                      title: Text(
                        (endpoint['route'] ?? '—').toString(),
                        overflow: TextOverflow.ellipsis,
                      ),
                      subtitle: Text(
                        'الإجراء: ' +
                            (endpoint['action'] ?? '—').toString() +
                            ' • زمن p95: ' +
                            _fmt(_num(endpoint['p95Ms'])) +
                            ' ms',
                      ),
                      trailing: Text(
                        _fmt(_num(endpoint['requests'])) + ' طلب',
                        style: const TextStyle(fontWeight: FontWeight.w800),
                      ),
                    ),
                const Divider(height: 30),
                const Text(
                  'استهلاك Firestore',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900),
                ),
                const SizedBox(height: 4),
                const Text(
                  'هذه أرقام تشخيصية لمعرفة أين تذهب القراءات والكتابات. '
                  'لا تعتبرها مشكلة لمجرد أنها موجودة؛ المشكلة تظهر عندما '
                  'ترتفع مع بطء أو أخطاء أو 429.',
                  style: TextStyle(color: Color(0xFFAAA3B8), height: 1.35),
                ),
                const SizedBox(height: 8),
                if (firestore.isEmpty)
                  const _InfoMessage(
                    icon: Icons.storage_outlined,
                    text: 'لا توجد عمليات Firestore بارزة ضمن النافذة الحالية.',
                  )
                else
                  for (final row in firestore.take(10))
                    ListTile(
                      dense: true,
                      contentPadding: EdgeInsets.zero,
                      leading: const Icon(Icons.storage_outlined),
                      title: Text(
                        (row['resource'] ?? 'unknown').toString(),
                        overflow: TextOverflow.ellipsis,
                      ),
                      subtitle: Text(
                        'العملية: ' +
                            (row['operation'] ?? '—').toString() +
                            ' • النتيجة: ' +
                            (row['outcome'] ?? '—').toString(),
                      ),
                      trailing: Text(
                        'قراءة ' +
                            _fmt(_num(row['reads'])) +
                            '\nكتابة ' +
                            _fmt(_num(row['writes'])),
                        textAlign: TextAlign.center,
                        style: const TextStyle(fontSize: 11),
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

    final p95 = _num(current['p95Ms']);
    final status429 = _num(current['status429']);
    final status5xx = _num(current['status5xx']);
    final reconnects = _num(current['realtimeReconnects']);

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
                  style: const TextStyle(fontSize: 34),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'حالة النظام الآن',
                        style: TextStyle(
                          fontSize: 19,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      Text(
                        _statusHeadline(state),
                        style: TextStyle(
                          color: color,
                          fontSize: 16,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      Text(
                        'المؤشر العام: $score/100 • $label',
                        style: const TextStyle(
                          color: Color(0xFFAAA3B8),
                          fontSize: 11,
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
            const SizedBox(height: 12),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: color.withValues(alpha: .08),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: color.withValues(alpha: .28)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'هل تحتاج تتدخل؟',
                    style: TextStyle(fontWeight: FontWeight.w900),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    _statusAction(state),
                    style: const TextStyle(height: 1.35),
                  ),
                  if (reasons.isNotEmpty) ...[
                    const SizedBox(height: 8),
                    Text(
                      'السبب: ' + _humanReason(reasons.first),
                      style: const TextStyle(
                        color: Color(0xFFCBC5D6),
                        fontSize: 12,
                        height: 1.35,
                      ),
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(height: 14),
            const Text(
              'المؤشرات التي لازم تراقبها',
              style: TextStyle(fontWeight: FontWeight.w900),
            ),
            const SizedBox(height: 4),
            const Text(
              'إذا بقيت هذه المؤشرات طبيعية، لا تهتم بباقي الأرقام.',
              style: TextStyle(color: Color(0xFFAAA3B8), fontSize: 11),
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                _metric(
                  'زمن الاستجابة',
                  _fmt(p95) + ' ms',
                  _latencyHint(p95),
                  valueColor: _latencyColor(p95),
                ),
                _metric(
                  'أخطاء الخادم 5xx',
                  _fmt(status5xx),
                  status5xx == 0
                      ? 'ممتاز — الأفضل دائمًا 0'
                      : 'يوجد خطأ خادم ويحتاج متابعة',
                  valueColor:
                      status5xx == 0 ? Colors.greenAccent : Colors.redAccent,
                ),
                _metric(
                  'تقييد 429',
                  _fmt(status429),
                  status429 == 0
                      ? 'ممتاز — لا يوجد تقييد'
                      : 'ضغط أو بلوغ حد مؤقت',
                  valueColor:
                      status429 == 0 ? Colors.greenAccent : Colors.redAccent,
                ),
                _metric(
                  'إعادة الاتصال',
                  _fmt(reconnects),
                  reconnects == 0
                      ? 'الاتصال مستقر'
                      : 'راقب استقرار الاتصال',
                  valueColor:
                      reconnects == 0 ? Colors.greenAccent : Colors.amberAccent,
                ),
              ],
            ),
            const SizedBox(height: 14),
            const Text(
              'حجم الاستخدام الحالي',
              style: TextStyle(fontWeight: FontWeight.w900),
            ),
            const SizedBox(height: 4),
            const Text(
              'هذه الأرقام لا تعني ضغطًا لوحدها؛ هي فقط توضح حجم النشاط.',
              style: TextStyle(color: Color(0xFFAAA3B8), fontSize: 11),
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                _metric(
                  'الطلبات بالدقيقة',
                  _fmt(
                    _num(current['requestsPerMinute']),
                    decimals: 1,
                  ),
                  'عدد طلبات الخادم',
                ),
                _metric(
                  'قراءات Firestore',
                  _fmt(
                    _num(current['firestoreReadsPerMinute']),
                    decimals: 1,
                  ) + '/دقيقة',
                  'قراءة بيانات من القاعدة',
                ),
                _metric(
                  'كتابات Firestore',
                  _fmt(
                    _num(current['firestoreWritesPerMinute']),
                    decimals: 1,
                  ) + '/دقيقة',
                  'تحديثات على قاعدة البيانات',
                ),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: Text(
                    'يتحدث كل 15 ثانية • بدون polling على Firestore للقياسات',
                    style: TextStyle(
                      color: Colors.white.withValues(alpha: .55),
                      fontSize: 11,
                    ),
                  ),
                ),
                TextButton.icon(
                  onPressed: _showDetails,
                  icon: const Icon(Icons.analytics_outlined),
                  label: const Text('شرح وتفاصيل'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
}

class _WindowHealthCard extends StatelessWidget {
  const _WindowHealthCard({required this.label, required this.data});

  final String label;
  final Map<String, dynamic> data;

  num _num(dynamic value) =>
      value is num ? value : num.tryParse('$value') ?? 0;

  Color _stateColor() {
    final p95 = _num(data['p95Ms']);
    final status429 = _num(data['status429']);
    final status5xx = _num(data['status5xx']);
    if (status429 > 0 || status5xx > 0 || p95 >= 3000) {
      return Colors.redAccent;
    }
    if (p95 >= 800 || _num(data['realtimeReconnects']) > 0) {
      return Colors.amberAccent;
    }
    return Colors.greenAccent;
  }

  String _summary() {
    final requests = _num(data['requestsPerMinute']);
    final p95 = _num(data['p95Ms']);
    final status429 = _num(data['status429']);
    final status5xx = _num(data['status5xx']);
    final reconnects = _num(data['realtimeReconnects']);

    if (requests <= 0 && p95 <= 0 && status429 <= 0 && status5xx <= 0) {
      return 'لا يوجد نشاط طلبات كافٍ الآن؛ لا توجد علامة ضغط من هذه الفترة.';
    }
    if (status429 > 0) {
      return 'ظهر تقييد 429 خلال هذه الفترة؛ هذا أهم شيء يحتاج انتباه.';
    }
    if (status5xx > 0) {
      return 'ظهرت أخطاء خادم خلال هذه الفترة وتحتاج متابعة.';
    }
    if (p95 >= 3000) {
      return 'ظهر بطء واضح خلال هذه الفترة، حتى لو كانت الحالة الحالية أفضل.';
    }
    if (p95 >= 800) {
      return 'ظهر بطء بسيط أو متوسط خلال هذه الفترة.';
    }
    if (reconnects > 0) {
      return 'السرعة جيدة عمومًا، لكن حدثت إعادة اتصال.';
    }
    return 'المؤشرات ضمن الطبيعي في هذه الفترة.';
  }

  Widget _line(IconData icon, String title, String value, String help) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, size: 18, color: const Color(0xFFBDB5CB)),
            const SizedBox(width: 8),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          title,
                          style: const TextStyle(fontWeight: FontWeight.w800),
                        ),
                      ),
                      Text(
                        value,
                        style: const TextStyle(fontWeight: FontWeight.w900),
                      ),
                    ],
                  ),
                  Text(
                    help,
                    style: const TextStyle(
                      color: Color(0xFFAAA3B8),
                      fontSize: 10.5,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      );

  @override
  Widget build(BuildContext context) {
    final color = _stateColor();
    final requests = _num(data['requestsPerMinute']);
    final p95 = _num(data['p95Ms']);
    final p99 = _num(data['p99Ms']);
    final status429 = _num(data['status429']);
    final status5xx = _num(data['status5xx']);
    final reconnects = _num(data['realtimeReconnects']);
    final retries = _num(data['firestoreRetries']);
    final reads = _num(data['firestoreReadsPerMinute']);
    final writes = _num(data['firestoreWritesPerMinute']);

    return Card(
      color: const Color(0xFF151022),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 10,
                  height: 10,
                  decoration: BoxDecoration(
                    color: color,
                    shape: BoxShape.circle,
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    label,
                    style: const TextStyle(fontWeight: FontWeight.w900),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 7),
            Text(
              _summary(),
              style: TextStyle(color: color, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 10),
            _line(
              Icons.speed_outlined,
              'زمن معظم الطلبات (p95)',
              p95.round().toString() + ' ms',
              'الأهم للسرعة؛ كلما قل كان أفضل.',
            ),
            _line(
              Icons.warning_amber_rounded,
              'أخطاء الخادم',
              status5xx.round().toString(),
              '5xx — الأفضل أن يبقى 0.',
            ),
            _line(
              Icons.block_outlined,
              'تقييد الطلبات',
              status429.round().toString(),
              '429 — الأفضل أن يبقى 0.',
            ),
            _line(
              Icons.wifi_tethering_error_rounded,
              'إعادة الاتصال',
              reconnects.round().toString(),
              'ارتفاعه قد يدل على عدم استقرار الاتصال.',
            ),
            const Divider(height: 20),
            const Text(
              'معلومات إضافية',
              style: TextStyle(fontWeight: FontWeight.w900, fontSize: 12),
            ),
            const SizedBox(height: 6),
            Text(
              'أبطأ 1% تقريبًا (p99): ' +
                  p99.round().toString() +
                  ' ms • إعادة محاولات Firestore: ' +
                  retries.round().toString(),
              style: const TextStyle(
                color: Color(0xFFAAA3B8),
                fontSize: 11,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              'حجم الاستخدام: ' +
                  requests.toStringAsFixed(1) +
                  ' طلب/دقيقة • ' +
                  reads.toStringAsFixed(1) +
                  ' قراءة/دقيقة • ' +
                  writes.toStringAsFixed(1) +
                  ' كتابة/دقيقة',
              style: const TextStyle(
                color: Color(0xFFAAA3B8),
                fontSize: 11,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _GuideCard extends StatelessWidget {
  const _GuideCard();

  Widget _item(Color color, String title, String text) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 10,
              height: 10,
              margin: const EdgeInsets.only(top: 4),
              decoration: BoxDecoration(color: color, shape: BoxShape.circle),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: RichText(
                text: TextSpan(
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 12,
                    height: 1.35,
                  ),
                  children: [
                    TextSpan(
                      text: title + ': ',
                      style: const TextStyle(fontWeight: FontWeight.w900),
                    ),
                    TextSpan(
                      text: text,
                      style: const TextStyle(color: Color(0xFFCBC5D6)),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      );

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: .035),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: Colors.white12),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'كيف أقرأ التقرير؟',
              style: TextStyle(fontWeight: FontWeight.w900),
            ),
            const SizedBox(height: 6),
            _item(
              Colors.greenAccent,
              'أخضر',
              'الوضع طبيعي ولا تحتاج لأي إجراء.',
            ),
            _item(
              Colors.amberAccent,
              'أصفر',
              'يوجد بطء أو مؤشر يحتاج مراقبة.',
            ),
            _item(
              Colors.redAccent,
              'أحمر',
              'يوجد ضغط أو خطأ يحتاج تدخل.',
            ),
          ],
        ),
      );
}

class _InfoMessage extends StatelessWidget {
  const _InfoMessage({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: .035),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: Colors.white12),
        ),
        child: Row(
          children: [
            Icon(icon, color: Colors.greenAccent),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                text,
                style: const TextStyle(
                  color: Color(0xFFCBC5D6),
                  height: 1.35,
                ),
              ),
            ),
          ],
        ),
      );
}

