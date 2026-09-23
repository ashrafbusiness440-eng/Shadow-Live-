import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import '../utils/compact_number.dart';
import 'control_api_endpoints.dart';

class GamesControlPage extends StatefulWidget {
  const GamesControlPage({super.key});

  @override
  State<GamesControlPage> createState() => _GamesControlPageState();
}

class _GamesControlPageState extends State<GamesControlPage> {
  bool loading = true;
  bool savingTiming = false;
  String? error;

  final reason = TextEditingController(text: 'تحديث إعدادات الألعاب');
  final timezone = TextEditingController(text: '240');
  final roundDuration = TextEditingController(text: '30');
  final lockBefore = TextEditingController(text: '3000');

  List<Map<String, dynamic>> variants = [];
  Map<String, Map<String, dynamic>> stats = {};
  List<Map<String, dynamic>> audit = [];

  @override
  void initState() {
    super.initState();
    load();
  }

  @override
  void dispose() {
    reason.dispose();
    timezone.dispose();
    roundDuration.dispose();
    lockBefore.dispose();
    super.dispose();
  }

  Future<Map<String, dynamic>> post(Map<String, dynamic> payload) async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) throw StateError('not_signed_in');
    final token = await user.getIdToken();
    if (token == null || token.isEmpty) throw StateError('empty_token');
    final response = await http
        .post(
          shadowEconomyEndpoint('game-control'),
          headers: {
            'content-type': 'application/json',
            'authorization': 'Bearer $token',
          },
          body: jsonEncode(payload),
        )
        .timeout(const Duration(seconds: 25));
    final body = response.body.isEmpty
        ? <String, dynamic>{}
        : Map<String, dynamic>.from(jsonDecode(response.body) as Map);
    if (response.statusCode < 200 ||
        response.statusCode >= 300 ||
        body['ok'] != true) {
      throw StateError((body['code'] ?? 'request_failed').toString());
    }
    return body;
  }

  Future<void> load() async {
    if (mounted) {
      setState(() {
        loading = true;
        error = null;
      });
    }
    try {
      final body = await post({'action': 'state'});
      final config = body['config'] is Map
          ? Map<String, dynamic>.from(body['config'] as Map)
          : <String, dynamic>{};
      final rawVariants = body['variants'] is List
          ? (body['variants'] as List)
              .whereType<Map>()
              .map((e) => Map<String, dynamic>.from(e))
              .toList()
          : <Map<String, dynamic>>[];
      final rawStats = body['stats'] is List
          ? (body['stats'] as List)
              .whereType<Map>()
              .map((e) => Map<String, dynamic>.from(e))
              .toList()
          : <Map<String, dynamic>>[];
      final rawAudit = body['audit'] is List
          ? (body['audit'] as List)
              .whereType<Map>()
              .map((e) => Map<String, dynamic>.from(e))
              .toList()
          : <Map<String, dynamic>>[];

      if (!mounted) return;
      setState(() {
        timezone.text = (config['timezoneOffsetMinutes'] ?? 240).toString();
        roundDuration.text =
            (config['roundDurationSeconds'] ?? 30).toString();
        lockBefore.text = (config['lockBeforeMs'] ?? 3000).toString();
        variants = rawVariants;
        stats = {
          for (final item in rawStats)
            (item['key'] ?? '').toString(): item,
        };
        audit = rawAudit;
        loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        loading = false;
        error = e.toString();
      });
    }
  }

  String formatOutcomes(List<dynamic> raw) {
    return raw
        .whereType<Map>()
        .map((item) =>
            '${item['id'] ?? ''}=${item['weightBps'] ?? 0}')
        .join('\n');
  }

  List<Map<String, dynamic>> parseOutcomes(String text) {
    final result = <Map<String, dynamic>>[];
    for (final rawLine in text.split('\n')) {
      final line = rawLine.trim();
      if (line.isEmpty) continue;
      final parts = line.split('=');
      if (parts.length != 2) throw const FormatException('صيغة الاحتمالات');
      final id = parts.first.trim();
      final weight = int.tryParse(parts.last.trim());
      if (id.isEmpty || weight == null || weight <= 0) {
        throw const FormatException('قيمة احتمال غير صالحة');
      }
      result.add({'id': id, 'weightBps': weight});
    }
    return result;
  }

  List<int> parseBets(String text) {
    final result = text
        .split(',')
        .map((e) => int.tryParse(e.trim()))
        .whereType<int>()
        .toList();
    if (result.isEmpty) throw const FormatException('سلم الرهانات فارغ');
    return result;
  }

  Future<void> saveTiming() async {
    final why = reason.text.trim();
    if (why.length < 3) return;
    setState(() => savingTiming = true);
    try {
      await post({
        'action': 'saveTiming',
        'timezoneOffsetMinutes': int.tryParse(timezone.text.trim()),
        'roundDurationSeconds': int.tryParse(roundDuration.text.trim()),
        'lockBeforeMs': int.tryParse(lockBefore.text.trim()),
        'reason': why,
      });
      await load();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تم حفظ توقيت الألعاب وتسجيل Audit Log.')),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('تعذر الحفظ: $e')),
      );
    } finally {
      if (mounted) setState(() => savingTiming = false);
    }
  }

  Future<void> saveVariant(
    Map<String, dynamic> variant, {
    required bool enabled,
    required String rtpText,
    required String betsText,
    required String outcomesText,
  }) async {
    final why = reason.text.trim();
    if (why.length < 3) return;
    try {
      final rtpPercent = double.tryParse(rtpText.trim());
      if (rtpPercent == null) throw const FormatException('RTP غير صالح');
      final outcomes = parseOutcomes(outcomesText);
      final sum = outcomes.fold<int>(
        0,
        (value, item) => value + (item['weightBps'] as int),
      );
      if (enabled && sum != 10000) {
        throw const FormatException('مجموع الاحتمالات يجب أن يساوي 10000');
      }
      await post({
        'action': 'saveVariant',
        'key': variant['key'],
        'enabled': enabled,
        'targetRtpBps': (rtpPercent * 100).round(),
        'bets': parseBets(betsText),
        'outcomes': outcomes,
        'reason': why,
      });
      await load();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'تم حفظ ${variant['nameAr']} وتسجيل Audit Log.',
          ),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('تعذر الحفظ: $e')),
      );
    }
  }

  Widget statChip(String label, String value) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: .04),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: Colors.white.withValues(alpha: .08)),
        ),
        child: Text(
          '$label: $value',
          style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12),
        ),
      );

  Widget gameCard(Map<String, dynamic> variant) {
    final key = (variant['key'] ?? '').toString();
    final stat = stats[key] ?? const <String, dynamic>{};
    final enabled = variant['enabled'] == true;
    final rtp = (NumberHelper.toDouble(variant['targetRtpBps']) / 100)
        .toStringAsFixed(2);
    final bets = (variant['bets'] is List
            ? (variant['bets'] as List)
            : const <dynamic>[])
        .join(',');
    final outcomes = formatOutcomes(
      variant['outcomes'] is List
          ? variant['outcomes'] as List
          : const <dynamic>[],
    );

    return _GameConfigCard(
      key: ValueKey(key),
      variant: variant,
      initialEnabled: enabled,
      initialRtp: rtp,
      initialBets: bets,
      initialOutcomes: outcomes,
      stats: stat,
      statChip: statChip,
      onSave: ({
        required bool enabled,
        required String rtp,
        required String bets,
        required String outcomes,
      }) =>
          saveVariant(
        variant,
        enabled: enabled,
        rtpText: rtp,
        betsText: bets,
        outcomesText: outcomes,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Games Control'),
        actions: [
          IconButton(onPressed: load, icon: const Icon(Icons.refresh_rounded)),
        ],
      ),
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : error != null
              ? Center(child: Text('تعذر التحميل: $error'))
              : ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    const Card(
                      child: ListTile(
                        leading: Icon(
                          Icons.sports_esports_rounded,
                          color: Color(0xFFD7B85A),
                        ),
                        title: Text(
                          'إدارة الألعاب المستقلة',
                          style: TextStyle(fontWeight: FontWeight.w900),
                        ),
                        subtitle: Text(
                          'كل لعبة/وضع مستقل: تشغيل وإيقاف، RTP، سلم الرهانات، الاحتمالات والإحصاءات. لا يوجد فرض نتيجة لاعب من لوحة الإنتاج.',
                        ),
                      ),
                    ),
                    const SizedBox(height: 8),
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(14),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            const Text(
                              'توقيت الجولات الجماعية',
                              style: TextStyle(
                                fontSize: 18,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                            const SizedBox(height: 10),
                            Wrap(
                              spacing: 10,
                              runSpacing: 10,
                              children: [
                                SizedBox(
                                  width: 180,
                                  child: TextField(
                                    controller: timezone,
                                    keyboardType: TextInputType.number,
                                    decoration: const InputDecoration(
                                      labelText: 'Timezone offset بالدقائق',
                                      hintText: '240 = الإمارات',
                                      border: OutlineInputBorder(),
                                    ),
                                  ),
                                ),
                                SizedBox(
                                  width: 180,
                                  child: TextField(
                                    controller: roundDuration,
                                    keyboardType: TextInputType.number,
                                    decoration: const InputDecoration(
                                      labelText: 'مدة الجولة / ثانية',
                                      border: OutlineInputBorder(),
                                    ),
                                  ),
                                ),
                                SizedBox(
                                  width: 180,
                                  child: TextField(
                                    controller: lockBefore,
                                    keyboardType: TextInputType.number,
                                    decoration: const InputDecoration(
                                      labelText: 'قفل الرهان قبل النهاية ms',
                                      border: OutlineInputBorder(),
                                    ),
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 10),
                            FilledButton.icon(
                              onPressed: savingTiming ? null : saveTiming,
                              icon: const Icon(Icons.schedule_rounded),
                              label: Text(
                                savingTiming
                                    ? 'جار الحفظ...'
                                    : 'حفظ توقيت الجولات',
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      controller: reason,
                      maxLength: 240,
                      decoration: const InputDecoration(
                        labelText: 'سبب التغيير — إلزامي للـAudit',
                        border: OutlineInputBorder(),
                      ),
                    ),
                    ...variants.map(gameCard),
                    const SizedBox(height: 12),
                    const Text(
                      'آخر تغييرات الألعاب',
                      style:
                          TextStyle(fontSize: 18, fontWeight: FontWeight.w900),
                    ),
                    if (audit.isEmpty)
                      const Card(
                        child: ListTile(title: Text('لا توجد تغييرات مسجلة.')),
                      )
                    else
                      ...audit.take(20).map(
                            (item) => Card(
                              child: ListTile(
                                leading: const Icon(Icons.history_rounded),
                                title: Text(
                                  '${item['targetId'] ?? '-'} • ${item['action'] ?? '-'}',
                                ),
                                subtitle: Text(
                                  '${item['reason'] ?? '-'}\nActor: ${item['actorUid'] ?? '-'}',
                                ),
                              ),
                            ),
                          ),
                  ],
                ),
    );
  }
}

class NumberHelper {
  static double toDouble(dynamic value) =>
      value is num ? value.toDouble() : double.tryParse('$value') ?? 0;
}

class _GameConfigCard extends StatefulWidget {
  const _GameConfigCard({
    super.key,
    required this.variant,
    required this.initialEnabled,
    required this.initialRtp,
    required this.initialBets,
    required this.initialOutcomes,
    required this.stats,
    required this.statChip,
    required this.onSave,
  });

  final Map<String, dynamic> variant;
  final bool initialEnabled;
  final String initialRtp;
  final String initialBets;
  final String initialOutcomes;
  final Map<String, dynamic> stats;
  final Widget Function(String, String) statChip;
  final Future<void> Function({
    required bool enabled,
    required String rtp,
    required String bets,
    required String outcomes,
  }) onSave;

  @override
  State<_GameConfigCard> createState() => _GameConfigCardState();
}

class _GameConfigCardState extends State<_GameConfigCard> {
  late bool enabled;
  late final TextEditingController rtp;
  late final TextEditingController bets;
  late final TextEditingController outcomes;
  bool saving = false;

  @override
  void initState() {
    super.initState();
    enabled = widget.initialEnabled;
    rtp = TextEditingController(text: widget.initialRtp);
    bets = TextEditingController(text: widget.initialBets);
    outcomes = TextEditingController(text: widget.initialOutcomes);
  }

  @override
  void dispose() {
    rtp.dispose();
    bets.dispose();
    outcomes.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final wager = NumberHelper.toDouble(widget.stats['totalWagerCoins']);
    final payout = NumberHelper.toDouble(widget.stats['totalPayoutCoins']);
    final actual = NumberHelper.toDouble(widget.stats['actualRtpBps']) / 100;
    final ids = widget.variant['outcomeIds'] is List
        ? (widget.variant['outcomeIds'] as List).join(', ')
        : '';

    return Card(
      margin: const EdgeInsets.only(top: 10),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              value: enabled,
              onChanged: saving ? null : (v) => setState(() => enabled = v),
              title: Text(
                (widget.variant['nameAr'] ?? '').toString(),
                style: const TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w900,
                ),
              ),
              subtitle: Text(
                enabled ? 'مفعّلة' : 'متوقفة',
                style: TextStyle(
                  color: enabled ? Colors.greenAccent : Colors.white54,
                ),
              ),
            ),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                widget.statChip(
                  'Rounds',
                  (widget.stats['rounds'] ?? 0).toString(),
                ),
                widget.statChip(
                  'Operations',
                  (widget.stats['operations'] ?? 0).toString(),
                ),
                widget.statChip(
                  'Wager',
                  formatCompactAmount(wager),
                ),
                widget.statChip(
                  'Payout',
                  formatCompactAmount(payout),
                ),
                widget.statChip(
                  'Actual RTP',
                  '${actual.toStringAsFixed(2)}%',
                ),
              ],
            ),
            const SizedBox(height: 12),
            TextField(
              controller: rtp,
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(
                labelText: 'Target RTP %',
                hintText: '85.00',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: bets,
              decoration: const InputDecoration(
                labelText: 'Bet Ladder — افصل بفاصلة',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: outcomes,
              minLines: 3,
              maxLines: 12,
              decoration: InputDecoration(
                labelText: 'Outcome weights — id=weightBps',
                hintText: ids,
                helperText: 'مجموع weightBps عند التفعيل يجب أن يساوي 10000.',
                border: const OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 10),
            FilledButton.icon(
              onPressed: saving
                  ? null
                  : () async {
                      setState(() => saving = true);
                      try {
                        await widget.onSave(
                          enabled: enabled,
                          rtp: rtp.text,
                          bets: bets.text,
                          outcomes: outcomes.text,
                        );
                      } finally {
                        if (mounted) setState(() => saving = false);
                      }
                    },
              icon: const Icon(Icons.save_rounded),
              label: Text(saving ? 'جار الحفظ...' : 'حفظ هذه اللعبة فقط'),
            ),
          ],
        ),
      ),
    );
  }
}
