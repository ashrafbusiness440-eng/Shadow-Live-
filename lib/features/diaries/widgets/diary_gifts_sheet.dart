import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../../../core/assets/shadow_asset_registry.dart';
import '../../gift/widgets/direct_gift_sheet.dart';
import '../../profile/screens/public_profile_screen.dart';
import '../services/diary_service.dart';
import '../../profile/widgets/profile_avatar_with_frame.dart';

class DiaryGiftsSheet extends StatefulWidget {
  const DiaryGiftsSheet({
    super.key,
    required this.diary,
    required this.service,
    required this.onGuestAction,
    required this.onGiftTotalsChanged,
  });

  final DiaryItem diary;
  final DiaryService service;
  final Future<void> Function() onGuestAction;
  final void Function(int giftCount, int giftCoins) onGiftTotalsChanged;

  @override
  State<DiaryGiftsSheet> createState() => _DiaryGiftsSheetState();
}

class _DiaryGiftsSheetState extends State<DiaryGiftsSheet> {
  List<DiaryGiftEventItem> _items = const <DiaryGiftEventItem>[];
  String? _cursor;
  bool _hasMore = true;
  bool _loading = false;
  Object? _error;
  late int _giftCount;
  late int _giftCoins;

  bool get _guest => FirebaseAuth.instance.currentUser?.isAnonymous == true;

  @override
  void initState() {
    super.initState();
    _giftCount = widget.diary.giftCount;
    _giftCoins = widget.diary.giftCoins;
    _load(reset: true);
  }

  Future<void> _load({required bool reset}) async {
    if (_loading) return;
    setState(() {
      _loading = true;
      if (reset) _error = null;
    });
    try {
      final page = await widget.service.listGiftEvents(
        widget.diary.diaryId,
        cursor: reset ? null : _cursor,
      );
      if (!mounted) return;
      final map = <String, DiaryGiftEventItem>{
        if (!reset) for (final item in _items) item.giftEventId: item,
        for (final item in page.items) item.giftEventId: item,
      };
      final merged = map.values.toList(growable: false)
        ..sort((a, b) {
          final time = b.createdAtMs.compareTo(a.createdAtMs);
          if (time != 0) return time;
          return b.giftEventId.compareTo(a.giftEventId);
        });
      setState(() {
        _items = merged;
        _cursor = page.nextCursor;
        _hasMore = page.hasMore;
        _error = null;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _sendGift() async {
    if (_guest) {
      await widget.onGuestAction();
      return;
    }
    await showDirectGiftSheet(
      context,
      receiverId: widget.diary.ownerUid,
      receiverName: widget.diary.ownerName,
      diaryId: widget.diary.diaryId,
      onGiftSent: (quantity, paidCost) {
        if (!mounted) return;
        setState(() {
          _giftCount += quantity;
          _giftCoins += paidCost;
        });
        widget.onGiftTotalsChanged(_giftCount, _giftCoins);
        _load(reset: true);
      },
    );
  }

  void _openProfile(DiaryGiftEventItem item) {
    if (item.senderId.isEmpty) return;
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => PublicProfileScreen(userId: item.senderId),
      ),
    );
  }

  String _timeLabel(int createdAtMs) {
    if (createdAtMs <= 0) return '';
    final created = DateTime.fromMillisecondsSinceEpoch(createdAtMs);
    final diff = DateTime.now().difference(created);
    if (diff.inMinutes < 1) return 'الآن';
    if (diff.inMinutes < 60) return 'منذ ${diff.inMinutes} د';
    if (diff.inHours < 24) return 'منذ ${diff.inHours} س';
    if (diff.inDays < 7) return 'منذ ${diff.inDays} ي';
    return '${created.day}/${created.month}/${created.year}';
  }

  Widget _giftVisual(DiaryGiftEventItem item) {
    if (item.imageUrl.isNotEmpty) {
      return Image.network(
        item.imageUrl,
        fit: BoxFit.contain,
        errorBuilder: (_, __, ___) => const Icon(
          Icons.card_giftcard_rounded,
          color: Color(0xFFFFD54A),
        ),
      );
    }
    if (item.assetKey.isEmpty) {
      return const Icon(
        Icons.card_giftcard_rounded,
        color: Color(0xFFFFD54A),
      );
    }
    return FutureBuilder<Uri?>(
      future: ShadowAssetRegistry.remoteUrl(item.assetKey),
      builder: (context, snapshot) {
        final url = snapshot.data?.toString().trim() ?? '';
        if (url.isEmpty) {
          return const Icon(
            Icons.card_giftcard_rounded,
            color: Color(0xFFFFD54A),
          );
        }
        return Image.network(
          url,
          fit: BoxFit.contain,
          errorBuilder: (_, __, ___) => const Icon(
            Icons.card_giftcard_rounded,
            color: Color(0xFFFFD54A),
          ),
        );
      },
    );
  }

  Widget _item(DiaryGiftEventItem item) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 7),
      child: Row(
        children: [
          InkWell(
            customBorder: const CircleBorder(),
            onTap: () => _openProfile(item),
            child: ProfileAvatarWithFrame(
              diameter: 40,
              userId: item.senderId,
              backgroundColor: const Color(0xFF272C39),
              placeholderColor: Colors.white54,
              fallbackProfile: <String, dynamic>{
                'profileImageUrl': item.senderProfileImageUrl,
              },
            ),
          ),
          const SizedBox(width: 10),
          SizedBox(width: 42, height: 42, child: _giftVisual(item)),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  item.senderName.isEmpty ? 'مستخدم Shadow Live' : item.senderName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                Text(
                  '${item.giftName} ×${item.quantity} • 🪙 ${_compact(item.totalCost)}',
                  style: const TextStyle(color: Colors.white60, fontSize: 12),
                ),
                if (item.senderPublicId.isNotEmpty)
                  Text(
                    'ID: ${item.senderPublicId}',
                    style: const TextStyle(color: Colors.white30, fontSize: 10),
                  ),
              ],
            ),
          ),
          Text(
            _timeLabel(item.createdAtMs),
            style: const TextStyle(color: Colors.white38, fontSize: 10),
          ),
        ],
      ),
    );
  }

  String _compact(int value) {
    if (value >= 1000000) {
      final n = value / 1000000;
      return '${n.toStringAsFixed(n >= 10 ? 0 : 1)}M';
    }
    if (value >= 1000) {
      final n = value / 1000;
      return '${n.toStringAsFixed(n >= 10 ? 0 : 1)}K';
    }
    return value.toString();
  }

  Widget _body() {
    if (_items.isEmpty && _loading) {
      return const Center(
        child: CircularProgressIndicator(color: Color(0xFF8A3DFF)),
      );
    }
    if (_items.isEmpty && _error != null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              diaryErrorMessage(_error!),
              textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.white54),
            ),
            const SizedBox(height: 10),
            OutlinedButton(
              onPressed: () => _load(reset: true),
              child: const Text('إعادة المحاولة'),
            ),
          ],
        ),
      );
    }
    if (_items.isEmpty) {
      return const Center(
        child: Text(
          'ما في هدايا على هذه اليومية لسه.',
          style: TextStyle(color: Colors.white54),
        ),
      );
    }

    return ListView(
      padding: const EdgeInsets.fromLTRB(14, 8, 14, 12),
      children: [
        for (final item in _items) _item(item),
        if (_hasMore)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: OutlinedButton(
              onPressed: _loading ? null : () => _load(reset: false),
              child: _loading
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('تحميل المزيد'),
            ),
          ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: SafeArea(
        top: false,
        child: SizedBox(
          height: MediaQuery.sizeOf(context).height * .76,
          child: Column(
            children: [
              const SizedBox(height: 10),
              Container(
                width: 44,
                height: 4,
                decoration: BoxDecoration(
                  color: Colors.white24,
                  borderRadius: BorderRadius.circular(99),
                ),
              ),
              const SizedBox(height: 12),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 14),
                child: Row(
                  children: [
                    const Icon(
                      Icons.card_giftcard_rounded,
                      color: Color(0xFFFFD54A),
                    ),
                    const SizedBox(width: 8),
                    const Expanded(
                      child: Text(
                        'هدايا اليومية',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 18,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ),
                    Text(
                      '${_compact(_giftCount)} • 🪙 ${_compact(_giftCoins)}',
                      style: const TextStyle(color: Colors.white54),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 6),
              Divider(color: Colors.white.withValues(alpha: .08), height: 1),
              Expanded(child: _body()),
              Divider(color: Colors.white.withValues(alpha: .08), height: 1),
              Padding(
                padding: const EdgeInsets.fromLTRB(14, 10, 14, 14),
                child: SizedBox(
                  width: double.infinity,
                  child: FilledButton.icon(
                    onPressed: _sendGift,
                    style: FilledButton.styleFrom(
                      backgroundColor: const Color(0xFF7B2DFF),
                      padding: const EdgeInsets.symmetric(vertical: 13),
                    ),
                    icon: Icon(
                      _guest ? Icons.login_rounded : Icons.card_giftcard_rounded,
                    ),
                    label: Text(
                      _guest ? 'سجّل الدخول لإرسال هدية' : 'إرسال هدية',
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
