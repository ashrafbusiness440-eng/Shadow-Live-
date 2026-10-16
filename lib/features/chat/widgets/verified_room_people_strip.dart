import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../../home/services/discovery_service.dart';
import '../../profile/widgets/profile_avatar_with_frame.dart';
import '../../profile/widgets/quick_profile_sheet.dart';
import '../../room/services/room_follow_navigation.dart';
import '../../room/services/room_realtime_query_service.dart';

/// Room-active people above Messages. Resolves a small public candidate page
/// through the same server-authoritative follow service used by Home/profile.
/// Never treats isOnline, room counts or stale room IDs as room membership.
class VerifiedRoomPeopleStrip extends StatefulWidget {
  const VerifiedRoomPeopleStrip({super.key, required this.ownerUid});

  final String ownerUid;

  @override
  State<VerifiedRoomPeopleStrip> createState() =>
      _VerifiedRoomPeopleStripState();
}

class _VerifiedRoomPeopleStripState extends State<VerifiedRoomPeopleStrip> {
  final DiscoveryService _discovery = DiscoveryService();
  final RoomRealtimeQueryService _roomQuery = RoomRealtimeQueryService();
  final List<DiscoveryPerson> _people = <DiscoveryPerson>[];
  final Map<String, RoomFollowLocation> _verified = {};
  Timer? _expiry;
  int _generation = 0;
  bool _loading = false;
  bool _failed = false;
  bool _expired = false;

  bool _current(String uid, int generation) =>
      mounted && uid == widget.ownerUid &&
      FirebaseAuth.instance.currentUser?.uid == uid &&
      generation == _generation;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  @override
  void didUpdateWidget(covariant VerifiedRoomPeopleStrip oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.ownerUid != widget.ownerUid) {
      ++_generation;
      _expiry?.cancel();
      _people.clear();
      _verified.clear();
      _failed = false;
      _expired = false;
      _loading = false;
      WidgetsBinding.instance.addPostFrameCallback((_) => _load());
    }
  }

  Future<void> _load() async {
    final uid = widget.ownerUid;
    if (_loading || uid.isEmpty ||
        FirebaseAuth.instance.currentUser?.uid != uid) return;
    final generation = ++_generation;
    _expiry?.cancel();
    setState(() {
      _loading = true;
      _failed = false;
      _expired = false;
      _people.clear();
      _verified.clear();
    });
    try {
      // Three small existing public-directory pages, maximum 30 profiles.
      // A candidate is NEVER shown until the Worker verifies live Room DO
      // membership, bidirectional blocks and room privacy.
      final candidates = <DiscoveryPerson>[];
      final seen = <String>{};
      DocumentSnapshot<Map<String, dynamic>>? cursor;
      for (var page = 0; page < 3; page++) {
        final result = await _discovery.loadPeoplePage(
          after: cursor,
          pageSize: 10,
        );
        if (!_current(uid, generation)) return;
        for (final person in result.people) {
          if (seen.add(person.id)) candidates.add(person);
        }
        cursor = result.nextCursor;
        if (!result.hasMore || cursor == null) break;
      }

      final found = <String, RoomFollowLocation>{};
      final ids = candidates.map((p) => p.id).toList(growable: false);
      for (var offset = 0; offset < ids.length && found.length < 10;
          offset += 8) {
        final end = offset + 8 < ids.length ? offset + 8 : ids.length;
        found.addAll(await _roomQuery.resolveRoomFollows(
          ids.sublist(offset, end),
        ));
        if (!_current(uid, generation)) return;
      }
      if (!_current(uid, generation)) return;
      setState(() {
        _people.addAll(candidates
            .where((person) => found.containsKey(person.id))
            .take(10));
        _verified.addAll(found);
        _loading = false;
      });
      if (_people.isNotEmpty) {
        // Local expiry only, no timer-driven network I/O or avatar listeners.
        _expiry = Timer(const Duration(seconds: 35), () {
          if (!_current(uid, generation)) return;
          setState(() {
            _people.clear();
            _verified.clear();
            _expired = true;
          });
        });
      }
    } catch (_) {
      if (!_current(uid, generation)) return;
      setState(() {
        _people.clear();
        _verified.clear();
        _failed = true;
        _loading = false;
      });
    }
  }

  Future<void> _follow(String targetUid) async {
    final owner = widget.ownerUid;
    if (FirebaseAuth.instance.currentUser?.uid != owner ||
        !_verified.containsKey(targetUid)) return;
    try {
      final message = await RoomFollowNavigation.open(
        context: context,
        targetUid: targetUid,
        query: _roomQuery,
      );
      if (!mounted || FirebaseAuth.instance.currentUser?.uid != owner) return;
      if (message != null) {
        setState(() {
          _people.removeWhere((person) => person.id == targetUid);
          _verified.remove(targetUid);
        });
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(message)));
      }
    } catch (_) {
      if (!mounted || FirebaseAuth.instance.currentUser?.uid != owner) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('تعذر التتبّع الآن. حاول من جديد.'),
      ));
    }
  }

  void _showActions(DiscoveryPerson person) {
    if (!_verified.containsKey(person.id)) return;
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: const Color(0xFF17162B),
      builder: (sheetContext) => Directionality(
        textDirection: TextDirection.rtl,
        child: SafeArea(
          child: Wrap(children: [
            ListTile(
              leading: const Icon(Icons.person_outline_rounded,
                  color: Color(0xFFFFD54A)),
              title: const Text('عرض الملف الشخصي',
                  style: TextStyle(color: Colors.white)),
              onTap: () {
                Navigator.pop(sheetContext);
                showQuickProfileSheet(context, userId: person.id);
              },
            ),
            ListTile(
              leading: const Icon(Icons.graphic_eq_rounded,
                  color: Color(0xFFFFD54A)),
              title: const Text('التتبّع إلى الغرفة',
                  style: TextStyle(color: Colors.white)),
              onTap: () {
                Navigator.pop(sheetContext);
                _follow(person.id);
              },
            ),
          ]),
        ),
      ),
    );
  }

  @override
  void dispose() {
    ++_generation;
    _expiry?.cancel();
    _roomQuery.close();
    _discovery.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final entries = _people.where((p) => _verified.containsKey(p.id)).toList();
    return Padding(
      padding: const EdgeInsetsDirectional.fromSTEB(12, 0, 12, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            const Icon(Icons.graphic_eq_rounded,
                color: Color(0xFFFFD54A), size: 18),
            const SizedBox(width: 7),
            const Expanded(
              child: Text('الأشخاص في الغرف',
                  style: TextStyle(color: Colors.white,
                      fontSize: 14, fontWeight: FontWeight.w800)),
            ),
            IconButton(
              key: const Key('messages-room-people-refresh'),
              tooltip: 'تحديث الأشخاص الموجودين في الغرف',
              icon: _loading
                  ? const SizedBox.square(
                      dimension: 18,
                      child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.refresh_rounded,
                      size: 19, color: Colors.white70),
              onPressed: _loading ? null : _load,
            ),
          ]),
          if (entries.isEmpty)
            Padding(
              padding: const EdgeInsetsDirectional.only(bottom: 6, start: 5),
              child: Text(
                _loading
                    ? 'جارٍ التحقق من الموجودين داخل الغرف...'
                    : _failed
                        ? 'تعذر تحميل الأشخاص. اضغط تحديث للمحاولة.'
                        : _expired
                            ? 'انتهى تحديث الحضور. اضغط تحديث.'
                            : 'لا يظهر حالياً أشخاص متاحون للتتبّع ضمن المقترحين.',
                style: const TextStyle(color: Colors.white54, fontSize: 11),
              ),
            )
          else
            SizedBox(
              height: 95,
              child: ListView.separated(
                key: const Key('messages-verified-room-people'),
                scrollDirection: Axis.horizontal,
                itemCount: entries.length,
                separatorBuilder: (_, __) => const SizedBox(width: 9),
                itemBuilder: (context, index) {
                  final person = entries[index];
                  return SizedBox(
                    width: 72,
                    child: InkWell(
                      key: Key('messages-room-person-${person.id}'),
                      onTap: () => _showActions(person),
                      borderRadius: BorderRadius.circular(12),
                      child: Column(children: [
                        Stack(clipBehavior: Clip.none, children: [
                          ProfileAvatarWithFrame(
                            diameter: 53,
                            userId: person.id,
                            fallbackProfile: person.data,
                            snapshotOnly: true,
                          ),
                          PositionedDirectional(
                            end: -3,
                            bottom: -2,
                            child: DecoratedBox(
                              decoration: BoxDecoration(
                                color: const Color(0xFF261747),
                                shape: BoxShape.circle,
                                border: Border.all(
                                  color: const Color(0xFFFFD54A)),
                              ),
                              child: const Padding(
                                padding: EdgeInsets.all(3),
                                child: Icon(Icons.graphic_eq_rounded,
                                  size: 13, color: Color(0xFFFFD54A)),
                              ),
                            ),
                          ),
                        ]),
                        const SizedBox(height: 5),
                        Text(person.displayName,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: Colors.white70, fontSize: 11)),
                      ]),
                    ),
                  );
                },
              ),
            ),
        ],
      ),
    );
  }
}
