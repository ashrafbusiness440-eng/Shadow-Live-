import 'package:flutter/material.dart';

import '../../../core/assets/shadow_asset_registry.dart';
import '../../../utils/compact_number.dart';
import '../services/user_level_service.dart';
import '../widgets/level_asset_image.dart';

typedef UpdateUserLevelVisibility = Future<UserLevelVisibility> Function({
  required bool hideWealthLevel,
  required bool hideAttractionLevel,
  required bool hideGameLevel,
});

class UserLevelScreen extends StatefulWidget {
  const UserLevelScreen({
    super.key,
    this.userId,
    this.initialTabIndex = 0,
    this.loadSummary,
    this.updateVisibility,
  });

  final String? userId;
  final int initialTabIndex;
  final Future<UserLevelSummary> Function()? loadSummary;
  final UpdateUserLevelVisibility? updateVisibility;

  @override
  State<UserLevelScreen> createState() => _UserLevelScreenState();
}

class _UserLevelScreenState extends State<UserLevelScreen> {
  UserLevelService? _service;
  UserLevelSummary? _summary;
  bool _loading = true;
  bool _savingVisibility = false;
  String? _error;
  int? _wealthPreviewSlice;
  int? _attractionPreviewSlice;
  int? _gamePreviewSlice;

  @override
  void initState() {
    super.initState();
    if (widget.loadSummary == null) {
      _service = UserLevelService();
    }
    _load();
  }

  @override
  void dispose() {
    _service?.close();
    super.dispose();
  }

  Future<void> _load() async {
    if (mounted) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }
    try {
      final targetUid = widget.userId?.trim() ?? '';
      final summary = await (
        widget.loadSummary?.call() ??
        (targetUid.isEmpty
            ? _service!.loadSelf()
            : _service!.loadForUser(targetUid))
      );
      if (!mounted) return;
      setState(() {
        _summary = summary;
        _wealthPreviewSlice ??= _sliceFor(summary.wealth.level, 5);
        _attractionPreviewSlice ??= _sliceFor(summary.attraction.level, 5);
        _gamePreviewSlice ??= summary.games.level <= 0
            ? 0
            : _sliceFor(summary.games.level, 3);
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = 'تعذر تحميل المستوى حالياً.';
      });
    }
  }

  Future<void> _toggleVisibility(String metric, bool value) async {
    final currentSummary = _summary;
    if (currentSummary == null ||
        !currentSummary.visibility.canEdit ||
        _savingVisibility) {
      return;
    }

    var next = currentSummary.visibility;
    switch (metric) {
      case 'wealth':
        next = next.copyWith(hideWealthLevel: value);
        break;
      case 'attraction':
        next = next.copyWith(hideAttractionLevel: value);
        break;
      case 'games':
        next = next.copyWith(hideGameLevel: value);
        break;
      default:
        return;
    }

    setState(() => _savingVisibility = true);
    try {
      final saved = await (widget.updateVisibility?.call(
            hideWealthLevel: next.hideWealthLevel,
            hideAttractionLevel: next.hideAttractionLevel,
            hideGameLevel: next.hideGameLevel,
          ) ??
          _service!.updateVisibility(
            hideWealthLevel: next.hideWealthLevel,
            hideAttractionLevel: next.hideAttractionLevel,
            hideGameLevel: next.hideGameLevel,
          ));
      if (!mounted) return;
      setState(() {
        _summary = currentSummary.copyWithVisibility(saved);
        _savingVisibility = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() => _savingVisibility = false);
      final code = error.toString().replaceFirst('Bad state: ', '');
      final message = code.contains('vip_required')
          ? 'ميزة مستوى مخفي متاحة من VIP3 فما فوق.'
          : 'تعذر تحديث إخفاء المستوى حالياً.';
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(message)),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: DefaultTabController(
        length: 3,
        initialIndex: widget.initialTabIndex.clamp(0, 2).toInt(),
        child: Scaffold(
          backgroundColor: const Color(0xFF020711),
          appBar: AppBar(
            backgroundColor: const Color(0xFF07111F),
            foregroundColor: Colors.white,
            title: const Text(
              'المستوى',
              style: TextStyle(fontWeight: FontWeight.w900),
            ),
            actions: [
              IconButton(
                tooltip: 'تحديث',
                onPressed: _loading ? null : _load,
                icon: const Icon(Icons.refresh_rounded),
              ),
            ],
            bottom: const TabBar(
              labelColor: Color(0xFFFFD54A),
              unselectedLabelColor: Colors.white54,
              indicatorColor: Color(0xFFFFD54A),
              tabs: [
                Tab(text: 'الثروة'),
                Tab(text: 'الجاذبية'),
                Tab(text: 'الألعاب'),
              ],
            ),
          ),
          body: _body(),
        ),
      ),
    );
  }

  Widget _body() {
    if (_loading && _summary == null) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null && _summary == null) {
      return _ErrorView(message: _error!, onRetry: _load);
    }

    final summary = _summary!;
    return Stack(
      children: [
        TabBarView(
          children: [
            _levelList(
              child: _section(
                metric: 'wealth',
                title: 'الثروة',
                subtitle: 'كل Coin مدفوع بهدية = نقطة ثروة',
                icon: Icons.monetization_on_rounded,
                data: summary.wealth,
                slices: const [
                  'LV1–5',
                  'LV6–10',
                  'LV11–15',
                  'LV16–20',
                  'LV21–25',
                  'LV26–30',
                  'LV31–35',
                ],
                currentSlice: _sliceFor(summary.wealth.level, 5),
                previewSlice: _wealthPreviewSlice,
                onSliceSelected: (index) => setState(() => _wealthPreviewSlice = index),
                footer: _wealthPrivilegesForSlice(
                  _wealthPreviewSlice ?? _sliceFor(summary.wealth.level, 5),
                  _sliceFor(summary.wealth.level, 5),
                ),
                canEditVisibility: summary.visibility.canEdit,
                hiddenPreference: summary.visibility.hideWealthLevel,
              ),
            ),
            _levelList(
              child: _section(
                metric: 'attraction',
                title: 'الجاذبية',
                subtitle: 'تُحتسب من القيمة الاسمية الكاملة للهدايا المستلمة',
                icon: Icons.auto_awesome_rounded,
                data: summary.attraction,
                slices: const [
                  'LV1–5',
                  'LV6–10',
                  'LV11–15',
                  'LV16–20',
                  'LV21–25',
                  'LV26–30',
                  'LV31–35',
                ],
                currentSlice: _sliceFor(summary.attraction.level, 5),
                previewSlice: _attractionPreviewSlice,
                onSliceSelected: (index) =>
                    setState(() => _attractionPreviewSlice = index),
                footer: _rankPreview(
                  metric: 'attraction',
                  selectedSlice:
                      _attractionPreviewSlice ?? _sliceFor(summary.attraction.level, 5),
                  currentSlice: _sliceFor(summary.attraction.level, 5),
                ),
                canEditVisibility: summary.visibility.canEdit,
                hiddenPreference: summary.visibility.hideAttractionLevel,
              ),
            ),
            _levelList(
              child: _section(
                metric: 'games',
                title: 'الألعاب',
                subtitle: 'كل Coin يتم رهانها أو صرفها في الألعاب = نقطة لعبة',
                icon: Icons.sports_esports_rounded,
                data: summary.games,
                slices: const [
                  'LV1–3',
                  'LV4–6',
                  'LV7–9',
                  'LV10–12',
                  'LV13–15',
                  'LV16–18',
                  'LV19–21',
                ],
                currentSlice: summary.games.level <= 0
                    ? -1
                    : _sliceFor(summary.games.level, 3),
                previewSlice: _gamePreviewSlice,
                onSliceSelected: (index) =>
                    setState(() => _gamePreviewSlice = index),
                footer: Column(
                  children: [
                    _rankPreview(
                      metric: 'game',
                      selectedSlice: _gamePreviewSlice ?? 0,
                      currentSlice: summary.games.level <= 0
                          ? -1
                          : _sliceFor(summary.games.level, 3),
                    ),
                    const SizedBox(height: 12),
                    _gameFooter(summary.games),
                  ],
                ),
                canEditVisibility: summary.visibility.canEdit,
                hiddenPreference: summary.visibility.hideGameLevel,
              ),
            ),
          ],
        ),
        if (_loading)
          const Positioned(
            left: 0,
            right: 0,
            top: 0,
            child: LinearProgressIndicator(minHeight: 2),
          ),
      ],
    );
  }

  Widget _levelList({required Widget child}) {
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 18, 16, 30),
        children: [child],
      ),
    );
  }

  Widget _section({
    required String metric,
    required String title,
    required String subtitle,
    required IconData icon,
    required UserLevelSectionSummary data,
    required List<String> slices,
    required int currentSlice,
    int? previewSlice,
    ValueChanged<int>? onSliceSelected,
    required Widget footer,
    required bool canEditVisibility,
    required bool hiddenPreference,
  }) {
    if (data.hidden) {
      return _HiddenLevelCard(title: title, icon: icon);
    }

    final progress =
        (data.progressBps / 10000).clamp(0.0, 1.0).toDouble();
    final levelLabel = data.level <= 0 ? 'LV0' : 'LV${data.level}';

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Container(
          padding: const EdgeInsets.all(18),
          decoration: BoxDecoration(
            color: const Color(0xFF0C1728),
            borderRadius: BorderRadius.circular(24),
            border: Border.all(color: Colors.white10),
          ),
          child: Column(
            children: [
              Container(
                width: 92,
                height: 92,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: const Color(0xFF171D31),
                  border: Border.all(
                    color: const Color(0xFFFFD54A),
                    width: 2,
                  ),
                ),
                child: LevelAssetImage(
                  assetKey: ShadowAssetKeys.levelMainBadge(
                    metric == 'games' ? 'game' : metric,
                    _assetLevelForSlice(metric, previewSlice ?? currentSlice, data.level),
                  ),
                  width: 78,
                  height: 78,
                  fallback: Icon(
                    icon,
                    size: 48,
                    color: const Color(0xFFFFD54A),
                  ),
                ),
              ),
              const SizedBox(height: 12),
              Text(
                previewSlice != null && previewSlice >= 0
                    ? slices[previewSlice]
                    : title,
                textDirection: previewSlice != null ? TextDirection.ltr : TextDirection.rtl,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 22,
                  fontWeight: FontWeight.w900,
                ),
              ),
              if (previewSlice != null) ...[
                const SizedBox(height: 5),
                Text(
                  previewSlice > currentSlice
                      ? 'معاينة فقط — تُفتح عند الوصول إلى هذه الفئة'
                      : previewSlice == currentSlice
                          ? 'فئتك الحالية'
                          : 'فئة تم فتحها',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: previewSlice > currentSlice
                        ? Colors.white54
                        : const Color(0xFFFFD54A),
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
              const SizedBox(height: 4),
              Text(
                subtitle,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: Colors.white60,
                  fontSize: 12,
                  height: 1.45,
                ),
              ),
              const SizedBox(height: 18),
              Row(
                children: [
                  Expanded(child: _metric(levelLabel, 'المستوى')),
                  Expanded(
                    child: _metric(
                      formatCompactAmount(data.points),
                      'النقاط',
                    ),
                  ),
                  Expanded(
                    child: _metric(
                      data.remaining == 0
                          ? 'مكتمل'
                          : formatCompactAmount(data.remaining),
                      'المتبقي',
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 18),
              ClipRRect(
                borderRadius: BorderRadius.circular(99),
                child: LinearProgressIndicator(
                  value: progress,
                  minHeight: 10,
                  backgroundColor: Colors.white10,
                  valueColor: const AlwaysStoppedAnimation<Color>(
                    Color(0xFFFFD54A),
                  ),
                ),
              ),
              const SizedBox(height: 8),
              Align(
                alignment: Alignment.centerLeft,
                child: Text(
                  '${(data.progressBps / 100).toStringAsFixed(1)}%',
                  textDirection: TextDirection.ltr,
                  style: const TextStyle(
                    color: Colors.white54,
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          ),
        ),
        if (canEditVisibility) ...[
          const SizedBox(height: 14),
          _visibilityControl(
            metric: metric,
            title: title,
            value: hiddenPreference,
          ),
        ],
        const SizedBox(height: 14),
        _sliceGrid(
          slices,
          currentSlice,
          selected: previewSlice,
          onSelected: onSliceSelected,
        ),
        const SizedBox(height: 14),
        footer,
      ],
    );
  }

  Widget _visibilityControl({
    required String metric,
    required String title,
    required bool value,
  }) {
    return Material(
      color: const Color(0xFF0C1728),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(20),
        side: const BorderSide(color: Colors.white10),
      ),
      clipBehavior: Clip.antiAlias,
      child: SwitchListTile.adaptive(
        key: Key('level-visibility-$metric'),
        value: value,
        onChanged: _savingVisibility
            ? null
            : (next) => _toggleVisibility(metric, next),
        activeThumbColor: const Color(0xFFFFD54A),
        title: Text(
          'إخفاء مستوى $title',
          style: const TextStyle(
            color: Colors.white,
            fontWeight: FontWeight.w900,
          ),
        ),
        subtitle: const Text(
          'ميزة VIP3+ — تخفي هذا القسم عن العامة فقط، بدون تغيير نقاطك أو مستواك الحقيقي.',
          style: TextStyle(color: Colors.white54, fontSize: 11, height: 1.4),
        ),
      ),
    );
  }

  int _sliceFor(int level, int size) {
    if (level <= 0) return -1;
    return ((level - 1) ~/ size).clamp(0, 6).toInt();
  }

  Widget _sliceGrid(
    List<String> labels,
    int current, {
    int? selected,
    ValueChanged<int>? onSelected,
  }) {
    final selectedIndex = selected ?? current;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFF0C1728),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: Colors.white10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            onSelected == null ? 'شارات الفئات' : 'استعرض جميع الفئات',
            style: const TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.w900,
            ),
          ),
          if (onSelected != null) ...[
            const SizedBox(height: 5),
            const Text(
              'يمكنك معاينة شكل أي مستوى قبل الوصول إليه. القفل يمنع الاستخدام فقط ولا يمنع المشاهدة.',
              style: TextStyle(
                color: Colors.white54,
                fontSize: 11,
                height: 1.4,
              ),
            ),
          ],
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: labels.asMap().entries.map((entry) {
              final active = entry.key == selectedIndex;
              final unlocked = current >= 0 && entry.key <= current;
              final chip = Container(
                key: Key('level-tier-${entry.key}'),
                padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 9),
                decoration: BoxDecoration(
                  color: active
                      ? const Color(0xFF3A2166)
                      : const Color(0xFF131D2C),
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(
                    color: active
                        ? const Color(0xFFFFD54A)
                        : Colors.white10,
                  ),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      unlocked
                          ? Icons.workspace_premium_rounded
                          : Icons.lock_outline_rounded,
                      size: 16,
                      color: active
                          ? const Color(0xFFFFD54A)
                          : Colors.white38,
                    ),
                    const SizedBox(width: 6),
                    Text(
                      entry.value,
                      textDirection: TextDirection.ltr,
                      style: TextStyle(
                        color: active ? Colors.white : Colors.white54,
                        fontSize: 11,
                        fontWeight:
                            active ? FontWeight.w900 : FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              );
              if (onSelected == null) return chip;
              return InkWell(
                key: Key('level-tier-preview-${entry.key}'),
                borderRadius: BorderRadius.circular(14),
                onTap: () => onSelected(entry.key),
                child: chip,
              );
            }).toList(),
          ),
        ],
      ),
    );
  }

  Widget _metric(String value, String label) {
    return Column(
      children: [
        Text(
          value,
          textDirection: TextDirection.ltr,
          style: const TextStyle(
            color: Color(0xFFFFD54A),
            fontSize: 17,
            fontWeight: FontWeight.w900,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          label,
          style: const TextStyle(color: Colors.white54, fontSize: 11),
        ),
      ],
    );
  }

  int _assetLevelForSlice(String metric, int slice, int fallbackLevel) {
    if (slice < 0) return fallbackLevel;
    if (metric == 'wealth' || metric == 'attraction') {
      return slice * 5 + 1;
    }
    if (metric == 'game' || metric == 'games') {
      return slice * 3 + 1;
    }
    return fallbackLevel;
  }

  String _wealthBucketForSlice(int slice) {
    final safe = slice.clamp(0, 6);
    final start = safe * 5 + 1;
    final end = start + 4;
    return 'lv${start.toString().padLeft(2, '0')}_${end.toString().padLeft(2, '0')}';
  }

  Widget _wealthPrivilegesForSlice(int selectedSlice, int currentSlice) {
    final safeSlice = selectedSlice.clamp(0, 6);
    final previewLevel = safeSlice * 5 + 1;
    final locked = currentSlice < safeSlice;
    final bucket = _wealthBucketForSlice(safeSlice);

    final items = <({String label, String suffix})>[
      (label: 'شعار الثروة', suffix: 'wealthBadge'),
      (label: 'إعلان الترقية', suffix: 'upgradeAnnouncement'),
      (label: 'مؤثر الدخول', suffix: 'entryEffect'),
      (label: 'فقاعة الدردشة', suffix: 'chatBubble'),
      (label: 'إطار الصورة الشخصية', suffix: 'profileFrame'),
      if (previewLevel >= 6)
        (label: 'شريط الدعم', suffix: 'supportBar'),
      if (previewLevel >= 11)
        (label: 'تأثير إرسال هدية الامتياز', suffix: 'giftPrivilege'),
      if (previewLevel >= 16)
        (label: 'شريط الدخول', suffix: 'entryBar'),
      if (previewLevel >= 21)
        (label: 'المركبة', suffix: 'vehicle'),
    ];

    return Container(
      key: const Key('wealth-privilege-preview'),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFF140D03),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: const Color(0x55FFD77A)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              const Expanded(
                child: Text(
                  'الامتيازات',
                  style: TextStyle(
                    color: Color(0xFFFFD98A),
                    fontSize: 18,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              if (locked)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
                  decoration: BoxDecoration(
                    color: Colors.black26,
                    borderRadius: BorderRadius.circular(99),
                    border: Border.all(color: Colors.white12),
                  ),
                  child: const Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.lock_rounded, size: 13, color: Colors.white60),
                      SizedBox(width: 4),
                      Text(
                        'معاينة',
                        style: TextStyle(
                          color: Colors.white70,
                          fontSize: 10,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ],
                  ),
                ),
            ],
          ),
          const SizedBox(height: 12),
          GridView.builder(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            itemCount: items.length,
            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 3,
              crossAxisSpacing: 9,
              mainAxisSpacing: 12,
              childAspectRatio: 0.86,
            ),
            itemBuilder: (context, index) {
              final item = items[index];
              final assetKey = 'levels.wealth.$bucket.${item.suffix}';
              return Column(
                children: [
                  Expanded(
                    child: Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(7),
                      decoration: BoxDecoration(
                        color: const Color(0xFF2B1A06),
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(color: const Color(0x44FFD77A)),
                      ),
                      child: Stack(
                        alignment: Alignment.center,
                        children: [
                          LevelAssetImage(
                            assetKey: assetKey,
                            fit: BoxFit.contain,
                            fallback: const Icon(
                              Icons.auto_awesome_rounded,
                              color: Color(0xFFFFD54A),
                              size: 34,
                            ),
                          ),
                          if (locked)
                            const Positioned(
                              top: 2,
                              left: 2,
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
                      color: Color(0xFFFFE4AF),
                      fontSize: 10.5,
                      height: 1.25,
                    ),
                  ),
                ],
              );
            },
          ),
          if (locked) ...[
            const SizedBox(height: 10),
            const Text(
              'يمكنك مشاهدة هذه التصاميم الآن، لكنها لا تصبح قابلة للاستخدام إلا بعد فتح الفئة.',
              textAlign: TextAlign.center,
              style: TextStyle(
                color: Colors.white54,
                fontSize: 10.5,
                height: 1.4,
              ),
            ),
          ],
        ],
      ),
    );
  }


  String _bucketForMetricSlice(String metric, int slice) {
    final safe = slice.clamp(0, 6);
    if (metric == 'game') {
      final start = safe * 3 + 1;
      final end = start + 2;
      return 'lv${start.toString().padLeft(2, '0')}_${end.toString().padLeft(2, '0')}';
    }
    final start = safe * 5 + 1;
    final end = start + 4;
    return 'lv${start.toString().padLeft(2, '0')}_${end.toString().padLeft(2, '0')}';
  }

  Widget _rankPreview({
    required String metric,
    required int selectedSlice,
    required int currentSlice,
  }) {
    final locked = currentSlice < selectedSlice;
    final bucket = _bucketForMetricSlice(metric, selectedSlice);
    final accent = metric == 'attraction'
        ? const Color(0xFFFF4FD8)
        : const Color(0xFF66D1FF);
    final label = metric == 'attraction' ? 'شارة الجاذبية' : 'شارة الألعاب';
    final suffix = 'miniBadge';
    final key = 'levels.$metric.$bucket.$suffix';

    return Container(
      key: Key('${metric}-rank-preview'),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFF140A1A),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: accent.withValues(alpha: 0.35)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  label,
                  style: TextStyle(
                    color: accent,
                    fontSize: 18,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              if (locked)
                const Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.lock_outline_rounded, size: 14, color: Colors.white54),
                    SizedBox(width: 4),
                    Text(
                      'معاينة فقط',
                      style: TextStyle(color: Colors.white60, fontSize: 10),
                    ),
                  ],
                ),
            ],
          ),
          const SizedBox(height: 12),
          Container(
            height: 170,
            padding: const EdgeInsets.all(18),
            decoration: BoxDecoration(
              color: const Color(0xFF220B27),
              borderRadius: BorderRadius.circular(16),
            ),
            child: LevelAssetImage(
              assetKey: key,
              fit: BoxFit.contain,
              fallback: Icon(
                metric == 'attraction'
                    ? Icons.auto_awesome_rounded
                    : Icons.sports_esports_rounded,
                size: 54,
                color: accent,
              ),
            ),
          ),
          const SizedBox(height: 10),
          Text(
            locked
                ? 'يمكن مشاهدة شكل هذه الفئة الآن، وتُفتح عند الوصول إليها.'
                : 'هذه الفئة متاحة لك للعرض.',
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: Colors.white60,
              fontSize: 11,
              height: 1.4,
            ),
          ),
        ],
      ),
    );
  }

  Widget _gameFooter(UserGameLevelSummary games) {
    return Column(
      children: [
        if (games.pendingDecayPoints > 0)
          _InfoCard(
            title: 'خصم الخمول محسوب',
            text:
                'الرصيد الظاهر يتضمن ${formatCompactAmount(games.pendingDecayPoints)} نقطة خصم مستحقة عن ${games.pendingDecayDays} يوم. يتم تثبيت الخصم Server-side عند عودتك للعب.',
          ),
        if (games.pendingDecayPoints > 0) const SizedBox(height: 12),
        const _InfoCard(
          title: 'دعم اللعبة',
          text:
              'إذا واجهت مشكلة في احتساب نقاط الألعاب، تواصل مع خدمة العملاء من قسم الرسائل.',
        ),
      ],
    );
  }
}

class _HiddenLevelCard extends StatelessWidget {
  const _HiddenLevelCard({required this.title, required this.icon});

  final String title;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 34),
      decoration: BoxDecoration(
        color: const Color(0xFF0C1728),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: Colors.white10),
      ),
      child: Column(
        children: [
          Icon(icon, size: 48, color: Colors.white30),
          const SizedBox(height: 14),
          const Text(
            'مستوى مخفي',
            style: TextStyle(
              color: Color(0xFFFFD54A),
              fontSize: 22,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'اختار المستخدم إخفاء مستوى $title عن العامة.',
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: Colors.white60,
              fontSize: 12,
              height: 1.45,
            ),
          ),
        ],
      ),
    );
  }
}

class _InfoCard extends StatelessWidget {
  const _InfoCard({
    required this.title,
    required this.text,
  });

  final String title;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF0C1728),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: Colors.white10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            title,
            style: const TextStyle(
              color: Color(0xFFFFD54A),
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 7),
          Text(
            text,
            style: const TextStyle(
              color: Colors.white70,
              height: 1.45,
              fontSize: 12,
            ),
          ),
        ],
      ),
    );
  }
}

class _ErrorView extends StatelessWidget {
  const _ErrorView({
    required this.message,
    required this.onRetry,
  });

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
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
              message,
              textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.white70),
            ),
            const SizedBox(height: 14),
            FilledButton(
              onPressed: onRetry,
              child: const Text('إعادة المحاولة'),
            ),
          ],
        ),
      ),
    );
  }
}
