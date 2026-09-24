import 'dart:convert';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import '../../../core/assets/shadow_asset_registry.dart';
import '../services/gift_catalog_service.dart';

Future<void> showDirectGiftSheet(
  BuildContext context, {
  required String receiverId,
  required String receiverName,
}) async {
  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: const Color(0xFF0C101A),
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(26)),
    ),
    builder: (_) => _DirectGiftSheet(
      receiverId: receiverId,
      receiverName: receiverName,
    ),
  );
}

class _DirectGiftSheet extends StatefulWidget {
  const _DirectGiftSheet({
    required this.receiverId,
    required this.receiverName,
  });

  final String receiverId;
  final String receiverName;

  @override
  State<_DirectGiftSheet> createState() => _DirectGiftSheetState();
}

class _DirectGiftSheetState extends State<_DirectGiftSheet> {
  static const _apiBase = String.fromEnvironment(
    'SHADOW_CLOUDFLARE_API_BASE_URL',
    defaultValue: 'https://shadow-live.ashraf-business-440.workers.dev/api',
  );

  List<GiftCatalogItem> _catalog = const [];
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

  Future<void> _load() async {
    try {
      final catalog = await GiftCatalogService.watchCatalog().first;
      if (!mounted) return;
      setState(() {
        _catalog = catalog;
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

  String _conversationId() {
    final ids = [_uid, widget.receiverId]..sort();
    return ids.join('_');
  }

  Future<void> _ensureConversation(String conversationId) async {
    final ref = FirebaseFirestore.instance
        .collection('conversations')
        .doc(conversationId);
    try {
      final snapshot = await ref.get();
      if (snapshot.exists) return;
    } on FirebaseException catch (error) {
      if (error.code != 'permission-denied') rethrow;
    }
    final participants = [_uid, widget.receiverId]..sort();
    await ref.set({
      'participants': participants,
      'createdAt': FieldValue.serverTimestamp(),
      'updatedAt': FieldValue.serverTimestamp(),
      'unreadCounts': {_uid: 0, widget.receiverId: 0},
    });
  }

  Future<bool> _send(GiftCatalogItem gift) async {
    if (_uid.isEmpty || widget.receiverId.isEmpty || _uid == widget.receiverId) {
      _snack('لا يمكن إرسال الهدية لهذا الحساب.');
      return false;
    }
    if (_sendingGiftId != null) return false;
    setState(() => _sendingGiftId = gift.id);
    try {
      final conversationId = _conversationId();
      await _ensureConversation(conversationId);
      final token = await FirebaseAuth.instance.currentUser?.getIdToken();
      if (token == null || token.isEmpty) throw StateError('not_signed_in');
      final key = [
        _uid,
        DateTime.now().microsecondsSinceEpoch.toString(),
        gift.id,
        'profile',
      ].join('_');
      final response = await http.post(
        Uri.parse('$_apiBase/chat-actions'),
        headers: {
          'authorization': 'Bearer $token',
          'content-type': 'application/json',
        },
        body: jsonEncode({
          'action': 'sendGift',
          'receiverId': widget.receiverId,
          'giftId': gift.id,
          'quantity': _quantity,
          'conversationId': conversationId,
          'idempotencyKey': key,
        }),
      );
      Map<String, dynamic> body = <String, dynamic>{};
      try {
        final decoded = jsonDecode(response.body);
        if (decoded is Map<String, dynamic>) body = decoded;
      } catch (_) {}
      if (response.statusCode == 200 && body['ok'] == true) {
        _snack(
          'تم إرسال ${gift.nameAr} ×$_quantity إلى ${widget.receiverName}',
        );
        return true;
      }
      switch (body['code']) {
        case 'insufficient_balance':
          _snack('رصيد العملات غير كافٍ لإرسال الهدية.');
          break;
        case 'blocked':
          _snack('لا يمكن إرسال هدية بينكما حالياً بسبب إعدادات الحظر.');
          break;
        case 'gift_inactive':
          _snack('هذه الهدية متوقفة حالياً.');
          break;
        case 'emergency_locked':
          _snack('عمليات الهدايا متوقفة مؤقتاً.');
          break;
        default:
          _snack('تعذر إرسال الهدية حالياً.');
      }
    } catch (_) {
      _snack('تعذر إرسال الهدية حالياً.');
    } finally {
      if (mounted) setState(() => _sendingGiftId = null);
    }
    return false;
  }

  void _snack(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
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
      style: const TextStyle(fontSize: 40),
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
          height: MediaQuery.sizeOf(context).height * .70,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 18),
            child: _loading
                ? const Center(
                    child: CircularProgressIndicator(
                      color: Color(0xFF8A3DFF),
                    ),
                  )
                : _error != null
                    ? Center(
                        child: Text(
                          _error!,
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
                          const SizedBox(height: 14),
                          Row(
                            children: [
                              const Icon(
                                Icons.card_giftcard_rounded,
                                color: Color(0xFFFFD54A),
                              ),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Text(
                                  'إرسال هدية إلى ${widget.receiverName}',
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    color: Colors.white,
                                    fontSize: 20,
                                    fontWeight: FontWeight.w900,
                                  ),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 12),
                          Wrap(
                            spacing: 8,
                            children: [1, 7, 77, 777]
                                .map(
                                  (value) => ChoiceChip(
                                    label: Text('×$value'),
                                    selected: _quantity == value,
                                    onSelected: (_) =>
                                        setState(() => _quantity = value),
                                    selectedColor: const Color(0xFF7B2DFF),
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
                          const SizedBox(height: 12),
                          Expanded(
                            child: _catalog.isEmpty
                                ? const Center(
                                    child: Text(
                                      'لا توجد هدايا مفعلة حالياً',
                                      style: TextStyle(color: Colors.white54),
                                    ),
                                  )
                                : GridView.builder(
                                    gridDelegate:
                                        const SliverGridDelegateWithFixedCrossAxisCount(
                                      crossAxisCount: 3,
                                      crossAxisSpacing: 10,
                                      mainAxisSpacing: 10,
                                      childAspectRatio: .78,
                                    ),
                                    itemCount: _catalog.length,
                                    itemBuilder: (_, index) {
                                      final gift = _catalog[index];
                                      final busy =
                                          _sendingGiftId == gift.id;
                                      return InkWell(
                                        borderRadius:
                                            BorderRadius.circular(18),
                                        onTap: busy
                                            ? null
                                            : () async {
                                                final ok =
                                                    await _send(gift);
                                                if (ok &&
                                                    context.mounted) {
                                                  Navigator.pop(context);
                                                }
                                              },
                                        child: Container(
                                          padding: const EdgeInsets.all(9),
                                          decoration: BoxDecoration(
                                            color: const Color(0xFF121725),
                                            borderRadius:
                                                BorderRadius.circular(18),
                                            border: Border.all(
                                              color: Colors.white10,
                                            ),
                                          ),
                                          child: Column(
                                            children: [
                                              Expanded(
                                                child: Stack(
                                                  alignment: Alignment.center,
                                                  children: [
                                                    _giftImage(gift),
                                                    if (busy)
                                                      const CircularProgressIndicator(
                                                        strokeWidth: 2,
                                                        color: Color(
                                                          0xFFFFD54A,
                                                        ),
                                                      ),
                                                  ],
                                                ),
                                              ),
                                              const SizedBox(height: 5),
                                              Text(
                                                gift.nameAr,
                                                maxLines: 1,
                                                overflow:
                                                    TextOverflow.ellipsis,
                                                style: const TextStyle(
                                                  color: Colors.white,
                                                  fontSize: 11,
                                                  fontWeight:
                                                      FontWeight.w800,
                                                ),
                                              ),
                                              Text(
                                                '🪙 ${gift.priceCoins * _quantity}',
                                                style: const TextStyle(
                                                  color: Color(0xFFFFD54A),
                                                  fontSize: 10,
                                                  fontWeight:
                                                      FontWeight.w900,
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
                      ),
          ),
        ),
      ),
    );
  }
}
