import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../core/assets/shadow_asset_registry.dart';
import '../../../utils/compact_number.dart';
import '../../profile/screens/user_level_screen.dart';
import '../../profile/services/user_level_service.dart';
import '../../wallet/screens/recharge_screen.dart';
import '../services/gift_catalog_service.dart';

class GiftPickerSendResult {
  const GiftPickerSendResult({
    required this.balanceCoins,
    this.wealthDeltaCoins = 0,
    this.bagQuantityRemaining,
    this.message = '',
  });

  final int? balanceCoins;
  final int wealthDeltaCoins;
  final int? bagQuantityRemaining;
  final String message;
}

typedef GiftPickerSender = Future<GiftPickerSendResult> Function(
  GiftCatalogItem gift,
  int quantity,
  bool useGiftBag,
);

class UnifiedGiftPickerSheet extends StatefulWidget {
  const UnifiedGiftPickerSheet({
    super.key,
    required this.title,
    required this.recipientArea,
    required this.canSend,
    required this.onSend,
  });

  final String title;
  final Widget recipientArea;
  final bool canSend;
  final GiftPickerSender onSend;

  @override
  State<UnifiedGiftPickerSheet> createState() => _UnifiedGiftPickerSheetState();
}

class _UnifiedGiftPickerSheetState extends State<UnifiedGiftPickerSheet> {
  List<GiftCatalogItem> _catalog = const [];
  GiftCatalogItem? _selected;
  String _category = 'general';
  int _quantity = 1;
  final TextEditingController _customQuantityController =
      TextEditingController();
  final FocusNode _customQuantityFocus = FocusNode();
  bool _customQuantityOpen = false;
  int? _balanceCoins;
  Map<String, int> _bagQuantities = const <String, int>{};
  UserLevelService? _levelService;
  UserLevelSectionSummary? _wealth;
  bool _wealthLoading = false;
  bool _loading = true;
  bool _sending = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _balanceCoins = GiftCatalogService.cachedBalanceCoins;
    _levelService = UserLevelService();
    _load();
    unawaited(_loadWealth());
  }

  @override
  void dispose() {
    _customQuantityController.dispose();
    _customQuantityFocus.dispose();
    _levelService?.close();
    super.dispose();
  }

  Future<void> _loadWealth() async {
    if (_wealthLoading) return;
    _wealthLoading = true;
    try {
      final summary = await _levelService!.loadSelf();
      if (!mounted) return;
      setState(() => _wealth = summary.wealth);
    } catch (_) {
      // Gift sending stays available even if the level summary cannot load.
    } finally {
      if (mounted) {
        setState(() => _wealthLoading = false);
      } else {
        _wealthLoading = false;
      }
    }
  }

  void _applyWealthDelta(int delta) {
    if (delta <= 0) return;
    final current = _wealth;
    if (current == null) {
      unawaited(_loadWealth());
      return;
    }
    final nextPoints = current.points + delta;
    final nextThreshold = current.nextThreshold;
    if (nextThreshold == null) {
      setState(() {
        _wealth = UserLevelSectionSummary(
          level: current.level,
          maxLevel: current.maxLevel,
          points: nextPoints,
          minimumThreshold: current.minimumThreshold,
          nextThreshold: null,
          remaining: 0,
          progressBps: 10000,
          hidden: current.hidden,
          publiclyHidden: current.publiclyHidden,
        );
      });
      return;
    }
    if (nextPoints >= nextThreshold) {
      setState(() {
        _wealth = UserLevelSectionSummary(
          level: current.level,
          maxLevel: current.maxLevel,
          points: nextPoints,
          minimumThreshold: current.minimumThreshold,
          nextThreshold: nextThreshold,
          remaining: 0,
          progressBps: 10000,
          hidden: current.hidden,
          publiclyHidden: current.publiclyHidden,
        );
      });
      // Crossing a level is rare; refresh once to get the next official threshold.
      unawaited(_loadWealth());
      return;
    }
    final span = (nextThreshold - current.minimumThreshold).clamp(1, 1 << 62).toInt();
    final gained =
        (nextPoints - current.minimumThreshold).clamp(0, span).toInt();
    final progressBps = ((gained * 10000) ~/ span).clamp(0, 10000).toInt();
    setState(() {
      _wealth = UserLevelSectionSummary(
        level: current.level,
        maxLevel: current.maxLevel,
        points: nextPoints,
        minimumThreshold: current.minimumThreshold,
        nextThreshold: nextThreshold,
        remaining: nextThreshold - nextPoints,
        progressBps: progressBps,
        hidden: current.hidden,
        publiclyHidden: current.publiclyHidden,
      );
    });
  }

  Future<void> _openWealthPrivileges() async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => const UserLevelScreen(initialTabIndex: 0),
      ),
    );
    if (mounted) unawaited(_loadWealth());
  }

  Future<void> _load() async {
    try {
      final catalog = await GiftCatalogService.loadCatalog();
      if (!mounted) return;
      final categories =
          catalog.map(_uiCategoryForGift).toSet();
      final initialCategory = categories.contains('general')
          ? 'general'
          : (categories.isEmpty ? 'general' : categories.first);
      setState(() {
        _catalog = catalog;
        _category = initialCategory;
        _balanceCoins = GiftCatalogService.cachedBalanceCoins;
        _bagQuantities = GiftCatalogService.cachedBagQuantities;
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = 'تعذر تحميل الهدايا حالياً.';
      });
    }
  }

  String _uiCategoryForGift(GiftCatalogItem gift) =>
      gift.isRelationshipGift ? 'relationship' : gift.category;

  List<String> get _categories {
    final values = <String>['bag'];
    for (final gift in _catalog) {
      final value = _uiCategoryForGift(gift);
      if (!values.contains(value)) values.add(value);
    }
    return values;
  }

  List<GiftCatalogItem> get _visible {
    if (_category == 'bag') {
      return _catalog
          .where((gift) => (_bagQuantities[gift.id] ?? 0) > 0)
          .toList(growable: false);
    }
    return _catalog
        .where((gift) => _uiCategoryForGift(gift) == _category)
        .toList(growable: false);
  }

  String _categoryLabel(String value) => switch (value) {
        'bag' => '',
        'relationship' => 'علاقة',
        _ => GiftCatalogService.categoryLabel(value),
      };

  IconData? _categoryIcon(String value) => switch (value) {
        'bag' => Icons.shopping_bag_rounded,
        'general' => Icons.card_giftcard_rounded,
        'lucky' => Icons.auto_awesome_rounded,
        'vip' => Icons.workspace_premium_rounded,
        'relationship' => Icons.favorite_rounded,
        'activities' => Icons.celebration_rounded,
        'countries' => Icons.public_rounded,
        'celebrities' => Icons.star_rounded,
        _ => null,
      };

  String _giftEmoji(String id) => switch (id) {
        'rose' => '🌹',
        'coffee' => '☕',
        'heart' => '❤️',
        'chocolate' => '🍫',
        'crown' => '👑',
        'ring' => '💍',
        'sports_car' => '🏎️',
        'yacht' => '🛥️',
        'private_jet' => '✈️',
        'castle' => '🏰',
        'golden_dragon' => '🐉',
        'galaxy' => '🌌',
        _ => '🎁',
      };

  Widget _giftImage(GiftCatalogItem gift, {double fallbackSize = 40}) {
    final fallback = Text(
      _giftEmoji(gift.id),
      style: TextStyle(fontSize: fallbackSize),
      textAlign: TextAlign.center,
    );
    return FutureBuilder<Uri?>(
      future: ShadowAssetRegistry.remoteUrl(gift.assetKey),
      builder: (_, snapshot) {
        final url = snapshot.data;
        if (url == null) return fallback;
        return Image.network(
          url.toString(),
          fit: BoxFit.contain,
          errorBuilder: (_, __, ___) => fallback,
        );
      },
    );
  }

  Future<void> _send() async {
    final gift = _selected;
    if (gift == null || !widget.canSend || _sending) return;
    setState(() => _sending = true);
    try {
      final useGiftBag = _category == 'bag';
      final result = await widget.onSend(gift, _quantity, useGiftBag);
      if (!mounted) return;
      if (result.balanceCoins != null) {
        GiftCatalogService.updateCachedBalance(result.balanceCoins!);
        _balanceCoins = result.balanceCoins;
      }
      _applyWealthDelta(result.wealthDeltaCoins);
      if (useGiftBag) {
        final remaining = result.bagQuantityRemaining ??
            ((_bagQuantities[gift.id] ?? 0) - _quantity).clamp(0, 1 << 31).toInt();
        GiftCatalogService.updateCachedBagQuantity(gift.id, remaining);
        _bagQuantities = GiftCatalogService.cachedBagQuantities;
        if (remaining <= 0) {
          _selected = null;
        }
      }
      final message = result.message.trim();
      if (message.isNotEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(message)),
        );
      }
    } on StateError catch (error) {
      if (!mounted) return;
      final message = switch (error.message.toString()) {
        'insufficient_balance' => 'رصيد العملات غير كافٍ.',
        'receiver_not_in_room' => 'أحد المستلمين غادر الغرفة.',
        'recipient_not_in_room' => 'أحد المستلمين غادر الغرفة.',
        'sender_not_in_room' => 'تعذر تأكيد وجودك داخل الغرفة.',
        'room_gift_recipient_limit' => 'عدد المستلمين أكبر من الحد الآمن للإرسال الجماعي.',
        'room_gift_write_limit' => 'تعذر إتمام الإرسال الجماعي بهذه المجموعة دفعة واحدة.',
        'recipient_required' => 'اختر مستلماً واحداً على الأقل.',
        'room_presence_unavailable' => 'تعذر تأكيد الموجودين في الغرفة حالياً.',
        'relationship_gift_not_eligible' => 'هذه الهدية مخصصة لعلاقة مؤهلة.',
        'invalid_affinity_base_points' => 'إعداد نقاط هذه الهدية يحتاج مراجعة من الإدارة.',
        'gift_inactive' => 'هذه الهدية متوقفة حالياً.',
        'vip_gift_requires_level' => 'هذه الهدية تتطلب مستوى VIP أعلى.',
        'emergency_locked' => 'عمليات الهدايا متوقفة مؤقتاً.',
        'blocked' => 'لا يمكن إرسال الهدية بسبب إعدادات الحظر.',
        _ => 'تعذر إرسال الهدية حالياً.',
      };
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(message)),
      );
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('تعذر إرسال الهدية حالياً.')),
        );
      }
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Widget _wealthStrip() {
    final wealth = _wealth;
    final progress = wealth == null
        ? 0.0
        : (wealth.progressBps.clamp(0, 10000) / 10000.0);
    final nextThreshold = wealth?.nextThreshold;
    final progressText = wealth == null
        ? (_wealthLoading ? 'تحميل...' : '—')
        : nextThreshold == null
            ? 'MAX'
            : formatCompactAmount(
                  wealth.points - wealth.minimumThreshold,
                ) +
                ' / ' +
                formatCompactAmount(
                  nextThreshold - wealth.minimumThreshold,
                );

    return SizedBox(
      height: 42,
      child: Row(
        textDirection: TextDirection.ltr,
        children: [
          SizedBox(
            height: 36,
            child: OutlinedButton.icon(
              onPressed: _openWealthPrivileges,
              style: OutlinedButton.styleFrom(
                foregroundColor: const Color(0xFFFFD98A),
                side: const BorderSide(color: Color(0x665C4820)),
                backgroundColor: const Color(0x332E2411),
                padding: const EdgeInsets.symmetric(horizontal: 10),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
              ),
              icon: const Icon(Icons.workspace_premium_rounded, size: 16),
              label: const Text(
                'امتيازاتي',
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Directionality(
              textDirection: TextDirection.rtl,
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Row(
                    children: [
                      Text(
                        wealth == null
                            ? 'الثروة'
                            : 'الثروة LV' + wealth.level.toString(),
                        style: const TextStyle(
                          color: Colors.white60,
                          fontSize: 9.5,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const Spacer(),
                      Text(
                        progressText,
                        style: const TextStyle(
                          color: Color(0xFFFFD98A),
                          fontSize: 9.5,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(99),
                    child: LinearProgressIndicator(
                      value: progress,
                      minHeight: 6,
                      backgroundColor: const Color(0xFF292D37),
                      valueColor: const AlwaysStoppedAnimation<Color>(
                        Color(0xFFD7B56D),
                      ),
                    ),
                  ),
                  const SizedBox(height: 3),
                  const Align(
                    alignment: AlignmentDirectional.centerEnd,
                    child: Text(
                      '1 كوين = 1 نقطة ثروة',
                      style: TextStyle(
                        color: Colors.white30,
                        fontSize: 8.5,
                        fontWeight: FontWeight.w700,
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

  Widget _categoryBar() {
    final categories = _categories;
    return SizedBox(
      height: 34,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: categories.length,
        separatorBuilder: (_, __) => const SizedBox(width: 3),
        itemBuilder: (_, index) {
          final value = categories[index];
          final selected = value == _category;
          final icon = _categoryIcon(value);
          return InkWell(
            onTap: _sending
                ? null
                : () => setState(() {
                      _category = value;
                      _customQuantityOpen = false;
                      if (_selected != null &&
                          !_visible.any((gift) => gift.id == _selected!.id)) {
                        _selected = null;
                      }
                    }),
            borderRadius: BorderRadius.circular(10),
            child: Container(
              constraints: BoxConstraints(
                minWidth: value == 'bag' ? 38 : 55,
              ),
              padding: const EdgeInsets.symmetric(horizontal: 7),
              decoration: BoxDecoration(
                color: selected
                    ? const Color(0x332A1A47)
                    : Colors.transparent,
                borderRadius: BorderRadius.circular(10),
                border: Border(
                  bottom: BorderSide(
                    color: selected
                        ? const Color(0xFFFFD54A)
                        : Colors.transparent,
                    width: 2,
                  ),
                ),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  if (icon != null)
                    Icon(
                      icon,
                      size: value == 'bag' ? 20 : 14,
                      color: selected
                          ? const Color(0xFFFFD54A)
                          : Colors.white54,
                    ),
                  if (_categoryLabel(value).isNotEmpty) ...[
                    if (icon != null) const SizedBox(width: 3),
                    Text(
                      _categoryLabel(value),
                      style: TextStyle(
                        color: selected
                            ? const Color(0xFFFFD54A)
                            : Colors.white54,
                        fontSize: 10,
                        fontWeight: selected
                            ? FontWeight.w900
                            : FontWeight.w700,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _giftCard(GiftCatalogItem gift) {
    final selected = _selected?.id == gift.id;
    final bagCount = _bagQuantities[gift.id] ?? 0;
    return InkWell(
      onTap: _sending ? null : () => setState(() => _selected = gift),
      borderRadius: BorderRadius.circular(13),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 140),
        padding: const EdgeInsets.fromLTRB(5, 5, 5, 6),
        decoration: BoxDecoration(
          color: selected
              ? const Color(0xFF25143D)
              : const Color(0xFF111620),
          borderRadius: BorderRadius.circular(13),
          border: Border.all(
            color: selected
                ? const Color(0xFFB736FF)
                : const Color(0x16FFFFFF),
            width: selected ? 1.4 : .8,
          ),
          boxShadow: selected
              ? const [
                  BoxShadow(
                    color: Color(0x443000FF),
                    blurRadius: 10,
                    spreadRadius: 1,
                  ),
                ]
              : const [],
        ),
        child: Column(
          children: [
            Expanded(
              child: Stack(
                children: [
                  Positioned.fill(
                    child: Center(
                      child: _giftImage(gift, fallbackSize: 30),
                    ),
                  ),
                  if (gift.isAnimated)
                    const Positioned(
                      top: 0,
                      left: 0,
                      child: CircleAvatar(
                        radius: 8,
                        backgroundColor: Color(0xFF09B968),
                        child: Icon(
                          Icons.play_arrow_rounded,
                          color: Colors.white,
                          size: 11,
                        ),
                      ),
                    ),
                  if (gift.isRelationshipGift)
                    Positioned(
                      top: 0,
                      right: 0,
                      child: Text(
                        gift.category == 'cp' ? 'CP' : 'صديق',
                        style: const TextStyle(
                          color: Color(0xFFFF77AE),
                          fontSize: 7.5,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 2),
            Text(
              gift.nameAr,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: Colors.white70,
                fontSize: 9.2,
                height: 1.05,
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 2),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(
                  _category == 'bag'
                      ? Icons.shopping_bag_rounded
                      : Icons.monetization_on_rounded,
                  size: 11,
                  color: const Color(0xFFFFD54A),
                ),
                const SizedBox(width: 2),
                Text(
                  _category == 'bag'
                      ? '×' + formatCompactAmount(bagCount)
                      : formatCompactAmount(gift.priceCoins),
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 9.5,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _openRecharge() async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => const RechargeScreen(initialTab: 0),
      ),
    );
    if (mounted) {
      _balanceCoins = GiftCatalogService.cachedBalanceCoins;
      setState(() {});
    }
  }

  void _openCustomQuantity() {
    _customQuantityController.text = _quantity.toString();
    setState(() => _customQuantityOpen = true);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _customQuantityFocus.requestFocus();
    });
  }

  void _confirmCustomQuantity() {
    final value = int.tryParse(_customQuantityController.text.trim()) ?? 0;
    if (value < 1 || value > 9999) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('أدخل عدداً من 1 إلى 9999.')),
      );
      return;
    }
    setState(() {
      _quantity = value;
      _customQuantityOpen = false;
    });
    _customQuantityFocus.unfocus();
  }

  Widget _quantityButton(String label, {int? value}) {
    final selected = value != null && _quantity == value && !_customQuantityOpen;
    return InkWell(
      onTap: _sending
          ? null
          : value == null
              ? _openCustomQuantity
              : () => setState(() {
                    _quantity = value;
                    _customQuantityOpen = false;
                  }),
      borderRadius: BorderRadius.circular(12),
      child: Container(
        height: 36,
        constraints: const BoxConstraints(minWidth: 30),
        padding: const EdgeInsets.symmetric(horizontal: 4),
        decoration: BoxDecoration(
          color: selected
              ? const Color(0xFF6C27D9)
              : const Color(0xFF171C27),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: selected
                ? const Color(0xFFFFD54A)
                : Colors.white12,
          ),
        ),
        alignment: Alignment.center,
        child: Text(
          label,
          style: TextStyle(
            color: selected ? Colors.white : Colors.white70,
            fontSize: 10,
            fontWeight: FontWeight.w900,
          ),
        ),
      ),
    );
  }

  Widget _balancePill() {
    return Container(
      height: 36,
      padding: const EdgeInsetsDirectional.only(start: 4, end: 2),
      decoration: BoxDecoration(
        color: const Color(0xFF151A24),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: Colors.white10),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(
            Icons.monetization_on_rounded,
            color: Color(0xFFFFC84A),
            size: 14,
          ),
          const SizedBox(width: 2),
          Text(
            _balanceCoins == null
                ? '—'
                : formatCompactAmount(_balanceCoins),
            style: const TextStyle(
              color: Colors.white,
              fontSize: 9,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(width: 2),
          InkWell(
            onTap: _openRecharge,
            borderRadius: BorderRadius.circular(99),
            child: const Padding(
              padding: EdgeInsets.all(2),
              child: Icon(
                Icons.add_circle_rounded,
                color: Colors.white54,
                size: 14,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _bottomBar() {
    final gift = _selected;
    final bagCount = gift == null ? 0 : (_bagQuantities[gift.id] ?? 0);
    final bagAllowed = _category != 'bag' || bagCount >= _quantity;
    final sendEnabled =
        gift != null && widget.canSend && !_sending && bagAllowed;

    return Container(
      padding: const EdgeInsets.only(top: 6),
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: Colors.white10)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (_customQuantityOpen) ...[
            Row(
              children: [
                SizedBox(
                  width: 42,
                  height: 38,
                  child: FilledButton(
                    onPressed: _confirmCustomQuantity,
                    style: FilledButton.styleFrom(
                      padding: EdgeInsets.zero,
                      backgroundColor: const Color(0xFF6D27D9),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(11),
                      ),
                    ),
                    child: const Icon(Icons.check_rounded, size: 20),
                  ),
                ),
                const SizedBox(width: 7),
                Expanded(
                  child: SizedBox(
                    height: 38,
                    child: TextField(
                      controller: _customQuantityController,
                      focusNode: _customQuantityFocus,
                      keyboardType: TextInputType.number,
                      textInputAction: TextInputAction.done,
                      onSubmitted: (_) => _confirmCustomQuantity(),
                      inputFormatters: [
                        FilteringTextInputFormatter.digitsOnly,
                        LengthLimitingTextInputFormatter(4),
                      ],
                      style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.w900,
                      ),
                      decoration: InputDecoration(
                        counterText: '',
                        hintText: 'أدخل عدد الهدايا من 1 إلى 9999',
                        hintStyle: const TextStyle(
                          color: Colors.white38,
                          fontSize: 11,
                        ),
                        filled: true,
                        fillColor: const Color(0xFF242738),
                        contentPadding: const EdgeInsets.symmetric(
                          horizontal: 12,
                          vertical: 8,
                        ),
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(11),
                          borderSide: BorderSide.none,
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 6),
          ],
          Row(
            textDirection: TextDirection.ltr,
            children: [
              SizedBox(
                width: 72,
                height: 38,
                child: FilledButton.icon(
                  onPressed: sendEnabled ? _send : null,
                  style: FilledButton.styleFrom(
                    backgroundColor: const Color(0xFF8A26ED),
                    disabledBackgroundColor: const Color(0xFF292E39),
                    padding: const EdgeInsets.symmetric(horizontal: 4),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(13),
                    ),
                  ),
                  icon: _sending
                      ? const SizedBox(
                          width: 14,
                          height: 14,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : const Icon(Icons.send_rounded, size: 16),
                  label: const Text(
                    'إهداء',
                    style: TextStyle(
                      fontSize: 10.5,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 3),
              _quantityButton('آخر'),
              const SizedBox(width: 3),
              _quantityButton('777', value: 777),
              const SizedBox(width: 3),
              _quantityButton('77', value: 77),
              const SizedBox(width: 3),
              _quantityButton('7', value: 7),
              const SizedBox(width: 3),
              _quantityButton('1', value: 1),
              const Spacer(),
              _balancePill(),
            ],
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: SafeArea(
        child: SizedBox(
          height: MediaQuery.sizeOf(context).height * .55,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(14, 10, 14, 12),
            child: _loading
                ? const Center(
                    child: CircularProgressIndicator(color: Color(0xFF8A3DFF)),
                  )
                : _error != null
                    ? Center(
                        child: Text(
                          _error!,
                          textAlign: TextAlign.center,
                          style: const TextStyle(color: Colors.white60),
                        ),
                      )
                    : Column(
                        children: [
                          Container(
                            width: 44,
                            height: 4,
                            decoration: BoxDecoration(
                              color: Colors.white24,
                              borderRadius: BorderRadius.circular(99),
                            ),
                          ),
                          const SizedBox(height: 7),
                          widget.recipientArea,
                          const SizedBox(height: 5),
                          _wealthStrip(),
                          const SizedBox(height: 4),
                          _categoryBar(),
                          const SizedBox(height: 4),
                          Expanded(
                            child: _visible.isEmpty
                                ? const Center(
                                    child: Text(
                                      'لا توجد هدايا في هذا القسم حالياً',
                                      style: TextStyle(color: Colors.white54),
                                    ),
                                  )
                                : GridView.builder(
                                    itemCount: _visible.length,
                                    gridDelegate:
                                        const SliverGridDelegateWithFixedCrossAxisCount(
                                      crossAxisCount: 4,
                                      crossAxisSpacing: 5,
                                      mainAxisSpacing: 5,
                                      childAspectRatio: .78,
                                    ),
                                    itemBuilder: (_, index) =>
                                        _giftCard(_visible[index]),
                                  ),
                          ),
                          _bottomBar(),
                        ],
                      ),
          ),
        ),
      ),
    );
  }
}
