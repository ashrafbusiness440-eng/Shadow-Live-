import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../../profile/widgets/profile_avatar_with_frame.dart';
import '../../room/services/room_presence_service.dart';
import '../../room/services/room_seat_service.dart';
import '../services/gift_catalog_service.dart';
import '../services/room_gift_service.dart';
import 'unified_gift_picker_sheet.dart';

Future<void> showRoomGiftSheet(
  BuildContext context, {
  required String roomId,
  required String ownerUid,
  required String ownerPhotoUrl,
  required List<RoomPresenceUser> participants,
  required List<VoiceSeat> seats,
  Future<bool> Function()? ensurePresence,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: const Color(0xFF0C101A),
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(26)),
    ),
    builder: (_) => _RoomGiftContext(
      roomId: roomId,
      ownerUid: ownerUid,
      ownerPhotoUrl: ownerPhotoUrl,
      participants: participants,
      seats: seats,
      ensurePresence: ensurePresence,
    ),
  );
}

class _RoomGiftContext extends StatefulWidget {
  const _RoomGiftContext({
    required this.roomId,
    required this.ownerUid,
    required this.ownerPhotoUrl,
    required this.participants,
    required this.seats,
    this.ensurePresence,
  });

  final String roomId;
  final String ownerUid;
  final String ownerPhotoUrl;
  final List<RoomPresenceUser> participants;
  final List<VoiceSeat> seats;
  final Future<bool> Function()? ensurePresence;

  @override
  State<_RoomGiftContext> createState() => _RoomGiftContextState();
}

class _RoomGiftContextState extends State<_RoomGiftContext> {
  final RoomGiftService _gifts = RoomGiftService();
  final Set<String> _selectedIds = <String>{};
  String _recipientMode = 'users';

  String get _uid => FirebaseAuth.instance.currentUser?.uid ?? '';

  @override
  void initState() {
    super.initState();
    // Default to the room owner, not silently to gifting yourself.
    final ownerId = widget.ownerUid.trim();
    if (ownerId.isNotEmpty && ownerId != _uid) {
      _selectedIds.add(ownerId);
    } else if (_uid.isNotEmpty) {
      _selectedIds.add(_uid);
    }
  }

  @override
  void dispose() {
    _gifts.close();
    super.dispose();
  }

  List<RoomPresenceUser> get _participants {
    final seen = <String>{};
    final items = widget.participants
        .where((item) => item.uid.isNotEmpty && seen.add(item.uid))
        .toList(growable: true);
    // The seat snapshot is already present in this sheet. Do not hide real
    // microphone occupants if realtime roster has not arrived yet.
    for (final seat in widget.seats) {
      if (!seat.occupied || !seen.add(seat.uid)) continue;
      items.add(RoomPresenceUser.fromMap(<String, dynamic>{
        'uid': seat.uid,
        'displayName': seat.displayName,
        'profileImageUrl': seat.profileImageUrl,
        'mysteriousMode': seat.mysteriousMode,
        'mysteriousId': seat.mysteriousId,
      }));
    }
    final ownerUid = widget.ownerUid.trim();
    items.sort((a, b) {
      if (ownerUid.isNotEmpty) {
        if (a.uid == ownerUid && b.uid != ownerUid) return -1;
        if (b.uid == ownerUid && a.uid != ownerUid) return 1;
      }
      final aSeat = _seatNumber(a.uid);
      final bSeat = _seatNumber(b.uid);
      if (aSeat != null && bSeat == null) return -1;
      if (bSeat != null && aSeat == null) return 1;
      if (aSeat != null && bSeat != null) return aSeat.compareTo(bSeat);
      return a.joinedAtMs.compareTo(b.joinedAtMs);
    });
    return items;
  }

  int? _seatNumber(String uid) {
    for (final seat in widget.seats) {
      if (seat.occupied && seat.uid == uid) return seat.index + 1;
    }
    return null;
  }

  Set<String> get _micIds => widget.seats
      .where((seat) => seat.occupied && seat.uid.isNotEmpty)
      .map((seat) => seat.uid)
      .toSet();

  void _selectMode(String mode) {
    setState(() {
      _recipientMode = mode;
      if (mode != 'users') _selectedIds.clear();
    });
  }

  void _toggleUser(String uid) {
    if (uid.isEmpty) return;
    setState(() {
      _recipientMode = 'users';
      if (!_selectedIds.add(uid)) _selectedIds.remove(uid);
    });
  }

  bool get _canSend => switch (_recipientMode) {
        'all_mics' => _micIds.isNotEmpty,
        'all_room' => _participants.isNotEmpty || _uid.isNotEmpty,
        _ => _selectedIds.isNotEmpty,
      };

  RoomPresenceUser? _participant(String uid) {
    for (final user in _participants) {
      if (user.uid == uid) return user;
    }
    return null;
  }

  Widget _avatar(String uid, {double diameter = 38}) {
    final user = _participant(uid);
    if (user == null) {
      final ownerUid = widget.ownerUid.trim();
      if (uid == ownerUid && ownerUid.isNotEmpty) {
        return ProfileAvatarWithFrame(
          diameter: diameter,
          userId: ownerUid,
          backgroundColor: const Color(0xFF25183F),
          placeholderColor: Colors.white70,
          fallbackProfile: <String, dynamic>{
            'profileImageUrl': widget.ownerPhotoUrl.trim(),
          },
          fallbackIsVisualSnapshot: true,
          useVipFallback: true,
        );
      }
      return CircleAvatar(
        radius: diameter / 2,
        backgroundColor: const Color(0xFF2B2141),
        child: Icon(
          uid == _uid ? Icons.person_rounded : Icons.person_outline_rounded,
          color: Colors.white70,
          size: diameter * .55,
        ),
      );
    }
    return ProfileAvatarWithFrame(
      diameter: diameter,
      userId: user.uid,
      backgroundColor: const Color(0xFF25183F),
      placeholderColor: Colors.white70,
      fallbackProfile: <String, dynamic>{
        'profileImageUrl': user.profileImageUrl,
        'activeProfileFrameAssetKey': user.activeProfileFrameAssetKey,
        'activeProfileFrameImageUrl': user.activeProfileFrameImageUrl,
        'activeProfileFrameExpiresAtMs': user.activeProfileFrameExpiresAtMs,
        'activeProfileFramePermanent': user.activeProfileFramePermanent,
      },
      fallbackIsVisualSnapshot: true,
      vipLevel: user.vipLevel,
      useVipFallback: true,
    );
  }

  String _displayName(String uid) {
    if (uid == _uid) return 'أنا';
    return _participant(uid)?.displayName ?? 'مستخدم';
  }

  Future<GiftPickerSendResult> _send(
    GiftCatalogItem gift,
    int quantity,
    bool useGiftBag,
  ) async {
    // Room WebSocket may be reconnecting even while the backend already
    // recognizes the live room. The server enforces authoritative presence
    // during gift mutation; a local preflight must not reject valid gifts.
    final result = await _gifts.send(
      roomId: widget.roomId,
      giftId: gift.id,
      quantity: quantity,
      recipientMode: _recipientMode,
      recipientIds: _selectedIds.toList(growable: false),
      useGiftBag: useGiftBag,
    );
    final balance = (result['balance'] as num?)?.toInt();
    if (balance != null) GiftCatalogService.updateCachedBalance(balance);
    final recipientCount =
        (result['recipientCount'] as num?)?.toInt() ??
        (_recipientMode == 'users' ? _selectedIds.length : 0);
    final totalCost = (result['totalCost'] as num?)?.toInt() ?? 0;
    final paidCost =
        (result['paidCost'] as num?)?.toInt() ?? (useGiftBag ? 0 : totalCost);
    return GiftPickerSendResult(
      balanceCoins: balance,
      wealthDeltaCoins: paidCost,
      bagQuantityRemaining:
          (result['bagQuantityRemaining'] as num?)?.toInt(),
      message: recipientCount <= 1
          ? 'تم إرسال ${gift.nameAr} ×$quantity — $totalCost كوينز'
          : 'تم إرسال ${gift.nameAr} إلى $recipientCount مستلمين — $totalCost كوينز',
    );
  }

  Widget _modeButton({
    required String mode,
    required IconData icon,
  }) {
    final selected = _recipientMode == mode;
    return InkWell(
      onTap: () => _selectMode(mode),
      borderRadius: BorderRadius.circular(12),
      child: Container(
        height: 34,
        padding: const EdgeInsets.symmetric(horizontal: 8),
        decoration: BoxDecoration(
          color: selected
              ? const Color(0xFF332154)
              : const Color(0xFF171B24),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: selected
                ? const Color(0xFF8B3DFF)
                : Colors.white10,
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text(
              'الجميع',
              style: TextStyle(
                color: Colors.white70,
                fontSize: 9.5,
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(width: 4),
            Icon(icon, size: 15, color: Colors.white70),
          ],
        ),
      ),
    );
  }

  Widget _recipientArea() {
    final ownerUid = widget.ownerUid.trim();
    final users = <String>[
      if (ownerUid.isNotEmpty) ownerUid,
      ..._participants
          .map((user) => user.uid)
          .where((uid) => uid != ownerUid),
    ];
    return SizedBox(
      height: 52,
      child: Row(
        textDirection: TextDirection.ltr,
        children: [
          _modeButton(
            mode: 'all_mics',
            icon: Icons.mic_rounded,
          ),
          const SizedBox(width: 5),
          _modeButton(
            mode: 'all_room',
            icon: Icons.home_rounded,
          ),
          const SizedBox(width: 7),
          Expanded(
            child: Directionality(
              textDirection: TextDirection.rtl,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                itemCount: users.length,
                separatorBuilder: (_, __) => const SizedBox(width: 7),
                itemBuilder: (_, index) {
                  final uid = users[index];
                  final selected =
                      _recipientMode == 'users' && _selectedIds.contains(uid);
                  final seatNumber = _seatNumber(uid);
                  final isOwner =
                      widget.ownerUid.trim().isNotEmpty &&
                      widget.ownerUid.trim() == uid;
                  return InkWell(
                    onTap: () => _toggleUser(uid),
                    borderRadius: BorderRadius.circular(99),
                    child: SizedBox(
                      width: 42,
                      child: Stack(
                        alignment: Alignment.center,
                        clipBehavior: Clip.none,
                        children: [
                          Container(
                            width: 38,
                            height: 38,
                            padding: const EdgeInsets.all(1.5),
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              border: Border.all(
                                color: selected
                                    ? const Color(0xFF9D4DFF)
                                    : Colors.white12,
                                width: selected ? 2 : 1,
                              ),
                            ),
                            child: ClipOval(
                              child: _avatar(uid, diameter: 35),
                            ),
                          ),
                          if (seatNumber != null)
                            Positioned(
                              left: 0,
                              bottom: 0,
                              child: Container(
                                constraints: const BoxConstraints(minWidth: 17),
                                height: 17,
                                padding:
                                    const EdgeInsets.symmetric(horizontal: 3),
                                decoration: BoxDecoration(
                                  color: const Color(0xFF090B10),
                                  borderRadius: BorderRadius.circular(9),
                                  border: Border.all(
                                    color: const Color(0xFF7B2DFF),
                                  ),
                                ),
                                alignment: Alignment.center,
                                child: Text(
                                  seatNumber.toString(),
                                  style: const TextStyle(
                                    color: Colors.white,
                                    fontSize: 8.5,
                                    fontWeight: FontWeight.w900,
                                  ),
                                ),
                              ),
                            ),
                          if (isOwner)
                            const Positioned(
                              right: -1,
                              top: 0,
                              child: CircleAvatar(
                                radius: 7,
                                backgroundColor: Color(0xFFE33A4C),
                                child: Icon(
                                  Icons.home_rounded,
                                  color: Colors.white,
                                  size: 9,
                                ),
                              ),
                            ),
                          if (selected)
                            const Positioned(
                              right: 0,
                              bottom: 0,
                              child: CircleAvatar(
                                radius: 6,
                                backgroundColor: Color(0xFFFFD54A),
                                child: Icon(
                                  Icons.check_rounded,
                                  size: 8,
                                  color: Colors.black,
                                ),
                              ),
                            ),
                        ],
                      ),
                    ),
                  );
                },
              ),
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return UnifiedGiftPickerSheet(
      title: 'الهدايا',
      recipientArea: _recipientArea(),
      canSend: _canSend,
      onSend: _send,
    );
  }
}
