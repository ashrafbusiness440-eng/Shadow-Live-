import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../../../services/navigation_service.dart';
import '../widgets/discovery_room_password_dialog.dart';
import 'room_realtime_query_service.dart';

/// Shared navigation gate for chat, home suggestions and profile visitors.
/// A room locator is NEVER an access token: revalidate a live socket first,
/// then keep using the normal voice-room admission/password path.
class RoomFollowNavigation {
  static Future<String?> open({
    required BuildContext context,
    required String targetUid,
    required RoomRealtimeQueryService query,
  }) async {
    final viewerUid = FirebaseAuth.instance.currentUser?.uid;
    if (viewerUid == null || viewerUid.isEmpty || targetUid.isEmpty) {
      return 'سجّل الدخول أولاً للمتابعة إلى الغرفة.';
    }

    bool current() =>
        context.mounted && FirebaseAuth.instance.currentUser?.uid == viewerUid;
    if (!current()) return 'تعذر التتبّع حالياً.';

    final first = await query.resolveRoomFollows(<String>[targetUid]);
    if (!current()) return 'تعذر التتبّع حالياً.';
    final found = first[targetUid];
    if (found == null) return 'الشخص لم يعد في غرفة يمكن التتبّع إليها.';

    final snapshot = await FirebaseFirestore.instance
        .collection('rooms')
        .doc(found.roomId)
        .get();
    if (!current()) return 'تعذر التتبّع حالياً.';
    final room = snapshot.data();
    if (!snapshot.exists || room == null ||
        room['isActive'] == false || room['isHidden'] == true ||
        room['visibility'] == 'hidden' ||
        room['visibility'] == 'private') {
      return 'هذه الغرفة لم تعد متاحة.';
    }

    final roomArgs = <String, dynamic>{
      ...room,
      'roomId': found.roomId,
    };
    final ownerUid = (room['ownerUid'] ??
            room['ownerId'] ?? room['hostId'] ?? '').toString();
    final passwordNeeded = found.requiresPassword ||
        room['visibility'] == 'password' ||
        room['passwordProtected'] == true;
    if (passwordNeeded && ownerUid != viewerUid) {
      final password = await showDiscoveryRoomPasswordPrompt(
        context, found.roomName,
      );
      if (!current() || password == null) return null;
      roomArgs['roomPassword'] = password;
    }

    // Re-check after potentially slow UI interaction. The server verifies
    // actual Room DO presence, room access and both block directions again.
    final after = await query.resolveRoomFollows(<String>[targetUid]);
    if (!current()) return 'تعذر التتبّع حالياً.';
    if (after[targetUid]?.roomId != found.roomId) {
      return 'الشخص غادر الغرفة أو تغيرت صلاحية الدخول.';
    }
    NavigationService.navigateTo(
      AppRoutes.voiceChatRoom, arguments: roomArgs,
    );
    return null;
  }
}
