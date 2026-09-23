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
        lockBefore.text = _formatSeconds(NumberHelper.toDouble(config['lockBeforeMs'] ?? 3000) / 1000);
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

  String _formatSeconds(double value) {
    final fixed = value.toStringAsFixed(2);
    if (fixed.endsWith('.00')) return fixed.substring(0, fixed.length - 3);
    if (fixed.endsWith('0')) return fixed.substring(0, fixed.length - 1);
    return fixed;
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
        'lockBeforeMs': ((double.tryParse(lockBefore.text.trim()) ?? 0) * 1000).round(),
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
    final rawOutcomes = variant['outcomes'] is List
        ? variant['outcomes'] as List
        : const <dynamic>[];
    final hasStoredOutcomes = rawOutcomes.isNotEmpty;
    final enabled = hasStoredOutcomes ? variant['enabled'] == true : true;
    final rtp = (NumberHelper.toDouble(variant['targetRtpBps']) / 100)
        .toStringAsFixed(2);
    final bets = (variant['bets'] is List
            ? (variant['bets'] as List)
            : const <dynamic>[])
        .join(',');
    final outcomes = formatOutcomes(rawOutcomes);

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
        title: const Text('إدارة الألعاب'),
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
                          'تحكم بكل لعبة بشكل مستقل. الإعدادات اليومية مبسطة، والتفاصيل لا تظهر إلا عند فتح بطاقة اللعبة.',
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
                                      labelText: 'فرق التوقيت عن UTC (دقيقة)',
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
                                      labelText: 'مدة الجولة (ثانية)',
                                      border: OutlineInputBorder(),
                                    ),
                                  ),
                                ),
                                SizedBox(
                                  width: 180,
                                  child: TextField(
                                    controller: lockBefore,
                                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                                    decoration: const InputDecoration(
                                      labelText: 'إيقاف الرهان قبل النهاية (ثانية)',
                                      hintText: '3',
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
                        labelText: 'سبب التغيير (يُحفظ في سجل الإدارة)',
                        border: OutlineInputBorder(),
                      ),
                    ),
                    ...variants.map(gameCard),
                    const SizedBox(height: 12),
                    const Text(
                      'سجل تغييرات الألعاب',
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
                                  '${item['reason'] ?? '-'}\nالمسؤول: ${item['actorUid'] ?? '-'}',
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

class _OutcomeWeightControl {
  _OutcomeWeightControl({
    required this.id,
    required this.controller,
  });

  final String id;
  final TextEditingController controller;
}

class _GameConfigCardState extends State<_GameConfigCard> {
  late bool enabled;
  bool expanded = false;
  late final TextEditingController rtp;
  late final TextEditingController bets;
  late final List<_OutcomeWeightControl> outcomeFields;
  bool saving = false;

  @override
  void initState() {
    super.initState();
    enabled = widget.initialEnabled;
    rtp = TextEditingController(text: widget.initialRtp);
    bets = TextEditingController(text: widget.initialBets);
    outcomeFields = _parseInitialOutcomes(widget.initialOutcomes);
    if (outcomeFields.isEmpty) {
      final ids = widget.variant['outcomeIds'] is List
          ? (widget.variant['outcomeIds'] as List)
              .map((e) => e.toString())
              .where((e) => e.isNotEmpty)
              .toList()
          : <String>[];
      final defaults = _defaultOutcomeBps(
        (widget.variant['key'] ?? '').toString(),
      );
      outcomeFields = ids
          .map(
            (id) => _OutcomeWeightControl(
              id: id,
              controller: TextEditingController(
                text: defaults.containsKey(id)
                    ? _cleanPercent((defaults[id] ?? 0) / 100)
                    : '',
              ),
            ),
          )
          .toList();
      for (final item in outcomeFields) {
        item.controller.addListener(_refreshOutcomeTotal);
      }
    }
  }

  List<_OutcomeWeightControl> _parseInitialOutcomes(String raw) {
    final result = <_OutcomeWeightControl>[];
    for (final rawLine in raw.split('\n')) {
      final line = rawLine.trim();
      if (line.isEmpty) continue;
      final separator = line.indexOf('=');
      if (separator <= 0) continue;
      final id = line.substring(0, separator).trim();
      final bps = int.tryParse(line.substring(separator + 1).trim()) ?? 0;
      final percent = bps / 100;
      final text = _cleanPercent(percent);
      final controller = TextEditingController(text: text);
      controller.addListener(_refreshOutcomeTotal);
      result.add(_OutcomeWeightControl(id: id, controller: controller));
    }
    return result;
  }

  void _refreshOutcomeTotal() {
    if (mounted) setState(() {});
  }

  Map<String, int> _defaultOutcomeBps(String key) {
    switch (key) {
      case 'greedy_cat':
        return const {
          'pepper5': 2000,
          'tomato5': 1999,
          'cabbage5': 1999,
          'carrot5': 1999,
          'chicken10': 1036,
          'fish15': 536,
          'steak25': 144,
          'shell45': 8,
          'salad': 278,
          'pizza': 1,
        };
      case 'witch_normal':
        return const {
          'moon': 1364,
          'mirror': 1384,
          'potion': 1472,
          'orb': 1578,
          'owl': 1812,
          'book': 2390,
        };
      case 'witch_advanced':
        return const {
          'moon': 2395,
          'mirror': 2235,
          'potion': 1908,
          'orb': 1644,
          'owl': 1216,
          'book': 602,
        };
      case 'slot':
        return const {
          'lose': 6875,
          'pair': 3000,
          'jackpot': 125,
        };
      default:
        return const {};
    }
  }

  String _cleanPercent(double value) {
    final fixed = value.toStringAsFixed(2);
    if (fixed.endsWith('.00')) {
      return fixed.substring(0, fixed.length - 3);
    }
    if (fixed.endsWith('0')) {
      return fixed.substring(0, fixed.length - 1);
    }
    return fixed;
  }

  int _outcomeTotalBps() {
    var total = 0;
    for (final item in outcomeFields) {
      final percent = double.tryParse(item.controller.text.trim()) ?? 0;
      total += (percent * 100).round();
    }
    return total;
  }

  String _serializeOutcomes() {
    return outcomeFields
        .map((item) {
          final percent = double.tryParse(item.controller.text.trim()) ?? 0;
          final bps = (percent * 100).round();
          return (id: item.id, bps: bps);
        })
        .where((item) => item.bps > 0)
        .map((item) => item.id + '=' + item.bps.toString())
        .join('\n');
  }

  String _outcomeLabel(String id) {
    const labels = <String, String>{
      'pepper5': 'فلفل ×5',
      'tomato5': 'طماطم ×5',
      'cabbage5': 'ملفوف ×5',
      'carrot5': 'جزر ×5',
      'chicken10': 'دجاج ×10',
      'fish15': 'سمك ×15',
      'steak25': 'ستيك ×25',
      'shell45': 'صدفة ×45',
      'salad': 'مجموعة السلطة',
      'pizza': 'مجموعة البيتزا',
      'moon': 'القمر',
      'mirror': 'المرآة',
      'potion': 'الجرعة',
      'orb': 'الكرة السحرية',
      'owl': 'البومة',
      'book': 'الكتاب',
      'lose': 'خسارة',
      'pair': 'زوج',
      'jackpot': 'جاكبوت',
    };
    return labels[id] ?? id;
  }

  @override
  void dispose() {
    rtp.dispose();
    bets.dispose();
    for (final item in outcomeFields) {
      item.controller
        ..removeListener(_refreshOutcomeTotal)
        ..dispose();
    }
    super.dispose();
  }

  Widget _metric(String label, String value) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: .04),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.white.withValues(alpha: .08)),
      ),
      child: Text(
        label + ': ' + value,
        style: const TextStyle(
          fontWeight: FontWeight.w700,
          fontSize: 12,
        ),
      ),
    );
  }

  Widget _outcomeEditor() {
    final totalBps = _outcomeTotalBps();
    final totalOk = totalBps == 10000;
    final totalPercent = _cleanPercent(totalBps / 100);
    final invalidEnabledConfig = enabled && !totalOk;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            const Expanded(
              child: Text(
                'احتمالات النتائج',
                style: TextStyle(fontWeight: FontWeight.w900),
              ),
            ),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              decoration: BoxDecoration(
                color: (totalOk ? Colors.greenAccent : Colors.orangeAccent)
                    .withValues(alpha: .10),
                borderRadius: BorderRadius.circular(999),
              ),
              child: Text(
                'المجموع ' + totalPercent + '%',
                style: TextStyle(
                  color: totalOk ? Colors.greenAccent : Colors.orangeAccent,
                  fontWeight: FontWeight.w800,
                  fontSize: 12,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 6),
        const Text(
          'عدّل النسبة لكل نتيجة. يجب أن يكون المجموع 100% عند تشغيل اللعبة.',
          style: TextStyle(
            color: Color(0xFFAAA3B8),
            fontSize: 12,
            height: 1.4,
          ),
        ),
        if (invalidEnabledConfig) ...[
          const SizedBox(height: 8),
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: Colors.orangeAccent.withValues(alpha: .10),
              borderRadius: BorderRadius.circular(10),
              border: Border.all(
                color: Colors.orangeAccent.withValues(alpha: .30),
              ),
            ),
            child: const Text(
              'هذه اللعبة مفعّلة لكن توزيع النتائج غير مكتمل. أدخل نسباً مجموعها 100% قبل الحفظ، أو أوقف اللعبة ثم احفظ.',
              style: TextStyle(
                color: Colors.orangeAccent,
                fontSize: 12,
                height: 1.45,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
        const SizedBox(height: 10),
        if (outcomeFields.isEmpty)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 8),
            child: Text(
              'لا توجد نتائج قابلة للتعديل لهذه اللعبة.',
              style: TextStyle(color: Colors.white54),
            ),
          )
        else
          ...outcomeFields.map(
            (item) => Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: TextField(
                controller: item.controller,
                enabled: !saving,
                keyboardType:
                    const TextInputType.numberWithOptions(decimal: true),
                decoration: InputDecoration(
                  labelText: _outcomeLabel(item.id),
                  suffixText: '%',
                  isDense: true,
                  border: const OutlineInputBorder(),
                ),
              ),
            ),
          ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final wager = NumberHelper.toDouble(widget.stats['totalWagerCoins']);
    final payout = NumberHelper.toDouble(widget.stats['totalPayoutCoins']);
    final actual = NumberHelper.toDouble(widget.stats['actualRtpBps']) / 100;
    final gameName = (widget.variant['nameAr'] ?? '').toString();
    final targetRtp = double.tryParse(rtp.text.trim()) ?? 0;

    return Card(
      margin: const EdgeInsets.only(top: 10),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 14, 14, 8),
            child: Row(
              children: [
                Container(
                  width: 42,
                  height: 42,
                  decoration: BoxDecoration(
                    color: const Color(0xFFD7B85A).withValues(alpha: .10),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Icon(
                    Icons.sports_esports_rounded,
                    color: Color(0xFFD7B85A),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        gameName,
                        style: const TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        enabled ? 'مفعّلة' : 'متوقفة',
                        style: TextStyle(
                          color:
                              enabled ? Colors.greenAccent : Colors.white54,
                          fontWeight: FontWeight.w700,
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                ),
                Switch.adaptive(
                  value: enabled,
                  onChanged: saving
                      ? null
                      : (value) => setState(() {
                            enabled = value;
                            expanded = true;
                          }),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14),
            child: Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                _metric(
                  'RTP المستهدف',
                  _cleanPercent(targetRtp) + '%',
                ),
                _metric(
                  'RTP الفعلي',
                  actual.toStringAsFixed(2) + '%',
                ),
                _metric(
                  'الجولات',
                  (widget.stats['rounds'] ?? 0).toString(),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 10, 14, 12),
            child: OutlinedButton.icon(
              onPressed: saving
                  ? null
                  : () => setState(() => expanded = !expanded),
              icon: Icon(
                expanded
                    ? Icons.keyboard_arrow_up_rounded
                    : Icons.tune_rounded,
              ),
              label: Text(
                expanded ? 'إخفاء الإعدادات' : 'تعديل إعدادات اللعبة',
              ),
            ),
          ),
          AnimatedCrossFade(
            duration: const Duration(milliseconds: 180),
            crossFadeState: expanded
                ? CrossFadeState.showSecond
                : CrossFadeState.showFirst,
            firstChild: const SizedBox.shrink(),
            secondChild: Container(
              decoration: BoxDecoration(
                color: Colors.black.withValues(alpha: .12),
                border: Border(
                  top: BorderSide(
                    color: Colors.white.withValues(alpha: .06),
                  ),
                ),
              ),
              padding: const EdgeInsets.fromLTRB(14, 14, 14, 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Text(
                    'الإعدادات الأساسية',
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: rtp,
                    enabled: !saving,
                    keyboardType:
                        const TextInputType.numberWithOptions(decimal: true),
                    decoration: const InputDecoration(
                      labelText: 'نسبة الإرجاع المستهدفة (RTP)',
                      suffixText: '%',
                      helperText: 'مثال: 85 يعني أن الهدف النظري 85%.',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: bets,
                    enabled: !saving,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(
                      labelText: 'قيم الرهانات المتاحة',
                      hintText: '100, 1000, 10000, 100000',
                      helperText: 'افصل القيم بفاصلة.',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 16),
                  _outcomeEditor(),
                  const SizedBox(height: 8),
                  ExpansionTile(
                    tilePadding: EdgeInsets.zero,
                    childrenPadding: const EdgeInsets.only(bottom: 8),
                    title: const Text(
                      'إحصاءات متقدمة',
                      style: TextStyle(fontWeight: FontWeight.w800),
                    ),
                    subtitle: const Text(
                      'للمراجعة فقط ولا تحتاجها أثناء التعديل اليومي.',
                      style: TextStyle(fontSize: 12),
                    ),
                    children: [
                      Align(
                        alignment: Alignment.centerRight,
                        child: Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: [
                            _metric(
                              'العمليات',
                              (widget.stats['operations'] ?? 0).toString(),
                            ),
                            _metric(
                              'إجمالي الرهانات',
                              formatCompactAmount(wager),
                            ),
                            _metric(
                              'إجمالي المدفوعات',
                              formatCompactAmount(payout),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  FilledButton.icon(
                    onPressed: saving || (enabled && _outcomeTotalBps() != 10000)
                        ? null
                        : () async {
                            setState(() => saving = true);
                            try {
                              await widget.onSave(
                                enabled: enabled,
                                rtp: rtp.text,
                                bets: bets.text,
                                outcomes: _serializeOutcomes(),
                              );
                            } finally {
                              if (mounted) setState(() => saving = false);
                            }
                          },
                    icon: saving
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.save_rounded),
                    label: Text(
                      saving
                          ? 'جار الحفظ...'
                          : (enabled && _outcomeTotalBps() != 10000)
                              ? 'أكمل الاحتمالات إلى 100%'
                              : 'حفظ تغييرات هذه اللعبة',
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
