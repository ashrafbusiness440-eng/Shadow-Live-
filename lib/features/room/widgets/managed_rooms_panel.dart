import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../../../services/navigation_service.dart';
import '../services/room_action_service.dart';
import 'discovery_room_password_dialog.dart';

/// One explicit, bounded server read per surface open. The server verifies
/// each current room role; the client still uses ordinary room admission.
class ManagedRoomsPanel extends StatefulWidget {
  const ManagedRoomsPanel({
    super.key,
    required this.onOpenPersonalRoom,
    this.sheetMode = false,
    this.openingPersonalRoom = false,
    this.showOpenPersonalFallback = true,
  });

  final VoidCallback onOpenPersonalRoom;
  final bool sheetMode;
  final bool openingPersonalRoom;
  final bool showOpenPersonalFallback;

  @override
  State<ManagedRoomsPanel> createState() => _ManagedRoomsPanelState();
}

class _ManagedRoomsPanelState extends State<ManagedRoomsPanel> {
  final RoomActionService _service = RoomActionService();
  List<ManagedRoomEntry> _rooms = const [];
  bool _loading = false;
  bool _failed = false;
  bool _entering = false;
  String? _requestedUid;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _service.close();
    super.dispose();
  }

  Future<void> _load() async {
    final user = FirebaseAuth.instance.currentUser;
    if (_loading) return;
    if (user == null || user.isAnonymous) {
      if (mounted) setState(() {
        _rooms = const [];
        _failed = false;
      });
      return;
    }
    _requestedUid = user.uid;
    setState(() {
      _loading = true;
      _failed = false;
    });
    try {
      final rooms = await _service.loadManagedRooms();
      if (!mounted || FirebaseAuth.instance.currentUser?.uid != user.uid ||
          _requestedUid != user.uid) return;
      setState(() => _rooms = rooms);
    } catch (_) {
      if (mounted && FirebaseAuth.instance.currentUser?.uid == user.uid) {
        setState(() => _failed = true);
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _enter(ManagedRoomEntry entry) async {
    if (_entering) return;
    final user = FirebaseAuth.instance.currentUser;
    if (user == null || user.isAnonymous) return;
    setState(() => _entering = true);
    try {
      final room = entry.room;
      if (entry.isOwner && room.roomId == 'personal_${user.uid}') {
        if (widget.sheetMode && mounted) Navigator.of(context).pop();
        widget.onOpenPersonalRoom();
        return;
      }
      final args = room.toNavigationArguments();
      if (room.passwordProtected && room.ownerUid != user.uid) {
        final password = await showDiscoveryRoomPasswordPrompt(
          context, room.name,
        );
        if (password == null || !mounted) return;
        args['roomPassword'] = password;
      }
      if (!mounted || FirebaseAuth.instance.currentUser?.uid != user.uid) return;
      if (widget.sheetMode) Navigator.of(context).pop();
      NavigationService.navigateTo(
        AppRoutes.voiceChatRoom,
        arguments: args,
      );
    } finally {
      if (mounted) setState(() => _entering = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = FirebaseAuth.instance.currentUser;
    final eligible = user != null && !user.isAnonymous;
    final accountMatches = user?.uid == _requestedUid;
    if (eligible && !accountMatches && !_loading) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && !_loading &&
            FirebaseAuth.instance.currentUser?.uid != _requestedUid) _load();
      });
    }
    final hasOwnRoom = _rooms.any((item) => item.isOwner &&
        item.room.roomId == 'personal_${user?.uid}');
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (!eligible)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 16),
              child: Text(
                'سجّل الدخول لتشاهد غرفتك والغرف التي تشرف عليها.',
                style: TextStyle(color: Colors.white70),
              ),
            )
          else if (_loading || !accountMatches)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 20),
              child: Center(child: CircularProgressIndicator(
                color: Color(0xFFFFD54A),
              )),
            )
          else if (_failed)
            Column(
              children: [
                const Text('تعذر تحميل غرفك الآن. حاول مرة ثانية.',
                    style: TextStyle(color: Colors.white70)),
                TextButton.icon(
                  onPressed: _load,
                  icon: const Icon(Icons.refresh_rounded),
                  label: const Text('إعادة المحاولة'),
                ),
              ],
            )
          else if (_rooms.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 12),
              child: Text(
                'ما عندك غرف نشطة أو غرف إشراف متاحة حالياً.',
                style: TextStyle(color: Colors.white60),
              ),
            ),
          if (!_loading && !_failed) ...[
            for (final item in _rooms)
              Card(
                key: ValueKey('managed-room-${item.room.roomId}'),
                color: const Color(0xFF15192A),
                margin: const EdgeInsets.symmetric(vertical: 5),
                child: ListTile(
                  contentPadding: const EdgeInsets.symmetric(
                    horizontal: 12, vertical: 5,
                  ),
                  leading: const CircleAvatar(
                    backgroundColor: Color(0xFF322449),
                    child: Icon(Icons.mic_rounded, color: Color(0xFFFFD54A)),
                  ),
                  title: Text(
                    item.room.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: Colors.white, fontWeight: FontWeight.w800,
                    ),
                  ),
                  subtitle: Text(
                    '${item.isOwner ? "غرفتي" : "مشرف"} • ${item.room.ownerName.isNotEmpty ? item.room.ownerName : "مالك الغرفة"}'
                    '${item.room.publicId.isEmpty ? "" : " • ID: ${item.room.publicId}"}',
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(color: Colors.white60, fontSize: 11),
                  ),
                  trailing: _entering
                      ? const SizedBox.square(
                          dimension: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(
                          Icons.arrow_circle_left_outlined,
                          color: Color(0xFFFFD54A),
                        ),
                  onTap: _entering ? null : () => _enter(item),
                ),
              ),
          ],
          if (eligible && !hasOwnRoom && widget.showOpenPersonalFallback)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: OutlinedButton.icon(
                key: const Key('managed-rooms-open-personal-room'),
                onPressed: widget.openingPersonalRoom
                    ? null
                    : () {
                        if (widget.sheetMode) Navigator.of(context).pop();
                        widget.onOpenPersonalRoom();
                      },
                icon: const Icon(Icons.add_home_rounded),
                label: const Text('فتح غرفتي الشخصية'),
              ),
            ),
        ],
      ),
    );
  }
}
