import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../../../services/navigation_service.dart';
import '../../room/services/room_action_service.dart';
import '../../voice/services/voice_room_session_controller.dart';

class GameRoomLauncher {
  static Future<void> open(
    BuildContext context, {
    required String gameKey,
  }) async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null || user.isAnonymous) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('الألعاب تحتاج حساباً مسجلاً.')),
      );
      return;
    }

    final session = VoiceRoomSessionController.instance;
    if (session.active && session.roomId.isNotEmpty) {
      session.restore();
      await NavigationService.navigateTo(
        AppRoutes.voiceChatRoom,
        arguments: {
          ...session.roomArguments,
          'initialGameKey': gameKey,
        },
      );
      return;
    }

    final actions = RoomActionService();
    try {
      final room = await actions.openPersonalRoom();
      await NavigationService.navigateTo(
        AppRoutes.voiceChatRoom,
        arguments: {
          ...room.toNavigationArguments(),
          'initialGameKey': gameKey,
        },
      );
    } on StateError catch (error) {
      if (!context.mounted) return;
      final message = error.message == 'account_required'
          ? 'الألعاب تحتاج حساباً مسجلاً.'
          : 'تعذر فتح غرفتك حالياً.';
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(message)),
      );
    } catch (_) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تعذر فتح غرفتك حالياً.')),
      );
    } finally {
      actions.close();
    }
  }
}
