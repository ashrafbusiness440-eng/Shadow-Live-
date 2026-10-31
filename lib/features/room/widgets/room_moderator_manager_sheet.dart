import 'dart:async';

import 'package:flutter/material.dart';

import '../services/room_moderator_service.dart';
import '../services/room_presence_service.dart';
import '../services/room_invite_service.dart';
import '../../profile/widgets/profile_avatar_with_frame.dart';

class RoomModeratorManagerSheet extends StatefulWidget {
  const RoomModeratorManagerSheet({
    super.key,
    required this.roomId,
    this.participants = const <RoomPresenceUser>[],
  });

  final String roomId;
  final List<RoomPresenceUser> participants;

  @override
  State<RoomModeratorManagerSheet> createState() =>
      _RoomModeratorManagerSheetState();
}

class _RoomModeratorManagerSheetState
    extends State<RoomModeratorManagerSheet> {
  final RoomModeratorService _service = RoomModeratorService();
  final RoomInviteService _friendsService = RoomInviteService();
  StreamSubscription<RoomModeratorState>? _subscription;
  RoomModeratorState? _state;
  bool _busy = false;

  static const _labels = <String, String>{
    'manageMic': 'إدارة المايك',
    'moderateUsers': 'الطرد والحظر',
    'moderateChat': 'إدارة الشات',
    'manageMusic': 'الموسيقى',
    'manageMusicPolicy': 'سياسة الموسيقى',
    'managePk': 'PK',
  };

  @override
  void initState() {
    super.initState();
    _subscription = _service.watch(widget.roomId).listen((state) {
      if (mounted) setState(() => _state = state);
    });
  }

  @override
  void dispose() {
    unawaited(_subscription?.cancel());
    _service.close();
    _friendsService.close();
    super.dispose();
  }

  String _errorMessage(Object error) {
    final code = error is StateError ? error.message.toString() : '';
    switch (code) {
      case 'moderator_limit_reached':
        return 'وصلت الغرفة للحد الأقصى من المشرفين.';
      case 'target_not_found':
        return 'لم يتم العثور على المستخدم.';
      case 'invalid_public_id':
        return 'أدخل معرّف مستخدم (ID) صالحًا.';
      case 'capabilities_required':
        return 'اختر صلاحية واحدة على الأقل.';
      case 'forbidden':
        return 'لا تملك صلاحية إدارة مشرفي الغرفة.';
      default:
        return 'تعذر تحديث مشرفي الغرفة حالياً.';
    }
  }

  Future<void> _editModerator([RoomModerator? existing]) async {
    if (_busy) return;
    final publicIdController = TextEditingController();
    String? pickedUid;
    String? pickedName;
    Future<void> chooseModerator({
      required bool fromFriends,
      required void Function(VoidCallback) setEditorState,
    }) async {
      try {
        if (fromFriends) {
          // Read friends only on explicit tap, never a room-wide listener.
          final friends = await _friendsService.loadFriends();
          if (!mounted) return;
          final selected = await showModalBottomSheet<RoomInviteFriend>(
            context: context,
            backgroundColor: const Color(0xFF111522),
            builder: (pickerContext) => Directionality(
              textDirection: TextDirection.rtl,
              child: SafeArea(
                child: ListView(
                  shrinkWrap: true,
                  children: [
                    const ListTile(title: Text('اختر من الأصدقاء',
                      style: TextStyle(color: Colors.white))),
                    if (friends.isEmpty)
                      const ListTile(title: Text('لا يوجد أصدقاء حاليًا',
                        style: TextStyle(color: Colors.white54))),
                    for (final friend in friends)
                      ListTile(
                        leading: ProfileAvatarWithFrame(
                          diameter: 36, userId: friend.uid,
                          fallbackProfile: <String, dynamic>{
                            'profileImageUrl': friend.photoUrl,
                          },
                        ),
                        title: Text(friend.name,
                          style: const TextStyle(color: Colors.white)),
                        onTap: () => Navigator.pop(pickerContext, friend),
                      ),
                  ],
                ),
              ),
            ),
          );
          if (selected != null && mounted) {
            setEditorState(() {
              pickedUid = selected.uid;
              pickedName = selected.name;
              publicIdController.clear();
            });
          }
        } else {
          final audience = widget.participants
              .where((person) => person.uid.isNotEmpty)
              .toList(growable: false);
          final selected = await showModalBottomSheet<RoomPresenceUser>(
            context: context,
            backgroundColor: const Color(0xFF111522),
            builder: (pickerContext) => Directionality(
              textDirection: TextDirection.rtl,
              child: SafeArea(
                child: ListView(
                  shrinkWrap: true,
                  children: [
                    const ListTile(title: Text('اختر من الحضور',
                      style: TextStyle(color: Colors.white))),
                    if (audience.isEmpty)
                      const ListTile(title: Text('لا يوجد حضور مؤكد حاليًا',
                        style: TextStyle(color: Colors.white54))),
                    for (final person in audience)
                      ListTile(
                        leading: ProfileAvatarWithFrame(
                          diameter: 36, userId: person.uid,
                          fallbackProfile: <String, dynamic>{
                            'profileImageUrl': person.profileImageUrl,
                          },
                        ),
                        title: Text(person.displayName,
                          style: const TextStyle(color: Colors.white)),
                        onTap: () => Navigator.pop(pickerContext, person),
                      ),
                  ],
                ),
              ),
            ),
          );
          if (selected != null && mounted) {
            setEditorState(() {
              pickedUid = selected.uid;
              pickedName = selected.displayName;
              publicIdController.clear();
            });
          }
        }
      } catch (_) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('تعذر تحميل القائمة حاليًا.')),
          );
        }
      }
    }
    final caps = existing?.capabilities.toSet() ??
        <String>{'manageMic', 'moderateChat'};

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF111522),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (sheetContext) => Directionality(
        textDirection: TextDirection.rtl,
        child: StatefulBuilder(
          builder: (context, setSheetState) => SafeArea(
            child: Padding(
              padding: EdgeInsets.fromLTRB(
                16,
                14,
                16,
                MediaQuery.viewInsetsOf(context).bottom + 18,
              ),
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
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
                    Text(
                      existing == null
                          ? 'إضافة مشرف للغرفة'
                          : 'صلاحيات ' + existing.displayName,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 19,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    if (existing == null) ...[
                      const SizedBox(height: 14),
                      Row(
                        children: [
                          Expanded(
                            child: TextField(
                              controller: publicIdController,
                              keyboardType: TextInputType.number,
                              onChanged: (_) {
                                if (pickedUid != null) {
                                  setSheetState(() {
                                    pickedUid = null;
                                    pickedName = null;
                                  });
                                }
                              },
                              style: const TextStyle(color: Colors.white),
                              decoration: const InputDecoration(
                                labelText: 'معرّف المستخدم (ID)',
                                labelStyle: TextStyle(color: Colors.white60),
                                prefixIcon: Icon(Icons.badge_rounded,
                                  color: Color(0xFFFFD54A)),
                              ),
                            ),
                          ),
                          IconButton(
                            tooltip: 'من الأصدقاء',
                            icon: const Icon(Icons.people_rounded,
                                color: Color(0xFFFFD54A)),
                            onPressed: _busy ? null : () => chooseModerator(
                              fromFriends: true,
                              setEditorState: setSheetState,
                            ),
                          ),
                          IconButton(
                            tooltip: 'من الحضور',
                            icon: const Icon(Icons.groups_rounded,
                                color: Color(0xFFBFA5FF)),
                            onPressed: _busy ? null : () => chooseModerator(
                              fromFriends: false,
                              setEditorState: setSheetState,
                            ),
                          ),
                        ],
                      ),
                      if (pickedName != null)
                        Align(
                          alignment: Alignment.centerRight,
                          child: Text('المحدد: $pickedName',
                            style: const TextStyle(
                              color: Color(0xFFBFA5FF), fontSize: 11)),
                        ),
                    ],
                    const SizedBox(height: 8),
                    ..._labels.entries.map(
                      (entry) => CheckboxListTile(
                        contentPadding: EdgeInsets.zero,
                        value: caps.contains(entry.key),
                        activeColor: const Color(0xFF6D27D9),
                        checkColor: Colors.white,
                        title: Text(
                          entry.value,
                          style: const TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        onChanged: _busy
                            ? null
                            : (value) {
                                setSheetState(() {
                                  if (value == true) {
                                    caps.add(entry.key);
                                  } else {
                                    caps.remove(entry.key);
                                  }
                                });
                              },
                      ),
                    ),
                    const SizedBox(height: 10),
                    SizedBox(
                      width: double.infinity,
                      child: FilledButton.icon(
                        onPressed: _busy
                            ? null
                            : () async {
                                final publicId =
                                    publicIdController.text.trim();
                                if (existing == null &&
                                    pickedUid == null && publicId.isEmpty) {
                                  ScaffoldMessenger.of(sheetContext)
                                      .showSnackBar(
                                    const SnackBar(
                                      content: Text(
                                        'أدخل معرّف المستخدم (ID).',
                                      ),
                                    ),
                                  );
                                  return;
                                }
                                if (caps.isEmpty) {
                                  ScaffoldMessenger.of(sheetContext)
                                      .showSnackBar(
                                    const SnackBar(
                                      content: Text(
                                        'اختر صلاحية واحدة على الأقل.',
                                      ),
                                    ),
                                  );
                                  return;
                                }

                                setState(() => _busy = true);
                                setSheetState(() {});
                                try {
                                  await _service.setModerator(
                                    roomId: widget.roomId,
                                    targetUid: existing?.uid ?? pickedUid,
                                    targetPublicId: existing == null &&
                                            pickedUid == null
                                        ? publicId : null,
                                    enabled: true,
                                    capabilities: caps,
                                  );
                                  if (sheetContext.mounted) {
                                    Navigator.pop(sheetContext);
                                  }
                                } catch (error) {
                                  if (sheetContext.mounted) {
                                    ScaffoldMessenger.of(sheetContext)
                                        .showSnackBar(
                                      SnackBar(
                                        content: Text(
                                          _errorMessage(error),
                                        ),
                                      ),
                                    );
                                  }
                                } finally {
                                  if (mounted) setState(() => _busy = false);
                                }
                              },
                        style: FilledButton.styleFrom(
                          backgroundColor: const Color(0xFF6D27D9),
                          padding: const EdgeInsets.symmetric(vertical: 13),
                        ),
                        icon: _busy
                            ? const SizedBox(
                                width: 17,
                                height: 17,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  color: Colors.white,
                                ),
                              )
                            : const Icon(Icons.save_rounded),
                        label: Text(
                          existing == null
                              ? 'إضافة المشرف'
                              : 'حفظ الصلاحيات',
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );

    publicIdController.dispose();
  }

  Future<void> _remove(RoomModerator moderator) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await _service.setModerator(
        roomId: widget.roomId,
        targetUid: moderator.uid,
        enabled: false,
      );
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(_errorMessage(error))),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = _state;
    final moderators = state?.moderators ?? const <RoomModerator>[];

    return Directionality(
      textDirection: TextDirection.rtl,
      child: SafeArea(
        child: SizedBox(
          height: MediaQuery.sizeOf(context).height * .76,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 18),
            child: Column(
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
                      Icons.admin_panel_settings_rounded,
                      color: Color(0xFFFFD54A),
                    ),
                    const SizedBox(width: 8),
                    const Expanded(
                      child: Text(
                        'مشرفو الغرفة',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 20,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ),
                    if (state != null)
                      Text(
                        moderators.length.toString() +
                            '/' +
                            state.limit.toString(),
                        style: const TextStyle(
                          color: Colors.white54,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 12),
                SizedBox(
                  width: double.infinity,
                  child: OutlinedButton.icon(
                    onPressed: state?.isOwner == true && !_busy
                        ? () => _editModerator()
                        : null,
                    icon: const Icon(Icons.person_add_alt_1_rounded),
                    label: const Text('إضافة مشرف بالـID'),
                  ),
                ),
                const SizedBox(height: 10),
                Expanded(
                  child: state == null
                      ? const Center(
                          child: CircularProgressIndicator(
                            color: Color(0xFF8A3DFF),
                          ),
                        )
                      : moderators.isEmpty
                          ? const Center(
                              child: Text(
                                'لا يوجد مشرفون لهذه الغرفة بعد',
                                style: TextStyle(color: Colors.white54),
                              ),
                            )
                          : ListView.separated(
                              itemCount: moderators.length,
                              separatorBuilder: (_, __) =>
                                  const Divider(color: Colors.white10),
                              itemBuilder: (_, index) {
                                final moderator = moderators[index];
                                final labels = moderator.capabilities
                                    .map((cap) => _labels[cap] ?? cap)
                                    .join(' • ');
                                return ListTile(
                                  contentPadding: EdgeInsets.zero,
                                  leading: ProfileAvatarWithFrame(
                                    diameter: 40,
                                    userId: moderator.uid,
                                    backgroundColor:
                                        const Color(0xFF25183F),
                                    placeholderColor:
                                        const Color(0xFFFFD54A),
                                    placeholderIcon:
                                        Icons.shield_rounded,
                                    fallbackProfile: <String, dynamic>{
                                      'profileImageUrl':
                                          moderator.profileImageUrl,
                                      'profileAvatarAsset':
                                          moderator.profileAvatarAsset,
                                      'activeProfileFrameAssetKey':
                                          moderator.activeProfileFrameAssetKey,
                                      'activeProfileFrameImageUrl':
                                          moderator.activeProfileFrameImageUrl,
                                      'activeProfileFrameExpiresAtMs':
                                          moderator.activeProfileFrameExpiresAtMs,
                                      'activeProfileFramePermanent':
                                          moderator.activeProfileFramePermanent,
                                    },
                                    fallbackIsVisualSnapshot: true,
                                  ),
                                  title: Text(
                                    moderator.displayName,
                                    style: const TextStyle(
                                      color: Colors.white,
                                      fontWeight: FontWeight.w800,
                                    ),
                                  ),
                                  subtitle: Text(
                                    labels.isEmpty ? 'بدون صلاحيات' : labels,
                                    maxLines: 2,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                      color: Colors.white54,
                                      fontSize: 10,
                                    ),
                                  ),
                                  onTap: state.isOwner && !_busy
                                      ? () => _editModerator(moderator)
                                      : null,
                                  trailing: state.isOwner
                                      ? IconButton(
                                          onPressed: _busy
                                              ? null
                                              : () => _remove(moderator),
                                          icon: const Icon(
                                            Icons.person_remove_rounded,
                                            color: Colors.redAccent,
                                          ),
                                          tooltip: 'إزالة المشرف',
                                        )
                                      : null,
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
