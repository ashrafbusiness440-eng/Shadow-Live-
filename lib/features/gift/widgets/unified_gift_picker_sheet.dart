import 'package:flutter/material.dart';

import '../../../core/assets/shadow_asset_registry.dart';
import '../services/gift_catalog_service.dart';

class GiftPickerSendResult {
  const GiftPickerSendResult({
    required this.balanceCoins,
    this.message = '',
  });

  final int? balanceCoins;
  final String message;
}

typedef GiftPickerSender = Future<GiftPickerSendResult> Function(
  GiftCatalogItem gift,
  int quantity,
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
  int? _balanceCoins;
  bool _loading = true;
  bool _sending = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _balanceCoins = GiftCatalogService.cachedBalanceCoins;
    _load();
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
    final values = <String>[];
    for (final gift in _catalog) {
      final value = _uiCategoryForGift(gift);
      if (!values.contains(value)) values.add(value);
    }
    return values;
  }

  List<GiftCatalogItem> get _visible => _catalog
      .where((gift) => _uiCategoryForGift(gift) == _category)
      .toList(growable: false);

  String _categoryLabel(String value) =>
      value == 'relationship'
          ? 'علاقة'
          : GiftCatalogService.categoryLabel(value);

  List<GiftCatalogItem> get _featured =>
      _catalog.where((gift) => gift.featured).take(8).toList();

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
      final result = await widget.onSend(gift, _quantity);
      if (!mounted) return;
      if (result.balanceCoins != null) {
        GiftCatalogService.updateCachedBalance(result.balanceCoins!);
        _balanceCoins = result.balanceCoins;
      }
      final message = result.message.trim();
      if (message.isNotEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(message)),
        );
      }
      Navigator.pop(context);
    } on StateError catch (error) {
      if (!mounted) return;
      final message = switch (error.message.toString()) {
        'insufficient_balance' => 'رصيد العملات غير كافٍ.',
        'receiver_not_in_room' => 'أحد المستلمين غادر الغرفة.',
        'recipient_not_in_room' => 'أحد المستلمين غادر الغرفة.',
        'sender_not_in_room' => 'تعذر تأكيد وجودك داخل الغرفة.',
        'room_gift_recipient_limit' => 'عدد المستلمين أكبر من الحد الآمن للإرسال الجماعي.',
        'relationship_gift_not_eligible' => 'هذه الهدية مخصصة لعلاقة مؤهلة.',
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

  Widget _featuredStrip() {
    final items = _featured;
    if (items.isEmpty) return const SizedBox.shrink();
    return SizedBox(
      height: 78,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: items.length,
        separatorBuilder: (_, __) => const SizedBox(width: 8),
        itemBuilder: (_, index) {
          final gift = items[index];
          return InkWell(
            onTap: () => setState(() {
              _selected = gift;
              _category = _uiCategoryForGift(gift);
            }),
            borderRadius: BorderRadius.circular(16),
            child: Container(
              width: 154,
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(16),
                gradient: const LinearGradient(
                  colors: [Color(0xFF2A1748), Color(0xFF15192A)],
                ),
                border: Border.all(color: const Color(0x55FFD54A)),
              ),
              child: Row(
                children: [
                  SizedBox(width: 50, height: 50, child: _giftImage(gift, fallbackSize: 30)),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          gift.nameAr,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        const SizedBox(height: 3),
                        Text(
                          '🪙 ${gift.priceCoins}',
                          style: const TextStyle(
                            color: Color(0xFFFFD54A),
                            fontSize: 11,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _categoryBar() {
    final categories = _categories;
    if (categories.length < 2) return const SizedBox.shrink();
    return SizedBox(
      height: 38,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: categories.length,
        separatorBuilder: (_, __) => const SizedBox(width: 7),
        itemBuilder: (_, index) {
          final value = categories[index];
          final selected = value == _category;
          return ChoiceChip(
            label: Text(_categoryLabel(value)),
            selected: selected,
            onSelected: (_) => setState(() {
              _category = value;
              if (_selected?.category != value) _selected = null;
            }),
            selectedColor: const Color(0xFF6D27D9),
            backgroundColor: const Color(0xFF151A28),
            side: BorderSide(
              color: selected ? const Color(0xFFFFD54A) : Colors.white10,
            ),
            labelStyle: TextStyle(
              color: selected ? Colors.white : Colors.white70,
              fontWeight: FontWeight.w800,
            ),
          );
        },
      ),
    );
  }

  Widget _giftCard(GiftCatalogItem gift) {
    final selected = _selected?.id == gift.id;
    final total = gift.priceCoins * _quantity;
    return InkWell(
      onTap: _sending ? null : () => setState(() => _selected = gift),
      borderRadius: BorderRadius.circular(16),
      child: Container(
        padding: const EdgeInsets.all(8),
        decoration: BoxDecoration(
          color: selected ? const Color(0xFF21183A) : const Color(0xFF121725),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: selected ? const Color(0xFFFFD54A) : Colors.white10,
            width: selected ? 1.5 : 1,
          ),
        ),
        child: Column(
          children: [
            Expanded(
              child: Stack(
                children: [
                  Positioned.fill(child: Center(child: _giftImage(gift))),
                  if (gift.isAnimated)
                    Positioned(
                      top: 0,
                      left: 0,
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 5,
                          vertical: 2,
                        ),
                        decoration: BoxDecoration(
                          color: const Color(0xCC6D27D9),
                          borderRadius: BorderRadius.circular(99),
                        ),
                        child: const Text(
                          'متحركة',
                          style: TextStyle(
                            color: Colors.white,
                            fontSize: 8,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ),
                    ),
                  if (gift.isRelationshipGift)
                    Positioned(
                      top: 0,
                      right: 0,
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 5,
                          vertical: 2,
                        ),
                        decoration: BoxDecoration(
                          color: gift.category == 'cp'
                              ? const Color(0xDDF15C9A)
                              : const Color(0xDD27AFCB),
                          borderRadius: BorderRadius.circular(99),
                        ),
                        child: Text(
                          gift.category == 'cp' ? 'CP' : 'صديق',
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 8,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 4),
            Text(
              gift.nameAr,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 10.5,
                height: 1.1,
                fontWeight: FontWeight.w800,
              ),
            ),
            if (gift.effectiveMinVipLevel > 0)
              Text(
                'VIP${gift.effectiveMinVipLevel}+',
                style: const TextStyle(
                  color: Color(0xFFFFD54A),
                  fontSize: 9,
                  fontWeight: FontWeight.w900,
                ),
              ),
            Text(
              '🪙 $total',
              style: const TextStyle(
                color: Color(0xFFFFD54A),
                fontSize: 10,
                fontWeight: FontWeight.w900,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _bottomBar() {
    final gift = _selected;
    final total = gift == null ? 0 : gift.priceCoins * _quantity;
    final balanceText = _balanceCoins == null
        ? 'الرصيد: —'
        : 'الرصيد: $_balanceCoins كوينز';
    return Container(
      padding: const EdgeInsets.only(top: 10),
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: Colors.white10)),
      ),
      child: Column(
        children: [
          Align(
            alignment: AlignmentDirectional.centerStart,
            child: Text(
              balanceText,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: Colors.white70,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
          const SizedBox(height: 6),
          Align(
            alignment: AlignmentDirectional.centerEnd,
            child: Wrap(
              spacing: 5,
              runSpacing: 5,
              children: [1, 7, 77, 777]
                  .map(
                    (value) => ChoiceChip(
                      label: Text('×$value'),
                      selected: _quantity == value,
                      onSelected: _sending
                          ? null
                          : (_) => setState(() => _quantity = value),
                      selectedColor: const Color(0xFF6D27D9),
                      visualDensity: VisualDensity.compact,
                      labelStyle: TextStyle(
                        color: _quantity == value
                            ? Colors.white
                            : Colors.white70,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  )
                  .toList(),
            ),
          ),
          const SizedBox(height: 8),
          SizedBox(
            width: double.infinity,
            height: 48,
            child: FilledButton.icon(
              onPressed: gift == null || !widget.canSend || _sending ? null : _send,
              style: FilledButton.styleFrom(
                backgroundColor: const Color(0xFF7B2DFF),
                disabledBackgroundColor: const Color(0xFF282D39),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(15),
                ),
              ),
              icon: _sending
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : const Icon(Icons.card_giftcard_rounded),
              label: Text(
                gift == null ? 'اختر هدية' : 'إهداء • 🪙 $total',
                style: const TextStyle(fontWeight: FontWeight.w900),
              ),
            ),
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
          height: MediaQuery.sizeOf(context).height * .82,
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
                          const SizedBox(height: 10),
                          Row(
                            children: [
                              const Icon(
                                Icons.card_giftcard_rounded,
                                color: Color(0xFFFFD54A),
                              ),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Text(
                                  widget.title,
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    color: Colors.white,
                                    fontSize: 18,
                                    fontWeight: FontWeight.w900,
                                  ),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 10),
                          widget.recipientArea,
                          const SizedBox(height: 10),
                          _featuredStrip(),
                          if (_featured.isNotEmpty) const SizedBox(height: 8),
                          _categoryBar(),
                          const SizedBox(height: 8),
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
                                      crossAxisCount: 3,
                                      crossAxisSpacing: 9,
                                      mainAxisSpacing: 9,
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
