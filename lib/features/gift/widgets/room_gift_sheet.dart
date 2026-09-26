import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../../../core/assets/shadow_asset_registry.dart';
import '../../room/services/room_presence_service.dart';
import '../services/gift_catalog_service.dart';
import '../services/room_gift_service.dart';

Future<void> showRoomGiftSheet(
  BuildContext context, {
  required String roomId,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: const Color(0xFF0C101A),
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(26)),
    ),
    builder: (_) => _RoomGiftSheet(roomId: roomId),
  );
}

class _RoomGiftSheet extends StatefulWidget {
  const _RoomGiftSheet({required this.roomId});

  final String roomId;

  @override
  State<_RoomGiftSheet> createState() => _RoomGiftSheetState();
}

class _RoomGiftSheetState extends State<_RoomGiftSheet> {
  final RoomPresenceService _presence = RoomPresenceService();
  final RoomGiftService _gifts = RoomGiftService();

  List<RoomPresenceUser> _participants = const [];
  List<GiftCatalogItem> _catalog = const [];
  String? _receiverId;
  int _quantity = 1;
  bool _loading = true;
  String? _sendingGiftId;
  String? _error;

  String get _uid => FirebaseAuth.instance.currentUser?.uid ?? '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _presence.close();
    _gifts.close();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final participants = await _presence.load(widget.roomId);
      final catalog = await GiftCatalogService.loadCatalog();
      final others =
          participants.where((user) => user.uid != _uid).toList(growable: false);
      if (!mounted) return;
      setState(() {
        _participants = others;
        _catalog = catalog;
        _receiverId = others.isEmpty ? null : others.first.uid;
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = 'تعذر تحميل بيانات الهدايا أو الموجودين في الروم.';
      });
    }
  }

  Future<void> _send(GiftCatalogItem gift) async {
    final receiverId = _receiverId;
    if (receiverId == null || _sendingGiftId != null) return;
    setState(() => _sendingGiftId = gift.id);
    try {
      final result = await _gifts.send(
        roomId: widget.roomId,
        receiverId: receiverId,
        giftId: gift.id,
        quantity: _quantity,
      );
      if (!mounted) return;
      final receiverName = (result['receiverName'] ?? 'المستخدم').toString();
      final totalCost = (result['totalCost'] as num?)?.toInt() ?? 0;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'تم إرسال ' +
                gift.nameAr +
                ' ×' +
                _quantity.toString() +
                ' إلى ' +
                receiverName +
                ' — ' +
                totalCost.toString() +
                ' كوينز',
          ),
        ),
      );
      Navigator.pop(context);
    } on StateError catch (error) {
      if (!mounted) return;
      final code = error.message.toString();
      final message = switch (code) {
        'insufficient_balance' => 'رصيد العملات غير كافٍ.',
        'receiver_not_in_room' => 'المستخدم غادر الروم.',
        'sender_not_in_room' => 'تعذر تأكيد وجودك داخل الروم.',
        'gift_inactive' => 'هذه الهدية متوقفة حالياً.',
        'emergency_locked' => 'عمليات الهدايا متوقفة مؤقتاً.',
        _ => 'تعذر إرسال الهدية حالياً.',
      };
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(message)));
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('تعذر إرسال الهدية حالياً.')),
        );
      }
    } finally {
      if (mounted) setState(() => _sendingGiftId = null);
    }
  }

  Widget _avatar(RoomPresenceUser user, {double radius = 24}) {
    return CircleAvatar(
      radius: radius,
      backgroundColor: const Color(0xFF25183F),
      backgroundImage:
          user.profileImageUrl.isEmpty ? null : NetworkImage(user.profileImageUrl),
      child: user.profileImageUrl.isEmpty
          ? const Icon(Icons.person_rounded, color: Colors.white70)
          : null,
    );
  }

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

  Widget _giftImage(GiftCatalogItem gift) {
    final fallback = Text(
      _giftEmoji(gift.id),
      style: const TextStyle(fontSize: 42),
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

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: SafeArea(
        child: SizedBox(
          height: MediaQuery.sizeOf(context).height * .78,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(14, 12, 14, 18),
            child: _loading
                ? const Center(
                    child: CircularProgressIndicator(
                      color: Color(0xFF8A3DFF),
                    ),
                  )
                : _error != null
                    ? Center(
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(
                              _error!,
                              textAlign: TextAlign.center,
                              style: const TextStyle(color: Colors.white60),
                            ),
                            const SizedBox(height: 12),
                            OutlinedButton(
                              onPressed: _load,
                              child: const Text('إعادة المحاولة'),
                            ),
                          ],
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
                          const SizedBox(height: 12),
                          const Row(
                            children: [
                              Icon(
                                Icons.card_giftcard_rounded,
                                color: Color(0xFFFFD54A),
                              ),
                              SizedBox(width: 8),
                              Text(
                                'إرسال هدية داخل الروم',
                                style: TextStyle(
                                  color: Colors.white,
                                  fontSize: 20,
                                  fontWeight: FontWeight.w900,
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 12),
                          if (_participants.isEmpty)
                            const Expanded(
                              child: Center(
                                child: Text(
                                  'لا يوجد مستخدم آخر داخل الروم حالياً.',
                                  style: TextStyle(color: Colors.white54),
                                ),
                              ),
                            )
                          else ...[
                            SizedBox(
                              height: 78,
                              child: ListView.separated(
                                scrollDirection: Axis.horizontal,
                                itemCount: _participants.length,
                                separatorBuilder: (_, __) =>
                                    const SizedBox(width: 8),
                                itemBuilder: (_, index) {
                                  final user = _participants[index];
                                  final selected = _receiverId == user.uid;
                                  return InkWell(
                                    onTap: () =>
                                        setState(() => _receiverId = user.uid),
                                    borderRadius: BorderRadius.circular(16),
                                    child: Container(
                                      width: 76,
                                      padding: const EdgeInsets.all(6),
                                      decoration: BoxDecoration(
                                        color: selected
                                            ? const Color(0xFF6D27D9)
                                                .withValues(alpha: .25)
                                            : const Color(0xFF131824),
                                        borderRadius: BorderRadius.circular(16),
                                        border: Border.all(
                                          color: selected
                                              ? const Color(0xFFFFD54A)
                                              : Colors.white10,
                                        ),
                                      ),
                                      child: Column(
                                        children: [
                                          _avatar(user, radius: 21),
                                          const SizedBox(height: 4),
                                          Text(
                                            user.displayName,
                                            maxLines: 1,
                                            overflow: TextOverflow.ellipsis,
                                            style: const TextStyle(
                                              color: Colors.white,
                                              fontSize: 9,
                                              fontWeight: FontWeight.w700,
                                            ),
                                          ),
                                        ],
                                      ),
                                    ),
                                  );
                                },
                              ),
                            ),
                            const SizedBox(height: 10),
                            Row(
                              children: [
                                const Text(
                                  'الكمية',
                                  style: TextStyle(
                                    color: Colors.white70,
                                    fontWeight: FontWeight.w800,
                                  ),
                                ),
                                const SizedBox(width: 10),
                                Expanded(
                                  child: Wrap(
                                    spacing: 7,
                                    children: [1, 7, 77, 777]
                                        .map(
                                          (value) => ChoiceChip(
                                            label: Text(
                                              '×' + value.toString(),
                                            ),
                                            selected: _quantity == value,
                                            onSelected: (_) =>
                                                setState(() => _quantity = value),
                                            selectedColor:
                                                const Color(0xFF7B2DFF),
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
                              ],
                            ),
                            const SizedBox(height: 10),
                            Expanded(
                              child: GridView.builder(
                                itemCount: _catalog.length,
                                gridDelegate:
                                    const SliverGridDelegateWithFixedCrossAxisCount(
                                  crossAxisCount: 3,
                                  crossAxisSpacing: 9,
                                  mainAxisSpacing: 9,
                                  childAspectRatio: .78,
                                ),
                                itemBuilder: (_, index) {
                                  final gift = _catalog[index];
                                  final busy = _sendingGiftId == gift.id;
                                  final total = gift.priceCoins * _quantity;
                                  return InkWell(
                                    onTap: busy ? null : () => _send(gift),
                                    borderRadius: BorderRadius.circular(16),
                                    child: Container(
                                      padding: const EdgeInsets.all(8),
                                      decoration: BoxDecoration(
                                        color: const Color(0xFF121725),
                                        borderRadius: BorderRadius.circular(16),
                                        border: Border.all(color: Colors.white10),
                                      ),
                                      child: Column(
                                        children: [
                                          Expanded(
                                            child: busy
                                                ? const Center(
                                                    child:
                                                        CircularProgressIndicator(
                                                      strokeWidth: 2,
                                                      color: Color(0xFFFFD54A),
                                                    ),
                                                  )
                                                : _giftImage(gift),
                                          ),
                                          Text(
                                            gift.nameAr,
                                            maxLines: 1,
                                            overflow: TextOverflow.ellipsis,
                                            style: const TextStyle(
                                              color: Colors.white,
                                              fontSize: 11,
                                              fontWeight: FontWeight.w800,
                                            ),
                                          ),
                                          const SizedBox(height: 3),
                                          Text(
                                            '🪙 ' + total.toString(),
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
                                },
                              ),
                            ),
                          ],
                        ],
                      ),
          ),
        ),
      ),
    );
  }
}
