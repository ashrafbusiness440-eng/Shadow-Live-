import 'package:flutter/material.dart';

import '../../room/widgets/managed_rooms_panel.dart';

/// Present the owner's personal room without fetching room documents.
///
/// Opening the room is deliberately a user action: the caller delegates to
/// the existing authenticated RoomActionService.personalRoom command, which
/// returns authoritative navigation arguments and applies its own access rules.
class ProfilePersonalRoomTab extends StatelessWidget {
  const ProfilePersonalRoomTab({
    super.key,
    required this.onOpenPersonalRoom,
    required this.onBrowseRooms,
    this.opening = false,
    this.showManagedRooms = true,
  });

  final VoidCallback onOpenPersonalRoom;
  final VoidCallback onBrowseRooms;
  final bool opening;
  /// Allows isolated widget tests to render the static profile card.
  final bool showManagedRooms;

  @override
  Widget build(BuildContext context) {
    return ListView(
      key: const Key('own-profile-rooms-content'),
      padding: const EdgeInsets.fromLTRB(16, 20, 16, 28),
      children: [
        // Kept only for isolated widget tests and offline fallback previews.
        // The actual profile now presents the one authoritative managed-room
        // list instead of duplicating a large static "my room" placeholder.
        if (!showManagedRooms) Container(
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            color: const Color(0xFF0C1728),
            borderRadius: BorderRadius.circular(22),
            border: Border.all(color: const Color(0x55FFD54A)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Align(
                alignment: AlignmentDirectional.centerStart,
                child: Container(
                  width: 56,
                  height: 56,
                  decoration: BoxDecoration(
                    color: const Color(0xFF281B42),
                    borderRadius: BorderRadius.circular(17),
                  ),
                  child: const Icon(
                    Icons.mic_rounded,
                    size: 28,
                    color: Color(0xFFFFD54A),
                  ),
                ),
              ),
              const SizedBox(height: 14),
              const Text(
                'غرفتي الصوتية',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 19,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 8),
              const Text(
                'افتح غرفتك الشخصية واستقبل الأصدقاء. يتم التحقق من الغرفة وصلاحياتك عند الدخول.',
                style: TextStyle(
                  color: Colors.white70,
                  fontSize: 12,
                  height: 1.6,
                ),
              ),
              const SizedBox(height: 18),
              FilledButton.icon(
                key: const Key('own-profile-open-personal-room'),
                onPressed: opening ? null : onOpenPersonalRoom,
                style: FilledButton.styleFrom(
                  backgroundColor: const Color(0xFFFFD54A),
                  foregroundColor: const Color(0xFF171221),
                  minimumSize: const Size.fromHeight(48),
                ),
                icon: opening
                    ? const SizedBox.square(
                        dimension: 17,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.meeting_room_rounded),
                label: Text(opening ? 'جارٍ فتح غرفتك...' : 'الدخول إلى غرفتي'),
              ),
            ],
          ),
        ),
        if (showManagedRooms) ...[
        const SizedBox(height: 18),
        const Text(
          'غرفي والإشراف',
          style: TextStyle(
            color: Colors.white,
            fontSize: 17,
            fontWeight: FontWeight.w900,
          ),
        ),
        const SizedBox(height: 6),
        ManagedRoomsPanel(
          onOpenPersonalRoom: onOpenPersonalRoom,
          openingPersonalRoom: opening,
          showOpenPersonalFallback: true,
          profileStyle: true,
        ),
        ],
        const SizedBox(height: 12),
        OutlinedButton.icon(
          key: const Key('own-profile-browse-rooms'),
          onPressed: onBrowseRooms,
          style: OutlinedButton.styleFrom(
            foregroundColor: const Color(0xFFFFD54A),
            side: const BorderSide(color: Color(0x668A3DFF)),
            minimumSize: const Size.fromHeight(48),
          ),
          icon: const Icon(Icons.explore_outlined),
          label: const Text('استكشاف الغرف الأخرى'),
        ),
      ],
    );
  }
}
