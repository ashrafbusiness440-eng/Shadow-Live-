import 'package:flutter/material.dart';

import '../../../services/navigation_service.dart';
import '../services/voice_room_session_controller.dart';

class MiniVoiceRoomOverlay extends StatefulWidget {
  const MiniVoiceRoomOverlay({super.key});

  @override
  State<MiniVoiceRoomOverlay> createState() => _MiniVoiceRoomOverlayState();
}

class _MiniVoiceRoomOverlayState extends State<MiniVoiceRoomOverlay> {
  Offset? _position;

  Offset _safePosition(Size size, Offset value) {
    const width = 104.0;
    const height = 104.0;
    final maxX = (size.width - width - 8).clamp(8.0, double.infinity);
    final maxY = (size.height - height - 92).clamp(8.0, double.infinity);
    return Offset(
      value.dx.clamp(8.0, maxX),
      value.dy.clamp(8.0, maxY),
    );
  }

  void _restore(VoiceRoomSessionController controller) {
    controller.restore();
    NavigationService.navigateTo(
      AppRoutes.voiceChatRoom,
      arguments: controller.roomArguments,
    );
  }

  @override
  Widget build(BuildContext context) {
    final controller = VoiceRoomSessionController.instance;
    return AnimatedBuilder(
      animation: controller,
      builder: (context, _) {
        if (!controller.active || !controller.minimized) {
          return const SizedBox.shrink();
        }

        final size = MediaQuery.sizeOf(context);
        _position ??= Offset(size.width - 112, 110);
        final position = _safePosition(size, _position!);

        return Positioned(
          left: position.dx,
          top: position.dy,
          child: GestureDetector(
            onPanUpdate: (details) {
              setState(() {
                _position = _safePosition(
                  size,
                  position + details.delta,
                );
              });
            },
            onTap: () => _restore(controller),
            child: Material(
              color: Colors.transparent,
              child: Container(
                width: 104,
                height: 104,
                decoration: BoxDecoration(
                  color: const Color(0xFF111522),
                  borderRadius: BorderRadius.circular(24),
                  border: Border.all(
                    color: const Color(0xFF8A3DFF).withValues(alpha: .75),
                    width: 1.5,
                  ),
                  boxShadow: [
                    BoxShadow(
                      color: const Color(0xFF8A3DFF).withValues(alpha: .28),
                      blurRadius: 18,
                      spreadRadius: 1,
                    ),
                  ],
                ),
                child: Stack(
                  children: [
                    Positioned(
                      right: 8,
                      top: 8,
                      child: Container(
                        width: 9,
                        height: 9,
                        decoration: const BoxDecoration(
                          color: Color(0xFF39D98A),
                          shape: BoxShape.circle,
                        ),
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(10, 13, 10, 8),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          const Icon(
                            Icons.graphic_eq_rounded,
                            color: Color(0xFFFFD54A),
                            size: 30,
                          ),
                          const SizedBox(height: 4),
                          Text(
                            controller.roomTitle,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            textAlign: TextAlign.center,
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 11,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                          const SizedBox(height: 5),
                          Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              InkWell(
                                onTap: controller.connectionState.name ==
                                        'connected'
                                    ? controller.toggleMic
                                    : null,
                                borderRadius: BorderRadius.circular(20),
                                child: Padding(
                                  padding: const EdgeInsets.all(5),
                                  child: Icon(
                                    controller.micMuted
                                        ? Icons.mic_off_rounded
                                        : Icons.mic_rounded,
                                    size: 18,
                                    color: controller.micMuted
                                        ? Colors.white60
                                        : const Color(0xFF39D98A),
                                  ),
                                ),
                              ),
                              const SizedBox(width: 8),
                              InkWell(
                                onTap: controller.leave,
                                borderRadius: BorderRadius.circular(20),
                                child: const Padding(
                                  padding: EdgeInsets.all(5),
                                  child: Icon(
                                    Icons.close_rounded,
                                    size: 18,
                                    color: Colors.redAccent,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}
