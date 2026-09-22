import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../../features/room/services/room_action_service.dart';
import '../../services/navigation_service.dart';

class CreateRoomScreen extends StatefulWidget {
  const CreateRoomScreen({super.key});

  @override
  State<CreateRoomScreen> createState() => _CreateRoomScreenState();
}

class _CreateRoomScreenState extends State<CreateRoomScreen> {
  final RoomActionService _roomActions = RoomActionService();
  bool _opening = false;

  Future<void> _openMyRoom() async {
    if (_opening) return;
    final user = FirebaseAuth.instance.currentUser;
    if (user == null || user.isAnonymous) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('إنشاء غرفة يحتاج حساباً مسجلاً.')),
      );
      return;
    }

    setState(() => _opening = true);
    try {
      final room = await _roomActions.openPersonalRoom();
      if (!mounted) return;
      NavigationService.navigateToReplacement(
        AppRoutes.voiceChatRoom,
        arguments: room.toNavigationArguments(),
      );
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تعذر فتح غرفتك حالياً.')),
      );
    } finally {
      if (mounted) setState(() => _opening = false);
    }
  }

  @override
  void dispose() {
    _roomActions.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: const Color(0xFF05060D),
        appBar: AppBar(
          backgroundColor: const Color(0xFF05060D),
          foregroundColor: Colors.white,
          title: const Text('غرفتي الصوتية'),
        ),
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              children: [
                const Spacer(),
                Container(
                  width: 92,
                  height: 92,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: const Color(0xFF8A3DFF).withValues(alpha: .14),
                    border: Border.all(
                      color: const Color(0xFF8A3DFF).withValues(alpha: .45),
                    ),
                  ),
                  child: const Icon(
                    Icons.graphic_eq_rounded,
                    color: Color(0xFFFFD54A),
                    size: 44,
                  ),
                ),
                const SizedBox(height: 22),
                const Text(
                  'غرفة واحدة دائمة مرتبطة بحسابك',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 22,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 10),
                const Text(
                  'أول مرة ننشئ الغرفة ونحفظ الـID الخاص بها. بعد ذلك تدخل نفس الغرفة دائماً بدون إنشاء نسخة جديدة.',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: Colors.white54,
                    height: 1.6,
                    fontSize: 12,
                  ),
                ),
                const SizedBox(height: 26),
                SizedBox(
                  width: double.infinity,
                  child: FilledButton.icon(
                    onPressed: _opening ? null : _openMyRoom,
                    style: FilledButton.styleFrom(
                      backgroundColor: const Color(0xFF6D27D9),
                      padding: const EdgeInsets.symmetric(vertical: 15),
                    ),
                    icon: _opening
                        ? const SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Colors.white,
                            ),
                          )
                        : const Icon(Icons.meeting_room_rounded),
                    label: Text(_opening ? 'جارٍ فتح الغرفة…' : 'فتح غرفتي'),
                  ),
                ),
                const SizedBox(height: 12),
                const Text(
                  'الاسم والوصف والتصنيف والوسوم والخصوصية تعدّلها من داخل الغرفة.',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: Colors.white38,
                    fontSize: 10,
                  ),
                ),
                const Spacer(),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
