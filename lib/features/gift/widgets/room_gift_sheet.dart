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
  required List<RoomPresenceUser> participants,
  required List<VoiceSeat> seats,
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
      participants: participants,
      seats: seats,
    ),
  );
}

class _RoomGiftContext extends StatefulWidget {
  const _RoomGiftContext({
    required this.roomId,
    required this.participants,
    required this.seats,
  });

  final String roomId;
  final List<RoomPresenceUser> participants;
  final List<VoiceSeat> seats;

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
    if (_uid.isNotEmpty) _selectedIds.add(_uid);
  }

  @override
  void dispose() {
    _gifts.close();
    super.dispose();
  }

  List<RoomPresenceUser> get _participants {
    final seen = <String>{};
    return widget.participants
        .where((item) => item.uid.isNotEmpty && seen.add(item.uid))
        .toList(growable: false);
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
  ) async {
    final result = await _gifts.send(
      roomId: widget.roomId,
      giftId: gift.id,
      quantity: quantity,
      recipientMode: _recipientMode,
      recipientIds: _selectedIds.toList(growable: false),
    );
    final balance = (result['balance'] as num?)?.toInt();
    if (balance != null) GiftCatalogService.updateCachedBalance(balance);
    final recipientCount =
        (result['recipientCount'] as num?)?.toInt() ??
        (_recipientMode == 'users' ? _selectedIds.length : 0);
    final totalCost = (result['totalCost'] as num?)?.toInt() ?? 0;
    return GiftPickerSendResult(
      balanceCoins: balance,
      wealthDeltaCoins: totalCost,
      message: recipientCount <= 1
          ? 'تم إرسال ${gift.nameAr} ×$quantity — $totalCost كوينز'
          : 'تم إرسال ${gift.nameAr} إلى $recipientCount مستلمين — $totalCost كوينز',
    );
  }

  Widget _modeChip({
    required String mode,
    required String label,
    required IconData icon,
  }) {
    final selected = _recipientMode == mode;
    return ChoiceChip(
      avatar: Icon(
        icon,
        size: 16,
        color: selected ? Colors.white : Colors.white60,
      ),
      label: Text(label),
      selected: selected,
      onSelected: (_) => _selectMode(mode),
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
  }

  Widget _recipientArea() {
    final users = <String>[
      if (_uid.isNotEmpty) _uid,
      ..._participants.map((user) => user.uid).where((uid) => uid != _uid),
    ];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          height: 40,
          child: ListView(
            scrollDirection: Axis.horizontal,
            children: [
              _modeChip(
                mode: 'users',
                label: 'شخص أو أكثر',
                icon: Icons.people_alt_rounded,
              ),
              const SizedBox(width: 7),
              _modeChip(
                mode: 'all_mics',
                label: 'كل المايكات',
                icon: Icons.mic_rounded,
              ),
              const SizedBox(width: 7),
              _modeChip(
                mode: 'all_room',
                label: 'الجميع',
                icon: Icons.groups_rounded,
              ),
            ],
          ),
        ),
        const SizedBox(height: 7),
        if (_recipientMode == 'users')
          SizedBox(
            height: 70,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: users.length,
              separatorBuilder: (_, __) => const SizedBox(width: 7),
              itemBuilder: (_, index) {
                final uid = users[index];
                final selected = _selectedIds.contains(uid);
                return InkWell(
                  onTap: () => _toggleUser(uid),
                  borderRadius: BorderRadius.circular(14),
                  child: Container(
                    width: 70,
                    padding: const EdgeInsets.all(5),
                    decoration: BoxDecoration(
                      color: selected
                          ? const Color(0x332B8CFF)
                          : const Color(0xFF131824),
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(
                        color: selected
                            ? const Color(0xFFFFD54A)
                            : Colors.white10,
                      ),
                    ),
                    child: Column(
                      children: [
                        Stack(
                          clipBehavior: Clip.none,
                          children: [
                            _avatar(uid, diameter: 38),
                            if (selected)
                              const Positioned(
                                left: -2,
                                bottom: -1,
                                child: CircleAvatar(
                                  radius: 8,
                                  backgroundColor: Color(0xFFFFD54A),
                                  child: Icon(
                                    Icons.check_rounded,
                                    size: 12,
                                    color: Colors.black,
                                  ),
                                ),
                              ),
                          ],
                        ),
                        const SizedBox(height: 3),
                        Text(
                          _displayName(uid),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 9,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
          )
        else
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 9),
            decoration: BoxDecoration(
              color: const Color(0xFF151A28),
              borderRadius: BorderRadius.circular(13),
              border: Border.all(color: Colors.white10),
            ),
            child: Text(
              _recipientMode == 'all_mics'
                  ? 'السيرفر سيحسم الموجودين فعلياً على المايكات وقت الإرسال.'
                  : 'السيرفر سيحسم الموجودين فعلياً داخل الغرفة وقت الإرسال.',
              style: const TextStyle(
                color: Colors.white60,
                fontSize: 11,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
      ],
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
