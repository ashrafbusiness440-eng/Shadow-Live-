import 'dart:async';

import 'package:flutter/material.dart';

import '../../features/profile/services/user_level_service.dart';
import '../../features/mysterious/screens/mysterious_person_screen.dart';
import '../../features/mysterious/services/mysterious_person_service.dart';
import '../../features/room/services/room_action_service.dart';
import '../../features/vip/screens/vip_screen.dart';
import '../../features/vip/screens/profile_visit_history_screen.dart';
import '../../features/vip/services/vip_service.dart';

class VipPrivacySettingsScreen extends StatefulWidget {
  const VipPrivacySettingsScreen({super.key});

  @override
  State<VipPrivacySettingsScreen> createState() =>
      _VipPrivacySettingsScreenState();
}

class _VipPrivacySettingsScreenState extends State<VipPrivacySettingsScreen> {
  final UserLevelService _levels = UserLevelService();
  final RoomActionService _rooms = RoomActionService();
  final VipService _vip = VipService();
  final MysteriousPersonService _mysterious = MysteriousPersonService();

  UserLevelSummary? _levelSummary;
  RoomGhostState? _ghost;
  RoomHiddenEntryState? _hiddenEntry;
  VipSummaryData? _vipSummary;
  MysteriousPersonState? _mysteriousState;
  bool _loading = true;
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  @override
  void dispose() {
    _levels.close();
    _vip.close();
    _mysterious.close();
    super.dispose();
  }

  Future<Object?> _loadMysteriousSafely() async {
    try {
      return await _mysterious.loadState();
    } catch (_) {
      return null;
    }
  }

  Future<void> _load() async {
    if (mounted) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }
    try {
      final results = await Future.wait<Object?>([
        _levels.loadSelf(),
        _rooms.loadGhostState(),
        _rooms.loadHiddenEntryState(),
        _vip.loadSummary(),
        _loadMysteriousSafely(),
      ]);
      if (!mounted) return;
      setState(() {
        _levelSummary = results[0] as UserLevelSummary;
        _ghost = results[1] as RoomGhostState;
        _hiddenEntry = results[2] as RoomHiddenEntryState;
        _vipSummary = results[3] as VipSummaryData;
        _mysteriousState = results[4] as MysteriousPersonState?;
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = 'تعذر تحميل إعدادات التخفي حالياً.';
      });
    }
  }

  void _openVip(int level) {
    Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => const VipScreen()),
    );
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('هذه الميزة تبدأ من VIP$level.')),
    );
  }

  Future<void> _saveLevelVisibility(String metric, bool enabled) async {
    final current = _levelSummary;
    if (current == null || _saving) return;
    final visibility = current.visibility;
    if (!visibility.canEdit) {
      _openVip(3);
      return;
    }

    var wealth = visibility.hideWealthLevel;
    var attraction = visibility.hideAttractionLevel;
    var games = visibility.hideGameLevel;
    if (metric == 'wealth') wealth = enabled;
    if (metric == 'attraction') attraction = enabled;
    if (metric == 'games') games = enabled;

    setState(() => _saving = true);
    try {
      final saved = await _levels.updateVisibility(
        hideWealthLevel: wealth,
        hideAttractionLevel: attraction,
        hideGameLevel: games,
      );
      if (!mounted) return;
      setState(() {
        _levelSummary = current.copyWithVisibility(saved);
        _saving = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _saving = false);
      _message('تعذر تحديث إخفاء المستوى حالياً.');
    }
  }

  Future<void> _saveGhost(bool enabled) async {
    final current = _ghost;
    if (current == null || _saving) return;
    if (!current.canUseGhostMode) {
      _openVip(current.requiredVipLevel);
      return;
    }
    setState(() => _saving = true);
    try {
      final value = await _rooms.setGhostMode(enabled);
      if (!mounted) return;
      setState(() {
        _ghost = RoomGhostState(
          ghostMode: value,
          canUseGhostMode: current.canUseGhostMode,
          requiredVipLevel: current.requiredVipLevel,
        );
        _saving = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _saving = false);
      _message('تعذر تحديث إخفاء حالة الاتصال حالياً.');
    }
  }

  Future<void> _saveHiddenEntry(bool enabled) async {
    final current = _hiddenEntry;
    if (current == null || _saving) return;
    if (!current.canUseHiddenRoomEntry) {
      _openVip(current.requiredVipLevel);
      return;
    }
    setState(() => _saving = true);
    try {
      final value = await _rooms.setHiddenEntry(enabled);
      if (!mounted) return;
      setState(() {
        _hiddenEntry = RoomHiddenEntryState(
          hiddenRoomEntry: value,
          canUseHiddenRoomEntry: current.canUseHiddenRoomEntry,
          requiredVipLevel: current.requiredVipLevel,
        );
        _saving = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _saving = false);
      _message('تعذر تحديث الدخول المخفي حالياً.');
    }
  }

  Future<void> _saveHideLists(bool enabled) async {
    final current = _vipSummary;
    if (current == null || _saving) return;
    if (!current.canHideRankingLists) {
      _openVip(7);
      return;
    }
    setState(() => _saving = true);
    try {
      final saved = await _vip.setHideRankingLists(enabled);
      if (!mounted) return;
      setState(() {
        _vipSummary = VipSummaryData(
          effectiveVipLevel: current.effectiveVipLevel,
          effectiveVipSource: current.effectiveVipSource,
          earnedVipLevel: current.earnedVipLevel,
          adminGrantVipLevel: current.adminGrantVipLevel,
          growthPoints: current.growthPoints,
          maintenancePoints: current.maintenancePoints,
          maintenanceRequired: current.maintenanceRequired,
          currentThreshold: current.currentThreshold,
          remainingToNext: current.remainingToNext,
          maxGrowthPoints: current.maxGrowthPoints,
          earnedVipExpiresAtMs: current.earnedVipExpiresAtMs,
          adminGrantExpiresAtMs: current.adminGrantExpiresAtMs,
          coins: current.coins,
          purchaseGrowthPerCoin: current.purchaseGrowthPerCoin,
          paidRechargeGrowthPerCoin: current.paidRechargeGrowthPerCoin,
          canHideRankingLists: saved.canHideRankingLists,
          hideRankingLists: saved.hideRankingLists,
          canHideProfileVisits: current.canHideProfileVisits,
          hideProfileVisits: current.hideProfileVisits,
          canUseFriendsOnlyMessages: current.canUseFriendsOnlyMessages,
          friendsOnlyMessages: current.friendsOnlyMessages,
        );
        _saving = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _saving = false);
      _message('تعذر تحديث إخفاء الترتيب حالياً.');
    }
  }

  Future<void> _saveHideProfileVisits(bool enabled) async {
    final current = _vipSummary;
    if (current == null || _saving) return;
    if (!current.canHideProfileVisits) {
      _openVip(9);
      return;
    }
    setState(() => _saving = true);
    try {
      final saved = await _vip.setHideProfileVisits(enabled);
      if (!mounted) return;
      setState(() {
        _vipSummary = VipSummaryData(
          effectiveVipLevel: current.effectiveVipLevel,
          effectiveVipSource: current.effectiveVipSource,
          earnedVipLevel: current.earnedVipLevel,
          adminGrantVipLevel: current.adminGrantVipLevel,
          growthPoints: current.growthPoints,
          maintenancePoints: current.maintenancePoints,
          maintenanceRequired: current.maintenanceRequired,
          currentThreshold: current.currentThreshold,
          remainingToNext: current.remainingToNext,
          maxGrowthPoints: current.maxGrowthPoints,
          earnedVipExpiresAtMs: current.earnedVipExpiresAtMs,
          adminGrantExpiresAtMs: current.adminGrantExpiresAtMs,
          coins: current.coins,
          purchaseGrowthPerCoin: current.purchaseGrowthPerCoin,
          paidRechargeGrowthPerCoin: current.paidRechargeGrowthPerCoin,
          canHideRankingLists: current.canHideRankingLists,
          hideRankingLists: current.hideRankingLists,
          canHideProfileVisits: saved.canHideProfileVisits,
          hideProfileVisits: saved.hideProfileVisits,
          canUseFriendsOnlyMessages: current.canUseFriendsOnlyMessages,
          friendsOnlyMessages: current.friendsOnlyMessages,
        );
        _saving = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _saving = false);
      _message('تعذر تحديث إخفاء زيارات الملف حالياً.');
    }
  }

  Future<void> _saveFriendsOnlyMessages(bool enabled) async {
    final current = _vipSummary;
    if (current == null || _saving) return;
    if (!current.canUseFriendsOnlyMessages) {
      _openVip(1);
      return;
    }
    setState(() => _saving = true);
    try {
      final saved = await _vip.setFriendsOnlyMessages(enabled);
      if (!mounted) return;
      setState(() {
        _vipSummary = VipSummaryData(
          effectiveVipLevel: current.effectiveVipLevel,
          effectiveVipSource: current.effectiveVipSource,
          earnedVipLevel: current.earnedVipLevel,
          adminGrantVipLevel: current.adminGrantVipLevel,
          growthPoints: current.growthPoints,
          maintenancePoints: current.maintenancePoints,
          maintenanceRequired: current.maintenanceRequired,
          currentThreshold: current.currentThreshold,
          remainingToNext: current.remainingToNext,
          maxGrowthPoints: current.maxGrowthPoints,
          earnedVipExpiresAtMs: current.earnedVipExpiresAtMs,
          adminGrantExpiresAtMs: current.adminGrantExpiresAtMs,
          coins: current.coins,
          purchaseGrowthPerCoin: current.purchaseGrowthPerCoin,
          paidRechargeGrowthPerCoin: current.paidRechargeGrowthPerCoin,
          canHideRankingLists: current.canHideRankingLists,
          hideRankingLists: current.hideRankingLists,
          canHideProfileVisits: current.canHideProfileVisits,
          hideProfileVisits: current.hideProfileVisits,
          canUseFriendsOnlyMessages: saved.canUseFriendsOnlyMessages,
          friendsOnlyMessages: saved.friendsOnlyMessages,
        );
        _saving = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _saving = false);
      _message('تعذر تحديث خصوصية الرسائل حالياً.');
    }
  }

  Future<void> _saveVip4Privacy(String field, bool enabled) async {
    final current = _vipSummary;
    if (current == null || _saving) return;
    final unlocked = switch (field) {
      'hideNobleLevel' => current.canHideNobleLevel,
      'hideGameWinBanner' => current.canHideGameWinBanner,
      'hideBetWinNotification' => current.canHideBetWinNotification,
      _ => false,
    };
    if (!unlocked) {
      _openVip(4);
      return;
    }
    setState(() => _saving = true);
    try {
      final saved = await _vip.setVip4PrivacyPreference(
        field: field,
        enabled: enabled,
      );
      if (!mounted) return;
      setState(() {
        _vipSummary = switch (saved.field) {
          'hideNobleLevel' => current.copyWith(
              canHideNobleLevel: saved.canUse,
              hideNobleLevel: saved.enabled,
            ),
          'hideGameWinBanner' => current.copyWith(
              canHideGameWinBanner: saved.canUse,
              hideGameWinBanner: saved.enabled,
            ),
          'hideBetWinNotification' => current.copyWith(
              canHideBetWinNotification: saved.canUse,
              hideBetWinNotification: saved.enabled,
            ),
          _ => current,
        };
        _saving = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _saving = false);
      _message('تعذر تحديث إعداد الخصوصية حالياً.');
    }
  }

  Future<void> _openMysterious() async {
    await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => const MysteriousPersonScreen()),
    );
    try {
      final state = await _mysterious.loadState();
      if (mounted) setState(() => _mysteriousState = state);
    } catch (_) {}
  }

  Future<bool> _confirmMysteriousEnable() async {
    return await showDialog<bool>(
          context: context,
          builder: (dialogContext) => Directionality(
            textDirection: TextDirection.rtl,
            child: AlertDialog(
              backgroundColor: const Color(0xFF101827),
              title: const Text(
                'تشغيل الشخص الغامض',
                style: TextStyle(color: Colors.white),
              ),
              content: const Text(
                'عند التشغيل تظهر بهويتك الغامضة في الأماكن المعتمدة داخل غرف الصوت والترتيبات المرتبطة بها. نقاطك ومركزك وحسابك الحقيقي لا تتغير، وإيقاف الوضع لا يوقف مدة الاشتراك.',
                style: TextStyle(color: Colors.white70, height: 1.6),
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.pop(dialogContext, false),
                  child: const Text('إلغاء'),
                ),
                FilledButton(
                  onPressed: () => Navigator.pop(dialogContext, true),
                  child: const Text('فهمت، متابعة'),
                ),
              ],
            ),
          ),
        ) ??
        false;
  }

  Future<void> _saveMysterious(bool enabled) async {
    if (_saving) return;
    final current = _mysteriousState;
    if (current == null) {
      await _openMysterious();
      return;
    }
    if (enabled) {
      final confirmed = await _confirmMysteriousEnable();
      if (!confirmed || !mounted) return;
      if (!current.active) {
        await _openMysterious();
        return;
      }
    }

    setState(() => _saving = true);
    try {
      final saved = await _mysterious.setEnabled(enabled);
      if (!mounted) return;
      setState(() {
        _mysteriousState = saved;
        _saving = false;
      });
      if (enabled) await _openMysterious();
    } catch (_) {
      if (!mounted) return;
      setState(() => _saving = false);
      _message('تعذر تحديث وضع الشخص الغامض حالياً.');
    }
  }

  void _openVisitHistory() {
    Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => const ProfileVisitHistoryScreen()),
    );
  }

  void _message(String text) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: const Color(0xFF050814),
        appBar: AppBar(
          backgroundColor: const Color(0xFF0B1220),
          foregroundColor: Colors.white,
          title: const Text(
            'إعداد التخفي',
            style: TextStyle(fontWeight: FontWeight.w900),
          ),
          actions: [
            IconButton(
              tooltip: 'تحديث',
              onPressed: _loading || _saving ? null : _load,
              icon: const Icon(Icons.refresh_rounded),
            ),
          ],
        ),
        body: _body(),
      ),
    );
  }

  Widget _body() {
    if (_loading && _levelSummary == null) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null && _levelSummary == null) {
      return Center(
        child: FilledButton.icon(
          onPressed: _load,
          icon: const Icon(Icons.refresh_rounded),
          label: const Text('إعادة المحاولة'),
        ),
      );
    }

    final levels = _levelSummary!;
    final ghost = _ghost!;
    final hiddenEntry = _hiddenEntry!;
    final vip = _vipSummary!;
    final mysterious = _mysteriousState;

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(14, 16, 14, 32),
        children: [
          _intro(vip.effectiveVipLevel),
          const SizedBox(height: 14),
          _section(
            title: 'الشخص الغامض',
            children: [
              ListTile(
                key: const Key('mysterious-person-entry'),
                leading: const Icon(
                  Icons.theater_comedy_rounded,
                  color: Color(0xFFFFD166),
                ),
                title: const Text(
                  'الشخص الغامض',
                  style: TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                subtitle: Text(
                  mysterious == null
                      ? 'اضغط لفتح النظام'
                      : mysterious.active
                          ? (mysterious.enabled
                              ? 'الوضع مفعّل — اضغط لعرض التفاصيل'
                              : 'الاشتراك فعّال والوضع متوقف')
                          : 'نظام مستقل — اضغط للشراء أو التمديد',
                  style: const TextStyle(color: Colors.white54, fontSize: 12),
                ),
                trailing: Switch(
                  value: mysterious?.enabled ?? false,
                  onChanged: _saving
                      ? null
                      : (value) => unawaited(_saveMysterious(value)),
                ),
                onTap: _saving ? null : () => unawaited(_openMysterious()),
              ),
            ],
          ),
          const SizedBox(height: 14),
          _section(
            title: 'إخفاء المستويات',
            children: [
              _toggle(
                keyName: 'vip-privacy-hide-wealth',
                title: 'إخفاء مستوى الثروة',
                subtitle: 'VIP3+ — إخفاء العرض فقط بدون تغيير النقاط.',
                value: levels.visibility.hideWealthLevel,
                unlocked: levels.visibility.canEdit,
                requiredVip: 3,
                onChanged: (v) => _saveLevelVisibility('wealth', v),
              ),
              _toggle(
                keyName: 'vip-privacy-hide-attraction',
                title: 'إخفاء مستوى الجاذبية',
                subtitle: 'VIP3+ — إخفاء العرض فقط بدون تغيير النقاط.',
                value: levels.visibility.hideAttractionLevel,
                unlocked: levels.visibility.canEdit,
                requiredVip: 3,
                onChanged: (v) => _saveLevelVisibility('attraction', v),
              ),
              _toggle(
                keyName: 'vip-privacy-hide-games',
                title: 'إخفاء مستوى الألعاب',
                subtitle: 'VIP3+ — لا يؤثر على نقاط الألعاب أو الخمول.',
                value: levels.visibility.hideGameLevel,
                unlocked: levels.visibility.canEdit,
                requiredVip: 3,
                onChanged: (v) => _saveLevelVisibility('games', v),
              ),
              _toggle(
                keyName: 'vip-privacy-hide-noble-level',
                title: 'إخفاء مستوى النبلاء',
                subtitle:
                    'VIP4+ — يخفي ظهور مستوى النبلاء فقط ولا يغيّر تقدمه.',
                value: vip.hideNobleLevel,
                unlocked: vip.canHideNobleLevel,
                requiredVip: 4,
                onChanged: (v) => _saveVip4Privacy('hideNobleLevel', v),
              ),
            ],
          ),
          const SizedBox(height: 14),
          _section(
            title: 'الرسائل',
            children: [
              _toggle(
                keyName: 'vip-privacy-friends-only-messages',
                title: 'فقط الأصدقاء يمكنهم مراسلتي',
                subtitle:
                    'VIP1+ — يمنع الرسائل الجديدة من غير الأصدقاء مع استثناء النظام والإدارة.',
                value: vip.friendsOnlyMessages,
                unlocked: vip.canUseFriendsOnlyMessages,
                requiredVip: 1,
                onChanged: _saveFriendsOnlyMessages,
              ),
            ],
          ),
          const SizedBox(height: 14),
          _section(
            title: 'الألعاب والإعلانات',
            children: [
              _toggle(
                keyName: 'vip-privacy-hide-game-win-banner',
                title: 'إخفاء شريط الفوز في الألعاب',
                subtitle:
                    'VIP4+ — يخفي إعلان الفوز العام فقط ولا يغير النتيجة أو الجائزة.',
                value: vip.hideGameWinBanner,
                unlocked: vip.canHideGameWinBanner,
                requiredVip: 4,
                onChanged: (v) => _saveVip4Privacy('hideGameWinBanner', v),
              ),
              _toggle(
                keyName: 'vip-privacy-hide-bet-win-notification',
                title: 'إخفاء إشعار الفوز بالرهان',
                subtitle:
                    'VIP4+ — يخفي إشعار الفوز العام فقط ولا يغير الربح أو الـLedger.',
                value: vip.hideBetWinNotification,
                unlocked: vip.canHideBetWinNotification,
                requiredVip: 4,
                onChanged: (v) =>
                    _saveVip4Privacy('hideBetWinNotification', v),
              ),
            ],
          ),
          const SizedBox(height: 14),
          _section(
            title: 'الغرف والظهور',
            children: [
              _toggle(
                keyName: 'vip-privacy-hide-presence',
                title: 'إخفاء حالة الاتصال',
                subtitle: 'VIP5+ — يخفي وجودك العام في الغرف.',
                value: ghost.ghostMode,
                unlocked: ghost.canUseGhostMode,
                requiredVip: ghost.requiredVipLevel,
                onChanged: _saveGhost,
              ),
              _toggle(
                keyName: 'vip-privacy-hidden-entry',
                title: 'الدخول المخفي',
                subtitle:
                    'VIP7+ — لا يظهر إشعار دخولك. هذا هو مكان التحكم الوحيد.',
                value: hiddenEntry.hiddenRoomEntry,
                unlocked: hiddenEntry.canUseHiddenRoomEntry,
                requiredVip: hiddenEntry.requiredVipLevel,
                onChanged: _saveHiddenEntry,
              ),
              _toggle(
                keyName: 'vip-privacy-hide-ranking-lists',
                title: 'ترتيب المساهمة غير مرئي',
                subtitle: 'VIP7+ — يخفيك من القوائم العامة فقط.',
                value: vip.hideRankingLists,
                unlocked: vip.canHideRankingLists,
                requiredVip: 7,
                onChanged: _saveHideLists,
              ),
              _toggle(
                keyName: 'vip-privacy-hide-profile-visits',
                title: 'زيارة الملفات بشكل مخفي',
                subtitle:
                    'VIP9+ — لا تظهر زيارتك لصاحب الملف ولا تدخل عداد الزيارات المرئي.',
                value: vip.hideProfileVisits,
                unlocked: vip.canHideProfileVisits,
                requiredVip: 9,
                onChanged: _saveHideProfileVisits,
              ),
              ListTile(
                key: const Key('vip-profile-visit-history'),
                leading: const Icon(
                  Icons.history_rounded,
                  color: Color(0xFF8B5CF6),
                ),
                title: const Text(
                  'سجل الزيارات',
                  style: TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                subtitle: const Text(
                  'VIP1+ — من زار ملفي والملفات التي زرتها.',
                  style: TextStyle(color: Colors.white54, fontSize: 12),
                ),
                trailing: const Icon(
                  Icons.chevron_left_rounded,
                  color: Colors.white38,
                ),
                onTap: vip.effectiveVipLevel >= 1
                    ? _openVisitHistory
                    : () => _openVip(1),
              ),
            ],
          ),
          if (_saving) ...[
            const SizedBox(height: 14),
            const LinearProgressIndicator(minHeight: 2),
          ],
        ],
      ),
    );
  }

  Widget _intro(int level) => Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: const Color(0xFF101827),
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: const Color(0x338B5CF6)),
        ),
        child: Row(
          children: [
            const Icon(
              Icons.visibility_off_rounded,
              color: Color(0xFFFFD166),
              size: 34,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'إعداد التخفي',
                    style: TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w900,
                      fontSize: 18,
                    ),
                  ),
                  const SizedBox(height: 4),
                  const Text(
                    'كل ميزة تعمل حسب نظامها وأهليتها؛ الشخص الغامض مستقل عن VIP والنبلاء.',
                    style: TextStyle(color: Colors.white60),
                  ),
                ],
              ),
            ),
          ],
        ),
      );

  Widget _section({
    required String title,
    required List<Widget> children,
  }) =>
      Container(
        decoration: BoxDecoration(
          color: const Color(0xCC0B1322),
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: const Color(0x334D67FF)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 14, 16, 8),
              child: Text(
                title,
                style: const TextStyle(
                  color: Color(0xFFFFD166),
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
            ...children,
          ],
        ),
      );

  Widget _toggle({
    required String keyName,
    required String title,
    required String subtitle,
    required bool value,
    required bool unlocked,
    required int requiredVip,
    required ValueChanged<bool> onChanged,
  }) {
    return ListTile(
      key: Key(keyName),
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 4),
      leading: Icon(
        unlocked ? Icons.lock_open_rounded : Icons.lock_outline_rounded,
        color: unlocked ? const Color(0xFF8B5CF6) : Colors.white38,
      ),
      title: Text(
        title,
        style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700),
      ),
      subtitle: Text(
        subtitle,
        style: const TextStyle(color: Colors.white54, fontSize: 12),
      ),
      trailing: Switch(
        value: unlocked && value,
        onChanged: unlocked && !_saving ? onChanged : null,
      ),
      onTap: _saving
          ? null
          : unlocked
              ? () => onChanged(!value)
              : () => _openVip(requiredVip),
    );
  }
}
