
import 'dart:async';

import 'package:flutter/material.dart';

import '../../../utils/compact_number.dart';
import '../../wallet/screens/recharge_screen.dart';
import '../services/vip_service.dart';

class VipInformationCenterScreen extends StatefulWidget {
  const VipInformationCenterScreen({
    super.key,
    required this.summary,
    this.service,
    this.buyGrowth,
    this.onSummaryChanged,
  });

  final VipSummaryData summary;
  final VipService? service;
  final Future<VipSummaryData> Function({
    required int growthPoints,
    required String idempotencyKey,
  })? buyGrowth;
  final ValueChanged<VipSummaryData>? onSummaryChanged;

  @override
  State<VipInformationCenterScreen> createState() =>
      _VipInformationCenterScreenState();
}

class _VipInformationCenterScreenState
    extends State<VipInformationCenterScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabs;
  late final VipService _service;
  late VipSummaryData _summary;
  late final bool _ownsService;

  final List<VipHistoryEvent> _history = <VipHistoryEvent>[];
  final TextEditingController _manualGrowth = TextEditingController();
  bool _historyLoaded = false;
  bool _historyLoading = false;
  bool _buying = false;
  bool _historyHasMore = true;
  String? _historyCursor;
  String? _historyError;

  @override
  void initState() {
    super.initState();
    _summary = widget.summary;
    _ownsService = widget.service == null;
    _service = widget.service ?? VipService();
    _tabs = TabController(length: 3, vsync: this);
    _tabs.addListener(_tabChanged);
  }

  @override
  void dispose() {
    _tabs.removeListener(_tabChanged);
    _tabs.dispose();
    _manualGrowth.dispose();
    if (_ownsService) _service.close();
    super.dispose();
  }

  void _tabChanged() {
    if (_tabs.index == 1 && !_historyLoaded && !_historyLoading) {
      unawaited(_loadHistory(reset: true));
    }
  }

  Future<void> _loadHistory({bool reset = false}) async {
    if (_historyLoading) return;
    if (!reset && !_historyHasMore) return;
    setState(() {
      _historyLoading = true;
      _historyError = null;
      if (reset) {
        _history.clear();
        _historyCursor = null;
        _historyHasMore = true;
      }
    });
    try {
      final page = await _service.loadHistory(
        cursor: reset ? null : _historyCursor,
        pageSize: 20,
      );
      if (!mounted) return;
      setState(() {
        _history.addAll(page.events);
        _historyCursor = page.nextCursor;
        _historyHasMore = page.hasMore && page.nextCursor != null;
        _historyLoaded = true;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _historyLoaded = true;
        _historyError = error.toString();
      });
    } finally {
      if (mounted) setState(() => _historyLoading = false);
    }
  }

  Future<void> _buyOffer(VipQuickPurchaseOffer offer) async {
    if (_buying) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('تأكيد شراء نقاط VIP'),
        content: Text(
          'شراء ${formatCompactAmount(offer.growthPoints)} نقطة نمو '
          'مقابل ${formatCompactAmount(offer.finalCoinCost)} Coins؟',
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('إلغاء'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('شراء'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    setState(() => _buying = true);
    try {
      final buyer = widget.buyGrowth ?? _service.buyGrowth;
      final updated = await buyer(
        growthPoints: offer.growthPoints,
        idempotencyKey:
            'vip_offer_${offer.id}_${DateTime.now().microsecondsSinceEpoch}',
      );
      if (!mounted) return;
      setState(() => _summary = updated);
      widget.onSummaryChanged?.call(updated);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'تمت إضافة ${formatCompactAmount(offer.growthPoints)} نقطة نمو VIP.',
          ),
        ),
      );
      if (_historyLoaded) {
        await _loadHistory(reset: true);
      }
    } catch (error) {
      if (!mounted) return;
      final raw = error.toString();
      final message = raw.contains('insufficient_coins')
          ? 'رصيد Coins غير كافٍ.'
          : raw.contains('vip_growth_cap_reached')
              ? 'وصلت إلى الحد الأعلى لنقاط VIP.'
              : 'تعذر شراء العرض حاليًا.';
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(message)),
      );
    } finally {
      if (mounted) setState(() => _buying = false);
    }
  }

  Future<void> _openRecharge() async {
    await Navigator.of(context).push<void>(
      MaterialPageRoute<void>(
        builder: (_) => const RechargeScreen(initialTab: 0),
      ),
    );
  }

  String _dateText(int epochMs) {
    if (epochMs <= 0) return '—';
    final date = DateTime.fromMillisecondsSinceEpoch(epochMs).toLocal();
    String two(int value) => value.toString().padLeft(2, '0');
    return '${date.year}-${two(date.month)}-${two(date.day)} '
        '${two(date.hour)}:${two(date.minute)}';
  }

  String _remainingValidityLabel() {
    final expiresAt = _summary.effectiveVipExpiresAtMs;
    final serverNow = _summary.serverNowMs;
    if (expiresAt <= 0 || serverNow <= 0) return '—';
    final remainingMs = expiresAt - serverNow;
    if (remainingMs <= 0) return 'منتهية';
    const minuteMs = 60 * 1000;
    const hourMs = 60 * minuteMs;
    const dayMs = 24 * hourMs;
    if (remainingMs >= dayMs) {
      return '${remainingMs ~/ dayMs} يوم';
    }
    if (remainingMs >= hourMs) {
      return '${remainingMs ~/ hourMs} ساعة';
    }
    if (remainingMs >= minuteMs) {
      return '${remainingMs ~/ minuteMs} دقيقة';
    }
    return 'أقل من دقيقة';
  }

  int _historyValidityDays(int level) {
    final levels = _summary.policy?.levels ?? const <VipPolicyLevel>[];
    for (final item in levels) {
      if (item.level == level) return item.validityDays;
    }
    return 0;
  }

  Future<void> _buyManualGrowth() async {
    if (_buying) return;
    final growth = int.tryParse(_manualGrowth.text.trim());
    final ratio = _summary.purchaseGrowthPerCoin;
    if (growth == null || growth <= 0 || ratio <= 0 || growth % ratio != 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'أدخل عدد Growth موجب ويقبل القسمة على نسبة الشراء الحالية 1:$ratio.',
          ),
        ),
      );
      return;
    }
    final coins = growth ~/ ratio;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('تأكيد شراء نقاط VIP'),
        content: Text(
          'شراء ${formatCompactAmount(growth)} Growth مقابل '
          '${formatCompactAmount(coins)} Coins؟',
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('إلغاء'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('شراء'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => _buying = true);
    try {
      final buyer = widget.buyGrowth ?? _service.buyGrowth;
      final updated = await buyer(
        growthPoints: growth,
        idempotencyKey:
            'vip_manual_${DateTime.now().microsecondsSinceEpoch}',
      );
      if (!mounted) return;
      setState(() {
        _summary = updated;
        _manualGrowth.clear();
      });
      widget.onSummaryChanged?.call(updated);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'تمت إضافة ${formatCompactAmount(growth)} نقطة نمو VIP.',
          ),
        ),
      );
      if (_historyLoaded) await _loadHistory(reset: true);
    } catch (error) {
      if (!mounted) return;
      final raw = error.toString();
      final message = raw.contains('insufficient_coins')
          ? 'رصيد Coins غير كافٍ.'
          : 'تعذر شراء نقاط VIP حاليًا.';
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(message)),
      );
    } finally {
      if (mounted) setState(() => _buying = false);
    }
  }

  String _eventTitle(VipHistoryEvent event) {
    switch (event.eventType) {
      case 'vip_upgrade':
        return 'ترقية مستوى VIP';
      case 'vip_downgrade':
        return 'هبوط مستوى VIP';
      case 'growth_purchase':
        return 'شراء نقاط نمو VIP';
      case 'paid_recharge_growth':
        return 'نمو من شحن مدفوع';
      case 'grantVip10TrialCards':
        return 'بطاقات VIP10 التجريبية';
      case 'giftVipTrialCard':
        return 'استلام بطاقة VIP تجريبية';
      case 'redeemVipTrialCard':
        return 'تفعيل بطاقة VIP تجريبية';
      case 'publishVip10GlobalEntry':
        return 'إعلان دخول VIP10 العالمي';
      case 'manageVipLevels':
        return 'تعديل VIP إداري';
      default:
        return event.eventType.isEmpty ? 'حدث VIP' : event.eventType;
    }
  }

  String _eventSubtitle(VipHistoryEvent event) {
    if (event.source == 'growth' && event.triggerType == 'growth_purchase') {
      return '+${formatCompactAmount(event.deltaGrowthPoints)} Growth • '
          '-${formatCompactAmount(event.coinCost)} Coins';
    }
    if (event.source == 'growth' &&
        event.triggerType == 'paid_recharge_growth') {
      return '+${formatCompactAmount(event.deltaGrowthPoints)} Growth من '
          '${formatCompactAmount(event.baseCoins)} Base Coins'
          ' • Bonus المستبعد ${formatCompactAmount(event.bonusCoinsExcluded)}';
    }
    if (event.oldVipLevel > 0 || event.newVipLevel > 0) {
      return 'VIP${event.oldVipLevel} → VIP${event.newVipLevel}';
    }
    if (event.level > 0) return 'VIP${event.level}';
    return 'سجل VIP';
  }

  Widget _panel({required Widget child}) => Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: const Color(0xFF101622),
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: const Color(0x334D67FF)),
        ),
        child: child,
      );

  Widget _growthTab() {
    final policy = _summary.policy;
    final offers = policy?.quickPurchaseOffers ?? const <VipQuickPurchaseOffer>[];
    final max = _summary.maxGrowthPoints <= 0 ? 1 : _summary.maxGrowthPoints;
    final progress = (_summary.growthPoints / max).clamp(0.0, 1.0).toDouble();
    return ListView(
      padding: const EdgeInsets.all(14),
      children: <Widget>[
        _panel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              const Text(
                'نقاط النمو للعضوية المميزة',
                style: TextStyle(
                  fontSize: 19,
                  fontWeight: FontWeight.w900,
                  color: Color(0xFFFFD98A),
                ),
              ),
              const SizedBox(height: 10),
              Text(
                '${formatCompactAmount(_summary.growthPoints)} / '
                '${formatCompactAmount(_summary.maxGrowthPoints)}',
                style: const TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 8),
              LinearProgressIndicator(value: progress),
              const SizedBox(height: 12),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: <Widget>[
                  Chip(
                    label: Text(
                      'VIP الحالي: VIP${_summary.effectiveVipLevel}',
                    ),
                  ),
                  Chip(
                    label: Text(
                      'المتبقي: ${_remainingValidityLabel()}',
                    ),
                  ),
                  Chip(
                    label: Text(
                      'المحافظة: '
                      '${formatCompactAmount(_summary.maintenancePoints)} / '
                      '${formatCompactAmount(_summary.maintenanceRequired)}',
                    ),
                  ),
                  Chip(
                    label: Text(
                      'للترقية: '
                      '${formatCompactAmount(_summary.remainingToNext)}',
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Text(
                'الشحن المدفوع: 1 Coin = '
                '${_summary.paidRechargeGrowthPerCoin} Growth من Base Coins فقط.',
              ),
              const SizedBox(height: 4),
              Text(
                'الشراء من رصيد Coins: 1 Coin = '
                '${_summary.purchaseGrowthPerCoin} Growth.',
              ),
              const SizedBox(height: 4),
              const Text(
                'Bonus Coins والمكافآت المجانية لا تضيف Growth تلقائيًا.',
                style: TextStyle(color: Colors.white60),
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        _panel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              const Text(
                'شراء',
                style: TextStyle(
                  color: Color(0xFFFFD98A),
                  fontWeight: FontWeight.w900,
                  fontSize: 17,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'رصيدك: ${formatCompactAmount(_summary.coins)} Coins',
              ),
              const SizedBox(height: 8),
              TextField(
                key: const Key('vip-manual-growth-input'),
                controller: _manualGrowth,
                keyboardType: TextInputType.number,
                onChanged: (_) => setState(() {}),
                decoration: InputDecoration(
                  labelText: 'VIP Growth Points',
                  helperText: _manualGrowth.text.trim().isEmpty
                      ? '1 Coin = ${_summary.purchaseGrowthPerCoin} Growth'
                      : (() {
                          final points =
                              int.tryParse(_manualGrowth.text.trim()) ?? 0;
                          final ratio = _summary.purchaseGrowthPerCoin;
                          final coins = ratio > 0 ? points ~/ ratio : 0;
                          return 'التكلفة: ${formatCompactAmount(coins)} Coins';
                        })(),
                  border: const OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 8),
              FilledButton(
                key: const Key('vip-manual-growth-buy'),
                onPressed: _buying ? null : _buyManualGrowth,
                child: const Text('شراء'),
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        _panel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              const Text(
                'إعادة الشحن',
                style: TextStyle(
                  color: Color(0xFFFFD98A),
                  fontWeight: FontWeight.w900,
                  fontSize: 17,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                'Coins من الشحن المدفوع تمنح Growth من Base Coins فقط بنسبة '
                '1:${_summary.paidRechargeGrowthPerCoin}.',
              ),
              const SizedBox(height: 10),
              FilledButton.icon(
                key: const Key('vip-open-recharge'),
                onPressed: _openRecharge,
                icon: const Icon(Icons.account_balance_wallet_outlined),
                label: const Text('انتقل للشحن'),
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        _panel(
          child: Text(
            'الحد الأقصى الحالي لنقاط VIP: '
            '${formatCompactAmount(_summary.maxGrowthPoints)}. '
            'السيرفر يمنع تجاوز هذا السقف.',
          ),
        ),
        const SizedBox(height: 12),
        Text(
          'العروض السريعة',
          style: Theme.of(context)
              .textTheme
              .titleLarge
              ?.copyWith(fontWeight: FontWeight.w900),
        ),
        const SizedBox(height: 8),
        if (offers.isEmpty)
          _panel(
            child: const Text(
              'لا توجد عروض سريعة مفعّلة حاليًا. الشراء اليدوي يبقى متاحًا من شاشة VIP.',
              style: TextStyle(color: Colors.white60),
            ),
          )
        else
          ...offers.map(
            (offer) => Card(
              key: Key('vip-quick-offer-${offer.id}'),
              margin: const EdgeInsets.only(bottom: 10),
              child: ListTile(
                leading: const Icon(
                  Icons.bolt_rounded,
                  color: Color(0xFFFFD54A),
                ),
                title: Text(
                  offer.labelAr.isEmpty
                      ? '${formatCompactAmount(offer.growthPoints)} Growth'
                      : offer.labelAr,
                  style: const TextStyle(fontWeight: FontWeight.w900),
                ),
                subtitle: Wrap(
                  spacing: 8,
                  children: <Widget>[
                    Text(
                      '+${formatCompactAmount(offer.growthPoints)} Growth',
                    ),
                    if (offer.baseCoinCost > offer.finalCoinCost)
                      Text(
                        '${formatCompactAmount(offer.baseCoinCost)} Coins',
                        style: const TextStyle(
                          decoration: TextDecoration.lineThrough,
                          color: Colors.white38,
                        ),
                      ),
                    Text(
                      '${formatCompactAmount(offer.finalCoinCost)} Coins',
                      style: const TextStyle(color: Color(0xFFFFD98A)),
                    ),
                    if (offer.discountBps > 0)
                      Text(
                        '-${(offer.discountBps / 100).toStringAsFixed(0)}%',
                        style: const TextStyle(color: Colors.greenAccent),
                      ),
                  ],
                ),
                trailing: FilledButton(
                  onPressed: _buying ? null : () => _buyOffer(offer),
                  child: const Text('شراء'),
                ),
              ),
            ),
          ),
      ],
    );
  }

  Widget _historyTab() {
    if (!_historyLoaded && _historyLoading) {
      return const Center(child: CircularProgressIndicator());
    }
    return RefreshIndicator(
      onRefresh: () => _loadHistory(reset: true),
      child: ListView(
        padding: const EdgeInsets.all(14),
        children: <Widget>[
          if (_historyError != null)
            _panel(
              child: Text(
                'تعذر تحميل السجل: $_historyError',
                style: const TextStyle(color: Colors.orangeAccent),
              ),
            ),
          if (_historyLoaded && _history.isEmpty && _historyError == null)
            _panel(
              child: const Text(
                'لا يوجد سجل VIP بعد.',
                style: TextStyle(color: Colors.white60),
              ),
            ),
          ..._history.map(
            (event) => Card(
              margin: const EdgeInsets.only(bottom: 10),
              child: ListTile(
                leading: Icon(
                  event.source == 'growth'
                      ? Icons.trending_up_rounded
                      : Icons.workspace_premium_outlined,
                  color: const Color(0xFFFFD54A),
                ),
                title: Text(
                  _eventTitle(event),
                  style: const TextStyle(fontWeight: FontWeight.w800),
                ),
                subtitle: Text(
                  (() {
                    final validity = _historyValidityDays(event.level);
                    final parts = <String>[
                      _eventSubtitle(event),
                      if (validity > 0) 'مدة المستوى: $validity يوم',
                      if (event.growthPointsAfter > 0)
                        'Growth بعد الحدث: '
                            '${formatCompactAmount(event.growthPointsAfter)}',
                      _dateText(event.createdAtMs),
                    ];
                    return parts.join('\n');
                  })(),
                ),
                isThreeLine: true,
              ),
            ),
          ),
          if (_historyLoading) const LinearProgressIndicator(minHeight: 2),
          if (_historyHasMore && !_historyLoading)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: OutlinedButton.icon(
                key: const Key('vip-history-load-more'),
                onPressed: _loadHistory,
                icon: const Icon(Icons.expand_more_rounded),
                label: const Text('تحميل المزيد'),
              ),
            ),
        ],
      ),
    );
  }

  Widget _rulesTab() {
    final policy = _summary.policy;
    final levels = policy?.levels ?? const <VipPolicyLevel>[];
    return ListView(
      padding: const EdgeInsets.all(14),
      children: <Widget>[
        _panel(
          child: const Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Text(
                'ما هو VIP؟',
                style: TextStyle(
                  color: Color(0xFFFFD98A),
                  fontWeight: FontWeight.w900,
                ),
              ),
              SizedBox(height: 6),
              Text(
                'VIP نظام عضوية وهوية خاصة تُفتح بتراكم نقاط النمو، وتزداد الامتيازات مع ارتفاع المستوى.',
              ),
              SizedBox(height: 12),
              Text(
                'كيف يمكن الحصول على نقاط النمو؟',
                style: TextStyle(
                  color: Color(0xFFFFD98A),
                  fontWeight: FontWeight.w900,
                ),
              ),
              SizedBox(height: 6),
              Text(
                'الشحن المدفوع يحتسب Base Coins فقط بنسبة 1:1 حسب السياسة الحية، والشراء من رصيد Coins يحتسب بالنسبة الحية المعروضة في تبويب نقاط النمو. Bonus Coins لا تدخل تلقائيًا.',
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        if (levels.isEmpty)
          _panel(
            child: const Text(
              'تعذر تحميل جدول السياسة الحية.',
              style: TextStyle(color: Colors.orangeAccent),
            ),
          )
        else
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: DataTable(
              columns: const <DataColumn>[
                DataColumn(label: Text('VIP')),
                DataColumn(label: Text('Growth')),
                DataColumn(label: Text('Maintenance')),
                DataColumn(label: Text('نسبة التدهور')),
              ],
              rows: levels
                  .map(
                    (level) => DataRow(
                      cells: <DataCell>[
                        DataCell(Text('VIP${level.level}')),
                        DataCell(
                          Text(formatCompactAmount(level.growthRequirement)),
                        ),
                        DataCell(
                          Text(formatCompactAmount(level.maintenanceRequired)),
                        ),
                        DataCell(
                          Text(
                            level.level <= 3
                                ? 'هبوط مستوى'
                                : '${(level.downgradeRetentionBps / 100).toStringAsFixed(0)}%',
                          ),
                        ),
                      ],
                    ),
                  )
                  .toList(growable: false),
            ),
          ),
        const SizedBox(height: 12),
        _panel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              const Text(
                'فترة الصلاحية وما يحدث بعدها',
                style: TextStyle(
                  color: Color(0xFFFFD98A),
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 8),
              const Text(
                'عند الترقية تبدأ دورة صلاحية جديدة كاملة للمستوى الجديد. عند نهاية الدورة، إذا تحققت نقاط المحافظة يجدد نفس المستوى وتبدأ دورة جديدة. إذا فشلت المحافظة ينخفض المستوى درجة واحدة.',
              ),
              const SizedBox(height: 6),
              const Text(
                'VIP1→VIP3: هبوط مستوى واحد فقط. VIP4→VIP10: هبوط مستوى واحد مع الاحتفاظ بنسبة التقدم المعروضة في الجدول، وفق نفس vipDowngradeState الموجود في السيرفر.',
                style: TextStyle(color: Colors.white70),
              ),
              const SizedBox(height: 10),
              ...levels.map(
                (level) => Text(
                  'VIP${level.level}: صلاحية ${level.validityDays} يوم',
                ),
              ),
              const SizedBox(height: 8),
              const Text(
                'المنحة الإدارية والبطاقة التجريبية مصادر مستقلة؛ انتهاؤهما يعيد Effective VIP إلى أعلى مصدر طبيعي/فعال بدون حذف Growth.',
                style: TextStyle(color: Colors.white60),
              ),
            ],
          ),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) => Directionality(
        textDirection: TextDirection.rtl,
        child: Scaffold(
          backgroundColor: const Color(0xFF05070C),
          appBar: AppBar(
            title: const Text(
              'مركز معلومات VIP',
              style: TextStyle(fontWeight: FontWeight.w900),
            ),
            bottom: TabBar(
              controller: _tabs,
              tabs: const <Tab>[
                Tab(text: 'نقاط النمو', icon: Icon(Icons.trending_up_rounded)),
                Tab(text: 'التفاصيل', icon: Icon(Icons.history_rounded)),
                Tab(text: 'شرح قواعد VIP', icon: Icon(Icons.rule_rounded)),
              ],
            ),
          ),
          body: TabBarView(
            controller: _tabs,
            children: <Widget>[
              _growthTab(),
              _historyTab(),
              _rulesTab(),
            ],
          ),
        ),
      );
}
