import 'dart:async';

import 'package:flutter/material.dart';

import '../../../core/assets/shadow_asset_registry.dart';
import '../../../utils/compact_number.dart';
import '../../profile/widgets/level_asset_image.dart';
import '../services/vip_service.dart';
import 'vip_fancy_id_screen.dart';

typedef VipSummaryLoader = Future<VipSummaryData> Function();
typedef VipGrowthBuyer = Future<VipSummaryData> Function({
  required int growthPoints,
  required String idempotencyKey,
});

class VipScreen extends StatefulWidget {
  const VipScreen({
    super.key,
    this.loadSummary,
    this.buyGrowth,
    this.assetResolver,
  });

  final VipSummaryLoader? loadSummary;
  final VipGrowthBuyer? buyGrowth;
  final LevelAssetUriResolver? assetResolver;

  @override
  State<VipScreen> createState() => _VipScreenState();
}

class _VipScreenState extends State<VipScreen> {
  VipService? _service;
  VipSummaryData? _summary;
  bool _loading = true;
  bool _buying = false;
  String? _error;
  int _previewLevel = 1;

  @override
  void initState() {
    super.initState();
    if (widget.loadSummary == null || widget.buyGrowth == null) {
      _service = VipService();
    }
    unawaited(_load());
  }

  @override
  void dispose() {
    _service?.close();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final summary = await (widget.loadSummary ?? _service!.loadSummary)();
      if (!mounted) return;
      setState(() {
        _summary = summary;
        _previewLevel = summary.effectiveVipLevel.clamp(1, 10).toInt();
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = error.toString();
      });
    }
  }

  void _movePreview(int delta) {
    setState(() {
      final next = _previewLevel + delta;
      if (next < 1) {
        _previewLevel = 10;
      } else if (next > 10) {
        _previewLevel = 1;
      } else {
        _previewLevel = next;
      }
    });
  }

  Future<void> _buyGrowthPoints() async {
    final summary = _summary;
    if (summary == null || _buying) return;

    final controller = TextEditingController();
    final coinAmount = await showDialog<int>(
      context: context,
      builder: (dialogContext) => Directionality(
        textDirection: TextDirection.rtl,
        child: AlertDialog(
          backgroundColor: const Color(0xFF111827),
          title: const Text(
            'شراء نقاط VIP',
            style: TextStyle(color: Colors.white),
          ),
          content: TextField(
            controller: controller,
            autofocus: true,
            keyboardType: TextInputType.number,
            style: const TextStyle(color: Colors.white),
            decoration: InputDecoration(
              labelText: 'عدد الـ Coins',
              labelStyle: const TextStyle(color: Colors.white60),
              helperText:
                  'كل 1 Coin = ${summary.purchaseGrowthPerCoin} نقاط نمو VIP',
              helperStyle: const TextStyle(color: Colors.white54),
              enabledBorder: const OutlineInputBorder(
                borderSide: BorderSide(color: Colors.white24),
              ),
              focusedBorder: const OutlineInputBorder(
                borderSide: BorderSide(color: Color(0xFFFFC857)),
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text('إلغاء'),
            ),
            FilledButton(
              onPressed: () {
                final value = int.tryParse(controller.text.trim());
                if (value == null || value <= 0) return;
                Navigator.pop(dialogContext, value);
              },
              child: const Text('شراء'),
            ),
          ],
        ),
      ),
    );
    controller.dispose();
    if (coinAmount == null || coinAmount <= 0) return;

    final growthPoints = coinAmount * summary.purchaseGrowthPerCoin;
    setState(() => _buying = true);
    try {
      final updated = await (widget.buyGrowth ?? _service!.buyGrowth)(
        growthPoints: growthPoints,
        idempotencyKey:
            'vip_growth_${DateTime.now().microsecondsSinceEpoch}',
      );
      if (!mounted) return;
      setState(() {
        _summary = updated;
        _previewLevel = updated.effectiveVipLevel.clamp(1, 10).toInt();
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'تمت إضافة ${formatCompactAmount(growthPoints)} نقطة نمو VIP',
          ),
        ),
      );
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('تعذر شراء نقاط VIP: $error')),
      );
    } finally {
      if (mounted) setState(() => _buying = false);
    }
  }

  void _openInfo() {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: const Color(0xFF0B1020),
      isScrollControlled: true,
      builder: (context) => Directionality(
        textDirection: TextDirection.rtl,
        child: const SafeArea(
          child: Padding(
            padding: EdgeInsets.fromLTRB(18, 16, 18, 24),
            child: SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    'مركز معلومات VIP',
                    style: TextStyle(
                      color: Color(0xFFFFD98A),
                      fontSize: 20,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  SizedBox(height: 16),
                  _VipInfoBlock(
                    title: 'نقاط النمو',
                    text:
                        'الشحن المدفوع يضيف نقاط نمو من Base Coins فقط بنسبة 1:1. ويمكن شراء نقاط نمو من رصيد Coins بنسبة 1 Coin = 3 نقاط. Bonus Coins لا تضيف نموًا تلقائيًا.',
                  ),
                  SizedBox(height: 12),
                  _VipInfoBlock(
                    title: 'التفاصيل',
                    text:
                        'VIP1 إلى VIP6 صلاحيتها 30 يومًا، وVIP7 إلى VIP10 صلاحيتها 60 يومًا. الترقية تبدأ دورة صلاحية جديدة كاملة للمستوى الجديد.',
                  ),
                  SizedBox(height: 12),
                  _VipInfoBlock(
                    title: 'قواعد VIP',
                    text:
                        'يمكن استعراض VIP1 إلى VIP10 وكل أشكالها حتى قبل الوصول إليها. القفل يمنع استخدام الامتياز فقط، ولا يمنع مشاهدة التصميم. المنحة الإدارية طبقة مؤقتة ولا توقف تقدم VIP الطبيعي.',
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: const Color(0xFF05070C),
        appBar: AppBar(
          backgroundColor: const Color(0xFF0C111B),
          foregroundColor: Colors.white,
          title: const Text(
            'VIP',
            style: TextStyle(fontWeight: FontWeight.w900),
          ),
          actions: [
            IconButton(
              key: const Key('vip-info'),
              tooltip: 'معلومات VIP',
              onPressed: _openInfo,
              icon: const Icon(Icons.help_outline_rounded),
            ),
          ],
        ),
        body: _loading
            ? const Center(child: CircularProgressIndicator())
            : _error != null
                ? _errorView()
                : _content(_summary!),
      ),
    );
  }

  Widget _errorView() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(
              Icons.error_outline_rounded,
              color: Colors.white54,
              size: 44,
            ),
            const SizedBox(height: 12),
            Text(
              _error ?? 'تعذر تحميل VIP',
              textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.white60),
            ),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: _load,
              child: const Text('إعادة المحاولة'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _content(VipSummaryData summary) {
    final locked = _previewLevel > summary.effectiveVipLevel;
    final benefits = _benefitsFor(_previewLevel);
    final cosmetics = _cosmeticsFor(_previewLevel);

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(14, 14, 14, 30),
        children: [
          _levelStrip(summary.effectiveVipLevel),
          const SizedBox(height: 14),
          _hero(summary, locked),
          const SizedBox(height: 14),
          _growthCard(summary),
          const SizedBox(height: 14),
          if (cosmetics.isNotEmpty) _cosmeticsGrid(cosmetics, locked),
          if (cosmetics.isNotEmpty) const SizedBox(height: 14),
          _benefitsCard(benefits, locked),
          const SizedBox(height: 14),
          if (summary.effectiveVipLevel >= 3) ...[
            const SizedBox(height: 14),
            ListTile(
              key: const Key('vip-fancy-id-open'),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(18),
                side: const BorderSide(color: Color(0x33FFD166)),
              ),
              tileColor: const Color(0xFF101622),
              leading: const Icon(
                Icons.confirmation_number_rounded,
                color: Color(0xFFFFD166),
              ),
              title: const Text(
                'الرقم الفاخر',
                style: TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w900,
                ),
              ),
              subtitle: const Text(
                'اختيار وإدارة Fancy ID منفصل عن Public ID الأساسي',
                style: TextStyle(color: Colors.white54),
              ),
              trailing: const Icon(
                Icons.chevron_left_rounded,
                color: Colors.white38,
              ),
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => const VipFancyIdScreen(),
                ),
              ),
            ),
          ],
          _statusCard(summary),
        ],
      ),
    );
  }

  Widget _levelStrip(int effectiveLevel) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 10),
      decoration: BoxDecoration(
        color: const Color(0xFF0C111B),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: Colors.white10),
      ),
      child: SizedBox(
        height: 48,
        child: ListView.separated(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 10),
          itemCount: 10,
          separatorBuilder: (_, __) => const SizedBox(width: 7),
          itemBuilder: (context, index) {
            final level = index + 1;
            final selected = level == _previewLevel;
            final unlocked = effectiveLevel >= level;
            return InkWell(
              key: Key('vip-preview-level-$level'),
              borderRadius: BorderRadius.circular(14),
              onTap: () => setState(() => _previewLevel = level),
              child: Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                decoration: BoxDecoration(
                  color: selected
                      ? const Color(0xFF512B0E)
                      : const Color(0xFF171D29),
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(
                    color: selected
                        ? const Color(0xFFFFC857)
                        : Colors.white10,
                  ),
                ),
                child: Row(
                  children: [
                    Icon(
                      unlocked
                          ? Icons.workspace_premium_rounded
                          : Icons.lock_outline_rounded,
                      size: 15,
                      color: selected
                          ? const Color(0xFFFFD98A)
                          : Colors.white38,
                    ),
                    const SizedBox(width: 5),
                    Text(
                      'VIP$level',
                      textDirection: TextDirection.ltr,
                      style: TextStyle(
                        color: selected ? Colors.white : Colors.white60,
                        fontWeight:
                            selected ? FontWeight.w900 : FontWeight.w600,
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ),
            );
          },
        ),
      ),
    );
  }

  Widget _hero(VipSummaryData summary, bool locked) {
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 18, 12, 16),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [
            Color(0xFF2C170A),
            Color(0xFF140D08),
            Color(0xFF090A0D),
          ],
        ),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: const Color(0x66FFD077)),
      ),
      child: Column(
        children: [
          Row(
            children: [
              IconButton(
                key: const Key('vip-preview-prev'),
                tooltip: 'VIP السابق',
                onPressed: () => _movePreview(-1),
                icon: const Icon(
                  Icons.chevron_right_rounded,
                  color: Color(0xFFFFD98A),
                  size: 36,
                ),
              ),
              Expanded(
                child: Center(
                  child: SizedBox(
                    width: 180,
                    height: 180,
                    child: LevelAssetImage(
                      assetKey:
                          ShadowAssetKeys.vipMainBadge(_previewLevel),
                      resolveUri: widget.assetResolver,
                      fit: BoxFit.contain,
                      fallback: _VipFallbackCrest(level: _previewLevel),
                    ),
                  ),
                ),
              ),
              IconButton(
                key: const Key('vip-preview-next'),
                tooltip: 'VIP التالي',
                onPressed: () => _movePreview(1),
                icon: const Icon(
                  Icons.chevron_left_rounded,
                  color: Color(0xFFFFD98A),
                  size: 36,
                ),
              ),
            ],
          ),
          Text(
            'VIP$_previewLevel',
            textDirection: TextDirection.ltr,
            style: const TextStyle(
              color: Color(0xFFFFD98A),
              fontSize: 28,
              fontWeight: FontWeight.w900,
              letterSpacing: 1.2,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            locked
                ? 'معاينة فقط — يمكنك مشاهدة كل التفاصيل قبل الوصول'
                : _previewLevel == summary.effectiveVipLevel
                    ? 'مستواك الحالي'
                    : 'مستوى مفتوح لديك',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: locked ? Colors.white54 : const Color(0xFFFFC857),
              fontSize: 12,
              fontWeight: FontWeight.w700,
            ),
          ),
          if (locked) ...[
            const SizedBox(height: 5),
            const Text(
              'القفل يمنع الاستخدام فقط ولا يمنع المعاينة',
              style: TextStyle(color: Colors.white38, fontSize: 10),
            ),
          ],
        ],
      ),
    );
  }

  Widget _growthCard(VipSummaryData summary) {
    final currentForProgress = summary.growthPoints;
    final target =
        summary.remainingToNext > 0 ? currentForProgress + summary.remainingToNext : 0;
    final span = target - summary.currentThreshold;
    final progress = summary.effectiveVipLevel >= 10
        ? 1.0
        : span <= 0
            ? 0.0
            : ((currentForProgress - summary.currentThreshold) / span)
                .clamp(0.0, 1.0)
                .toDouble();

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF101622),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: Colors.white10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              const Expanded(
                child: Text(
                  'نقاط النمو',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 17,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              Text(
                formatCompactAmount(summary.growthPoints),
                textDirection: TextDirection.ltr,
                style: const TextStyle(
                  color: Color(0xFFFFD98A),
                  fontWeight: FontWeight.w900,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          ClipRRect(
            borderRadius: BorderRadius.circular(99),
            child: LinearProgressIndicator(
              value: progress,
              minHeight: 9,
              backgroundColor: Colors.white10,
            ),
          ),
          const SizedBox(height: 9),
          Text(
            summary.effectiveVipLevel >= 10
                ? 'أعلى مستوى VIP'
                : 'المتبقي للمستوى التالي: ${formatCompactAmount(summary.remainingToNext)}',
            style: const TextStyle(color: Colors.white60, fontSize: 11),
          ),
          const SizedBox(height: 12),
          FilledButton.icon(
            key: const Key('vip-buy-growth'),
            onPressed: _buying ? null : _buyGrowthPoints,
            style: FilledButton.styleFrom(
              backgroundColor: const Color(0xFF7A451B),
              foregroundColor: Colors.white,
              minimumSize: const Size.fromHeight(46),
            ),
            icon: _buying
                ? const SizedBox.square(
                    dimension: 17,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.add_circle_outline_rounded),
            label: Text(
              'شراء نقاط — 1 Coin = ${summary.purchaseGrowthPerCoin} نقاط',
            ),
          ),
          const SizedBox(height: 7),
          Text(
            'الشحن المدفوع: كل Base Coin = ${summary.paidRechargeGrowthPerCoin} نقطة نمو. الـBonus لا يُحسب تلقائيًا.',
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: Colors.white38,
              fontSize: 10,
              height: 1.4,
            ),
          ),
        ],
      ),
    );
  }

  Widget _cosmeticsGrid(List<_VipCosmetic> cosmetics, bool locked) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFF140D08),
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: const Color(0x44FFD077)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              const Expanded(
                child: Text(
                  'أزياء وزينة VIP',
                  style: TextStyle(
                    color: Color(0xFFFFD98A),
                    fontSize: 18,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              if (locked) const _PreviewBadge(),
            ],
          ),
          const SizedBox(height: 12),
          GridView.builder(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            itemCount: cosmetics.length,
            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 3,
              crossAxisSpacing: 9,
              mainAxisSpacing: 12,
              childAspectRatio: .78,
            ),
            itemBuilder: (context, index) {
              final item = cosmetics[index];
              return Column(
                children: [
                  Expanded(
                    child: Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(7),
                      decoration: BoxDecoration(
                        color: const Color(0xFF24170D),
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(
                          color: const Color(0x44FFD077),
                        ),
                      ),
                      child: Stack(
                        children: [
                          Center(
                            child: LevelAssetImage(
                              assetKey: item.assetKey,
                              resolveUri: widget.assetResolver,
                              fit: BoxFit.contain,
                              fallback: Icon(
                                item.icon,
                                size: 38,
                                color: const Color(0xFFFFC857),
                              ),
                            ),
                          ),
                          if (locked)
                            const Positioned(
                              top: 1,
                              left: 1,
                              child: Icon(
                                Icons.lock_outline_rounded,
                                color: Colors.white54,
                                size: 14,
                              ),
                            ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 7),
                  Text(
                    item.label,
                    textAlign: TextAlign.center,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: Color(0xFFFFE2B5),
                      fontSize: 10.5,
                      height: 1.25,
                    ),
                  ),
                ],
              );
            },
          ),
        ],
      ),
    );
  }

  Widget _benefitsCard(List<String> benefits, bool locked) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFF0F141E),
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: Colors.white10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  'الامتيازات الحصرية ${benefits.length}/41',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 17,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              if (locked) const _PreviewBadge(),
            ],
          ),
          const SizedBox(height: 10),
          ...benefits.map(
            (benefit) => Padding(
              padding: const EdgeInsets.symmetric(vertical: 5),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(
                    locked
                        ? Icons.lock_outline_rounded
                        : Icons.check_circle_rounded,
                    color: locked
                        ? Colors.white38
                        : const Color(0xFFFFC857),
                    size: 17,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      benefit,
                      style: const TextStyle(
                        color: Colors.white70,
                        fontSize: 12,
                        height: 1.35,
                      ),
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

  Widget _statusCard(VipSummaryData summary) {
    final expiryMs = summary.effectiveVipSource == 'admin_grant'
        ? summary.adminGrantExpiresAtMs
        : summary.earnedVipExpiresAtMs;

    return Container(
      padding: const EdgeInsets.all(15),
      decoration: BoxDecoration(
        color: const Color(0xFF101622),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: Colors.white10),
      ),
      child: Column(
        children: [
          _statusRow(
            'VIP الحالي',
            summary.effectiveVipLevel <= 0
                ? 'غير مفعل'
                : 'VIP${summary.effectiveVipLevel}',
          ),
          _statusRow(
            'المصدر',
            summary.effectiveVipSource == 'admin_grant'
                ? 'منحة إدارية مؤقتة'
                : summary.effectiveVipSource == 'progression'
                    ? 'VIP طبيعي'
                    : '—',
          ),
          _statusRow('الصلاحية', _remainingTime(expiryMs)),
          _statusRow(
            'المحافظة',
            summary.earnedVipLevel <= 0
                ? '—'
                : '${formatCompactAmount(summary.maintenancePoints)} / ${formatCompactAmount(summary.maintenanceRequired)}',
          ),
        ],
      ),
    );
  }

  Widget _statusRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        children: [
          Text(label, style: const TextStyle(color: Colors.white54)),
          const Spacer(),
          Text(
            value,
            style: const TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }

  String _remainingTime(int expiryMs) {
    if (expiryMs <= 0) return '—';
    final remaining =
        Duration(milliseconds: expiryMs - DateTime.now().millisecondsSinceEpoch);
    if (remaining.isNegative || remaining == Duration.zero) return 'منتهية';
    if (remaining.inDays >= 1) return '${remaining.inDays} يوم';
    if (remaining.inHours >= 1) return '${remaining.inHours} ساعة';
    return '${remaining.inMinutes} دقيقة';
  }

  List<_VipCosmetic> _cosmeticsFor(int level) {
    final items = <_VipCosmetic>[
      _VipCosmetic(
        'شارة VIP',
        ShadowAssetKeys.vipLevelBadge(level),
        Icons.workspace_premium_rounded,
      ),
    ];
    if (level >= 2) {
      items.add(_VipCosmetic(
        'فقاعة الدردشة',
        ShadowAssetKeys.vipChatBubble(level),
        Icons.chat_bubble_rounded,
      ));
    }
    if (level >= 3) {
      items.add(_VipCosmetic(
        'إطار الصورة',
        ShadowAssetKeys.vipProfileFrame(level),
        Icons.account_circle_rounded,
      ));
    }
    if (level >= 4) {
      items.add(_VipCosmetic(
        'هدايا VIP',
        ShadowAssetKeys.vipGiftVisual(level),
        Icons.card_giftcard_rounded,
      ));
    }
    if (level >= 5) {
      items.addAll([
        _VipCosmetic(
          'خلفية شخصية',
          ShadowAssetKeys.vipProfileBackground(level),
          Icons.wallpaper_rounded,
        ),
        _VipCosmetic(
          'بطاقة بيانات',
          ShadowAssetKeys.vipDataCard(level),
          Icons.badge_rounded,
        ),
      ]);
    }
    if (level >= 6) {
      items.add(_VipCosmetic(
        'المركبة',
        ShadowAssetKeys.vipVehicle(level),
        Icons.directions_car_filled_rounded,
      ));
    }
    if (level >= 7) {
      items.add(_VipCosmetic(
        'الموجة الصوتية',
        ShadowAssetKeys.vipAudioWave(level),
        Icons.graphic_eq_rounded,
      ));
    }
    if (level >= 8) {
      items.add(_VipCosmetic(
        'شريط الدخول',
        ShadowAssetKeys.vipEntryStrip(level),
        Icons.login_rounded,
      ));
    }
    if (level >= 9) {
      items.add(_VipCosmetic(
        'زينة البروفايل',
        ShadowAssetKeys.vipProfileDecoration(level),
        Icons.auto_awesome_rounded,
      ));
    }
    if (level >= 10) {
      items.addAll([
        _VipCosmetic(
          'تأثير الاسم',
          ShadowAssetKeys.vipNameEffect(level),
          Icons.text_fields_rounded,
        ),
        _VipCosmetic(
          'شريط الدخول العام',
          ShadowAssetKeys.vipGlobalEntryBanner(level),
          Icons.campaign_rounded,
        ),
      ]);
    }
    return items;
  }

  List<String> _benefitsFor(int level) {
    const additions = <int, List<String>>{
      1: ['سجل المشاهدات', 'خدمة العملاء لـVIP', 'شارة VIP'],
      2: [
        'أولوية الظهور في قائمة المستخدمين المتصلين',
        'تغيير لون الاسم',
        'رسائل تحية بلا حدود',
        'فقاعة دردشة حصرية',
      ],
      3: ['مستوى مخفي', 'رقم فاخر حصري', 'إطار الصورة الحصري'],
      4: [
        'VIP هدايا',
        'خدمة عملاء حصرية',
        'امتياز ضمان المستوى',
        'رموز تعبيرية حصرية',
        'صورة متحركة GIF',
        'إخفاء إشعارات رسائل الفوز',
      ],
      5: [
        'بطاقة بيانات حصرية',
        'بث كامل عند ترقية المستوى',
        'إخفاء حالة الاتصال',
        'هدايا مخصصة',
        'خلفية شخصية',
      ],
      6: ['مركبة حصرية', 'الحماية من الطرد', 'تخصيص إطار الصورة الحصري'],
      7: [
        'تمديد فترة الصلاحية',
        'الإخفاء عند دخول الغرفة',
        'إخفاء القائمة',
        'موجة صوتية',
      ],
      8: [
        'عرض المركبات على صفحة الملف الشخصية',
        'شريط دخول',
        'مركبة خاصة',
      ],
      9: [
        'إخفاء الزيارات',
        'شريط دخول إلى الغرف',
        'خلفية بروفايل VIP خاصة',
        'زينة البروفايل',
      ],
      10: [
        'الحماية من الكتم',
        'تأثيرات الاسم المخصصة',
        'بطاقة تجربة VIP',
        'شارة VIP إضافية',
        'شريط دخول عام للتطبيق',
        'هدايا مخصصة وزينة VIP',
      ],
    };

    final result = <String>[];
    for (var current = 1; current <= level; current++) {
      result.addAll(additions[current] ?? const []);
    }
    return result;
  }
}

class _VipCosmetic {
  const _VipCosmetic(this.label, this.assetKey, this.icon);

  final String label;
  final String assetKey;
  final IconData icon;
}

class _PreviewBadge extends StatelessWidget {
  const _PreviewBadge();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
      decoration: BoxDecoration(
        color: Colors.black26,
        borderRadius: BorderRadius.circular(99),
        border: Border.all(color: Colors.white12),
      ),
      child: const Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.lock_outline_rounded, color: Colors.white54, size: 13),
          SizedBox(width: 4),
          Text(
            'معاينة',
            style: TextStyle(
              color: Colors.white60,
              fontSize: 10,
              fontWeight: FontWeight.w800,
            ),
          ),
        ],
      ),
    );
  }
}

class _VipFallbackCrest extends StatelessWidget {
  const _VipFallbackCrest({required this.level});

  final int level;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: const RadialGradient(
          colors: [
            Color(0xFFFFD98A),
            Color(0xFF7A451B),
            Color(0xFF2B1609),
          ],
        ),
        border: Border.all(color: const Color(0xFFFFD98A), width: 2),
      ),
      alignment: Alignment.center,
      child: Text(
        'VIP$level',
        textDirection: TextDirection.ltr,
        style: const TextStyle(
          color: Colors.white,
          fontSize: 30,
          fontWeight: FontWeight.w900,
        ),
      ),
    );
  }
}

class _VipInfoBlock extends StatelessWidget {
  const _VipInfoBlock({required this.title, required this.text});

  final String title;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFF151B28),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            title,
            style: const TextStyle(
              color: Color(0xFFFFD98A),
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            text,
            style: const TextStyle(
              color: Colors.white70,
              height: 1.55,
              fontSize: 12,
            ),
          ),
        ],
      ),
    );
  }
}
