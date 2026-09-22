import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

class GiftEconomyControlPage extends StatefulWidget {
  const GiftEconomyControlPage({super.key});

  @override
  State<GiftEconomyControlPage> createState() => _GiftEconomyControlPageState();
}

class _TierDraft {
  _TierDraft({
    required this.id,
    required this.name,
    required int minGiftCoins,
    required int hostShareBps,
    required int agencyShareBps,
  })  : minUsd = TextEditingController(text: (minGiftCoins / 10000).toStringAsFixed(0)),
        hostPercent = TextEditingController(text: (hostShareBps / 100).toStringAsFixed(1)),
        agencyPercent = TextEditingController(text: (agencyShareBps / 100).toStringAsFixed(1));

  final String id;
  final String name;
  final TextEditingController minUsd;
  final TextEditingController hostPercent;
  final TextEditingController agencyPercent;

  void dispose() {
    minUsd.dispose();
    hostPercent.dispose();
    agencyPercent.dispose();
  }

  Map<String, dynamic> toPayload() {
    final usd = double.tryParse(minUsd.text.trim()) ?? -1;
    final host = double.tryParse(hostPercent.text.trim()) ?? -1;
    final agency = double.tryParse(agencyPercent.text.trim()) ?? -1;
    return {
      'id': id,
      'nameAr': name,
      'minGiftCoins': (usd * 10000).round(),
      'hostShareBps': (host * 100).round(),
      'agencyShareBps': (agency * 100).round(),
    };
  }
}

class _GiftEconomyControlPageState extends State<GiftEconomyControlPage> {
  bool loading = true;
  bool saving = false;
  bool enabled = false;
  String? error;
  List<_TierDraft> tiers = [];
  final hostBonus = TextEditingController(text: '2');
  final agencyBonus = TextEditingController(text: '2');
  final hostBonusDays = TextEditingController(text: '9');
  final hostMinutesPerDay = TextEditingController(text: '120');
  final agencyBonusActiveHosts = TextEditingController(text: '10');

  Uri get apiUri => Uri(
        scheme: Uri.base.scheme,
        host: Uri.base.host,
        port: Uri.base.hasPort ? Uri.base.port : null,
        path: '/api/gift-economy-config',
      );

  @override
  void initState() {
    super.initState();
    load();
  }

  @override
  void dispose() {
    for (final tier in tiers) {
      tier.dispose();
    }
    hostBonus.dispose();
    agencyBonus.dispose();
    hostBonusDays.dispose();
    hostMinutesPerDay.dispose();
    agencyBonusActiveHosts.dispose();
    super.dispose();
  }

  Future<Map<String, dynamic>> post(Map<String, dynamic> payload) async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) throw StateError('يجب تسجيل الدخول.');
    final token = await user.getIdToken();
    if (token == null || token.isEmpty) {
      throw StateError('تعذر قراءة جلسة الإدارة.');
    }
    final response = await http
        .post(
          apiUri,
          headers: {
            'content-type': 'application/json',
            'authorization': 'Bearer ' + token,
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

  void _replaceTiers(List<dynamic> raw) {
    for (final tier in tiers) {
      tier.dispose();
    }
    tiers = raw.map((item) {
      final m = Map<String, dynamic>.from(item as Map);
      return _TierDraft(
        id: (m['id'] ?? 'tier').toString(),
        name: (m['nameAr'] ?? m['id'] ?? 'Tier').toString(),
        minGiftCoins: (m['minGiftCoins'] as num?)?.toInt() ?? 0,
        hostShareBps: (m['hostShareBps'] as num?)?.toInt() ?? 0,
        agencyShareBps: (m['agencyShareBps'] as num?)?.toInt() ?? 0,
      );
    }).toList();
  }

  Future<void> load() async {
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final body = await post({'action': 'state'});
      final config = body['config'] is Map
          ? Map<String, dynamic>.from(body['config'] as Map)
          : <String, dynamic>{};
      final rawTiers = config['tiers'] is List ? config['tiers'] as List : const [];
      if (!mounted) return;
      _replaceTiers(rawTiers);
      hostBonus.text =
          (((config['hostPerformanceBonusBps'] as num?)?.toDouble() ?? 200) / 100)
              .toStringAsFixed(1);
      agencyBonus.text =
          (((config['agencyPerformanceBonusBps'] as num?)?.toDouble() ?? 200) / 100)
              .toStringAsFixed(1);
      hostBonusDays.text =
          ((config['hostBonusQualifiedDays'] as num?)?.toInt() ?? 9).toString();
      hostMinutesPerDay.text =
          ((config['hostBonusMinutesPerQualifiedDay'] as num?)?.toInt() ?? 120)
              .toString();
      agencyBonusActiveHosts.text =
          ((config['agencyBonusActiveHosts'] as num?)?.toInt() ?? 10).toString();
      setState(() {
        enabled = config['enabled'] == true;
        loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        error = e.toString();
        loading = false;
      });
    }
  }

  int _bps(TextEditingController controller) =>
      ((double.tryParse(controller.text.trim()) ?? -1) * 100).round();

  Future<void> save() async {
    setState(() => saving = true);
    try {
      await post({
        'action': 'save',
        'enabled': enabled,
        'tiers': tiers.map((e) => e.toPayload()).toList(),
        'hostPerformanceBonusBps': _bps(hostBonus),
        'agencyPerformanceBonusBps': _bps(agencyBonus),
        'hostBonusQualifiedDays':
            int.tryParse(hostBonusDays.text.trim()) ?? -1,
        'hostBonusMinutesPerQualifiedDay':
            int.tryParse(hostMinutesPerDay.text.trim()) ?? -1,
        'agencyBonusActiveHosts':
            int.tryParse(agencyBonusActiveHosts.text.trim()) ?? -1,
      });
      if (!mounted) return;
      setState(() => saving = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تم حفظ سياسة المضيف والوكالة وShadow Live.')),
      );
      await load();
    } catch (e) {
      if (!mounted) return;
      setState(() => saving = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('تعذر الحفظ: ' + e.toString())),
      );
    }
  }

  Widget _numberField(
    String label,
    TextEditingController controller, {
    String? suffix,
  }) {
    return SizedBox(
      width: 150,
      child: TextField(
        controller: controller,
        keyboardType: const TextInputType.numberWithOptions(decimal: true),
        decoration: InputDecoration(
          labelText: label,
          suffixText: suffix,
          border: const OutlineInputBorder(),
        ),
        onChanged: (_) => setState(() {}),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('نِسَب المضيف والوكالة'),
        actions: [
          IconButton(
            onPressed: loading ? null : load,
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                const Card(
                  child: ListTile(
                    leading: Icon(Icons.account_balance_wallet_rounded,
                        color: Color(0xFFD7B85A)),
                    title: Text(
                      'اقتصاد Shadow Live المعتمد',
                      style: TextStyle(fontWeight: FontWeight.w900),
                    ),
                    subtitle: Text(
                      '1 USD = 1 Diamond = 10,000 Coins. المستويات تُقاس بقيمة الهدايا الشهرية، والتسوية النهائية تبقى حسب دورات الوكالة.',
                    ),
                  ),
                ),
                SwitchListTile(
                  value: enabled,
                  onChanged: (value) => setState(() => enabled = value),
                  title: const Text('تفعيل سياسة الأرباح'),
                  subtitle: const Text(
                    'يمكن إبقاؤها غير مفعلة أثناء التطوير، مع حفظ جميع النسب والعتبات.',
                  ),
                ),
                const SizedBox(height: 8),
                const Text(
                  'مستويات التوزيع',
                  style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900),
                ),
                const SizedBox(height: 8),
                ...tiers.map((tier) {
                  final host =
                      double.tryParse(tier.hostPercent.text.trim()) ?? 0;
                  final agency =
                      double.tryParse(tier.agencyPercent.text.trim()) ?? 0;
                  final platform = 100 - host - agency;
                  return Card(
                    child: Padding(
                      padding: const EdgeInsets.all(14),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Text(
                            tier.name,
                            style: const TextStyle(
                              fontSize: 18,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                          const SizedBox(height: 12),
                          Wrap(
                            spacing: 10,
                            runSpacing: 10,
                            children: [
                              _numberField(
                                  'يبدأ من قيمة هدايا', tier.minUsd,
                                  suffix: 'USD'),
                              _numberField('المضيف', tier.hostPercent,
                                  suffix: '%'),
                              _numberField('الوكالة', tier.agencyPercent,
                                  suffix: '%'),
                              Chip(
                                avatar: const Icon(Icons.shield_outlined,
                                    size: 18),
                                label: Text(
                                  'Shadow Live: ' +
                                      platform.toStringAsFixed(1) +
                                      '%',
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  );
                }),
                const SizedBox(height: 12),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        const Text(
                          'مكافآت الأداء',
                          style: TextStyle(
                              fontSize: 18, fontWeight: FontWeight.w900),
                        ),
                        const SizedBox(height: 12),
                        Wrap(
                          spacing: 10,
                          runSpacing: 10,
                          children: [
                            _numberField('Bonus المضيف', hostBonus, suffix: '%'),
                            _numberField(
                                'Bonus الوكالة', agencyBonus,
                                suffix: '%'),
                            _numberField('أيام المضيف المؤهلة', hostBonusDays),
                            _numberField(
                                'دقائق المايك/اليوم', hostMinutesPerDay),
                            _numberField(
                                'مضيفون نشطون للوكالة',
                                agencyBonusActiveHosts),
                          ],
                        ),
                        const SizedBox(height: 10),
                        const Text(
                          'سياسة التحفيز الجديدة: النسبة الأساسية لا تنخفض بسبب عدد الأيام. عند تحقيق شرط النشاط الكامل يضاف Bonus المضيف فوق نسبته الأساسية. Bonus الوكالة يعتمد على عدد المضيفين النشطين المؤهلين.',
                          style: TextStyle(color: Color(0xFFAAA3B8)),
                        ),
                      ],
                    ),
                  ),
                ),
                if (error != null) ...[
                  const SizedBox(height: 10),
                  Text(error!,
                      style: const TextStyle(color: Colors.orangeAccent)),
                ],
                const SizedBox(height: 16),
                FilledButton.icon(
                  onPressed: saving ? null : save,
                  icon: saving
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.save_rounded),
                  label: Text(saving ? 'جار الحفظ...' : 'حفظ السياسة'),
                  style: FilledButton.styleFrom(
                    minimumSize: const Size.fromHeight(54),
                  ),
                ),
              ],
            ),
    );
  }
}
