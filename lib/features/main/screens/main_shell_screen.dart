import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../screens/room/room_list_screen.dart';
import '../../auth/bloc/auth_bloc.dart';
import '../../chat/screens/chat_list_screen.dart';
import '../../home/screens/home_screen.dart';
import '../../games/screens/games_hub_screen.dart';
import '../../room/services/room_seat_service.dart';
import '../../user/screens/profile_screen.dart';
import '../../voice/services/voice_room_session_controller.dart';
import '../../../services/navigation_service.dart';

class MainShellScreen extends StatefulWidget {
  const MainShellScreen({super.key, this.initialNavIndex = 0});

  final int initialNavIndex;

  @override
  State<MainShellScreen> createState() => _MainShellScreenState();
}

class _MainShellScreenState extends State<MainShellScreen> {
  late int _currentNavIndex;
  final VoiceRoomSessionController _voiceSession =
      VoiceRoomSessionController.instance;
  final RoomSeatService _miniRoomSeatService = RoomSeatService();
  double _miniRoomRight = 14;
  double _miniRoomBottom = 14;

  @override
  void initState() {
    super.initState();
    _currentNavIndex = widget.initialNavIndex;
    _voiceSession.addListener(_syncVoiceRoomSession);
  }

  @override
  void dispose() {
    _voiceSession.removeListener(_syncVoiceRoomSession);
    _miniRoomSeatService.close();
    super.dispose();
  }

  void _syncVoiceRoomSession() {
    if (mounted) setState(() {});
  }

  String get _miniRoomImageUrl {
    final room = _voiceSession.roomArguments;
    for (final key in const [
      'agencyRoomImageUrl',
      'roomImageUrl',
      'roomPhotoUrl',
      'imageUrl',
      'coverImageUrl',
    ]) {
      final value = (room[key] ?? '').toString().trim();
      if (value.isNotEmpty) return value;
    }
    return '';
  }

  void _restoreMiniRoom() {
    if (!_voiceSession.active) return;
    final arguments =
        Map<String, dynamic>.from(_voiceSession.roomArguments);
    _voiceSession.restore();
    Navigator.of(context).pushNamed(
      AppRoutes.voiceChatRoom,
      arguments: arguments,
    );
  }

  Future<void> _leaveMiniRoom() async {
    final roomId = _voiceSession.roomId.trim();
    if (roomId.isNotEmpty) {
      try {
        await _miniRoomSeatService.leaveSeat(roomId);
      } catch (_) {
        // Voice/presence leave still proceeds if the seat cleanup is already done.
      }
    }
    await _voiceSession.leave();
  }

  Widget _buildMiniRoom({
    required double maxWidth,
    required double maxHeight,
  }) {
    if (!_voiceSession.active || !_voiceSession.minimized) {
      return const SizedBox.shrink();
    }

    const cardSize = 72.0;
    final maxRight = maxWidth > cardSize ? maxWidth - cardSize : 0.0;
    final maxBottom = maxHeight > cardSize ? maxHeight - cardSize : 0.0;
    final right = _miniRoomRight.clamp(0.0, maxRight).toDouble();
    final bottom = _miniRoomBottom.clamp(0.0, maxBottom).toDouble();
    final imageUrl = _miniRoomImageUrl;

    return Positioned(
      right: right,
      bottom: bottom,
      child: GestureDetector(
        key: const Key('mini-room-card'),
        behavior: HitTestBehavior.opaque,
        onTap: _restoreMiniRoom,
        onPanUpdate: (details) {
          setState(() {
            _miniRoomRight =
                (right - details.delta.dx).clamp(0.0, maxRight).toDouble();
            _miniRoomBottom =
                (bottom - details.delta.dy).clamp(0.0, maxBottom).toDouble();
          });
        },
        child: SizedBox(
          width: cardSize,
          height: cardSize,
          child: Stack(
            clipBehavior: Clip.none,
            children: [
              Positioned.fill(
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(14),
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      color: const Color(0xFF171D2B),
                      border: Border.all(
                        color: Colors.white.withValues(alpha: .18),
                      ),
                      image: imageUrl.isEmpty
                          ? null
                          : DecorationImage(
                              image: NetworkImage(imageUrl),
                              fit: BoxFit.cover,
                            ),
                    ),
                    child: imageUrl.isEmpty
                        ? const Center(
                            child: Icon(
                              Icons.groups_rounded,
                              color: Colors.white70,
                              size: 30,
                            ),
                          )
                        : null,
                  ),
                ),
              ),
              Positioned(
                top: -6,
                right: -6,
                child: Material(
                  color: Colors.black.withValues(alpha: .88),
                  shape: const CircleBorder(),
                  child: InkWell(
                    key: const Key('mini-room-close'),
                    customBorder: const CircleBorder(),
                    onTap: _leaveMiniRoom,
                    child: const SizedBox(
                      width: 24,
                      height: 24,
                      child: Icon(
                        Icons.close_rounded,
                        size: 16,
                        color: Colors.white,
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  final List<Widget> _pages = const [
    HomeScreen(),
    RoomListScreen(),
    GamesHubScreen(),
    ChatListScreen(),
    _ComingSoonPage(
      title: 'يومياتي',
      icon: Icons.auto_stories_rounded,
    ),
    ProfileScreen(),
  ];

  bool get _guest =>
      !const bool.fromEnvironment('E2E_TEST') &&
      FirebaseAuth.instance.currentUser?.isAnonymous == true;

  int _pageForNav(int navIndex) {
    switch (navIndex) {
      case 0:
        return 0;
      case 1:
        return 1;
      case 2:
        return 2;
      case 3:
        return 3;
      case 4:
        return 4;
      case 5:
        return 5;
      default:
        return 0;
    }
  }

  Future<void> _guestGuard() async {
    final create = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => Directionality(
        textDirection: TextDirection.rtl,
        child: AlertDialog(
          backgroundColor: const Color(0xFF101522),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(22),
            side: BorderSide(
              color: const Color(0xFF8A3DFF).withValues(alpha: .45),
            ),
          ),
          title: const Row(
            children: [
              Icon(
                Icons.lock_person_rounded,
                color: Color(0xFFFFD54A),
              ),
              SizedBox(width: 10),
              Expanded(
                child: Text(
                  'هذه الميزة تحتاج حساباً',
                  style: TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
            ],
          ),
          content: const Text(
            'يمكنك كضيف تصفح Shadow Live والغرف والإعدادات، لكن المراسلة والألعاب والتفاعل مع المستخدمين تتطلب حساباً حقيقياً.',
            style: TextStyle(
              color: Colors.white70,
              height: 1.6,
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text(
                'إلغاء',
                style: TextStyle(color: Colors.white70),
              ),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(dialogContext, true),
              style: FilledButton.styleFrom(
                backgroundColor: const Color(0xFF7B2DFF),
              ),
              child: const Text('متابعة لإنشاء حساب'),
            ),
          ],
        ),
      ),
    );

    if (create == true && mounted) {
      final authBloc = context.read<AuthBloc>();
      final result = authBloc.stream
          .firstWhere(
            (state) => state is Unauthenticated || state is AuthError,
          )
          .timeout(const Duration(seconds: 12));

      authBloc.add(SignOutRequested());

      try {
        final state = await result;
        if (!mounted) return;
        if (state is Unauthenticated) {
          Navigator.of(context).pushNamedAndRemoveUntil(
            '/auth-choice',
            (route) => false,
          );
        } else if (state is AuthError) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(state.message)),
          );
        }
      } on TimeoutException {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('تعذر تسجيل الخروج الآن. حاول مرة أخرى.'),
            ),
          );
        }
      }
    }
  }

  void _changePage(int navIndex) {
    if (_guest && (navIndex == 2 || navIndex == 3 || navIndex == 4)) {
      _guestGuard();
      return;
    }

    setState(() => _currentNavIndex = navIndex);
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: const Color(0xFF05060D),
        body: LayoutBuilder(
          builder: (context, constraints) => Stack(
            fit: StackFit.expand,
            children: [
              Positioned.fill(
                child: IndexedStack(
                  index: _pageForNav(_currentNavIndex),
                  children: _pages,
                ),
              ),
              _buildMiniRoom(
                maxWidth: constraints.maxWidth,
                maxHeight: constraints.maxHeight,
              ),
            ],
          ),
        ),
        bottomNavigationBar: _ShadowBottomNavigation(
          currentIndex: _currentNavIndex,
          onChanged: _changePage,
        ),
      ),
    );
  }
}

class _ShadowBottomNavigation extends StatelessWidget {
  const _ShadowBottomNavigation({
    required this.currentIndex,
    required this.onChanged,
  });

  final int currentIndex;
  final ValueChanged<int> onChanged;

  static const _items = <
      ({String label, IconData icon, IconData activeIcon, bool center})>[
    (
      label: 'الرئيسية',
      icon: Icons.home_outlined,
      activeIcon: Icons.home_rounded,
      center: false,
    ),
    (
      label: 'الغرف',
      icon: Icons.groups_outlined,
      activeIcon: Icons.groups_rounded,
      center: false,
    ),
    (
      label: 'الألعاب',
      icon: Icons.sports_esports_outlined,
      activeIcon: Icons.sports_esports_rounded,
      center: false,
    ),
    (
      label: 'الرسائل',
      icon: Icons.chat_bubble_outline,
      activeIcon: Icons.chat_bubble_rounded,
      center: false,
    ),
    (
      label: 'يومياتي',
      icon: Icons.auto_stories_outlined,
      activeIcon: Icons.auto_stories_rounded,
      center: false,
    ),
    (
      label: 'الملف الشخصي',
      icon: Icons.person_outline_rounded,
      activeIcon: Icons.person_rounded,
      center: false,
    ),
  ];

  @override
  Widget build(BuildContext context) {
    final uid = FirebaseAuth.instance.currentUser?.uid;

    return StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
      stream: uid == null
          ? null
          : FirebaseFirestore.instance
              .collection('conversations')
              .where('participants', arrayContains: uid)
              .snapshots(),
      builder: (context, snapshot) {
        var unread = 0;
        if (uid != null && snapshot.hasData) {
          for (final document in snapshot.data!.docs) {
            unread +=
                ((document.data()['unreadCounts'] as Map?)?[uid] as num?)
                        ?.toInt() ??
                    0;
          }
        }

        return SafeArea(
          top: false,
          child: Container(
            height: 80,
            decoration: BoxDecoration(
              color: const Color(0xFF090A11),
              border: Border(
                top: BorderSide(
                  color: Colors.white.withValues(alpha: .09),
                ),
              ),
              boxShadow: const [
                BoxShadow(
                  color: Colors.black54,
                  blurRadius: 18,
                  offset: Offset(0, -4),
                ),
              ],
            ),
            child: Row(
              children: List.generate(_items.length, (index) {
                final item = _items[index];
                final selected = currentIndex == index;

                if (item.center) {
                  return Expanded(
                    child: InkWell(
                      onTap: () => onChanged(index),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          AnimatedContainer(
                            duration: const Duration(milliseconds: 180),
                            width: 50,
                            height: 50,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              gradient: LinearGradient(
                                colors: selected
                                    ? const [
                                        Color(0xFFFFC84A),
                                        Color(0xFF8A3DFF),
                                      ]
                                    : const [
                                        Color(0xFF8A3DFF),
                                        Color(0xFF5D21C7),
                                      ],
                              ),
                              boxShadow: [
                                BoxShadow(
                                  color: const Color(0xFF8A3DFF)
                                      .withValues(alpha: .35),
                                  blurRadius: 14,
                                  spreadRadius: 1,
                                ),
                              ],
                            ),
                            child: Icon(
                              selected ? item.activeIcon : item.icon,
                              color: Colors.white,
                              size: 27,
                            ),
                          ),
                        ],
                      ),
                    ),
                  );
                }

                final icon = Icon(
                  selected ? item.activeIcon : item.icon,
                  size: 23,
                  color: selected
                      ? const Color(0xFFFFC84A)
                      : Colors.white60,
                );

                return Expanded(
                  child: InkWell(
                    onTap: () => onChanged(index),
                    child: AnimatedContainer(
                      duration: const Duration(milliseconds: 180),
                      margin: const EdgeInsets.symmetric(
                        horizontal: 2,
                        vertical: 7,
                      ),
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(16),
                        gradient: selected
                            ? LinearGradient(
                                begin: Alignment.topCenter,
                                end: Alignment.bottomCenter,
                                colors: [
                                  const Color(0xFFFFC84A)
                                      .withValues(alpha: .18),
                                  const Color(0xFFFFC84A)
                                      .withValues(alpha: .03),
                                ],
                              )
                            : null,
                      ),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          index == 3 && unread > 0
                              ? Badge(
                                  label: Text(
                                    unread > 99 ? '99+' : '$unread',
                                  ),
                                  child: icon,
                                )
                              : icon,
                          const SizedBox(height: 4),
                          FittedBox(
                            fit: BoxFit.scaleDown,
                            child: Text(
                              item.label,
                              maxLines: 1,
                              style: TextStyle(
                                color: selected
                                    ? const Color(0xFFFFC84A)
                                    : Colors.white60,
                                fontSize: 10,
                                fontWeight: selected
                                    ? FontWeight.w800
                                    : FontWeight.w500,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                );
              }),
            ),
          ),
        );
      },
    );
  }
}

class _ComingSoonPage extends StatelessWidget {
  const _ComingSoonPage({
    required this.title,
    required this.icon,
  });

  final String title;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF05060D),
      body: SafeArea(
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 76,
                height: 76,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: const Color(0xFF8A3DFF).withValues(alpha: .14),
                  border: Border.all(
                    color: const Color(0xFF8A3DFF).withValues(alpha: .35),
                  ),
                ),
                child: Icon(
                  icon,
                  color: const Color(0xFFFFD54A),
                  size: 38,
                ),
              ),
              const SizedBox(height: 18),
              Text(
                title,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 24,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 8),
              const Text(
                'سيتم تفعيل هذا القسم عند بدء مرحلته',
                style: TextStyle(
                  color: Colors.white54,
                  fontSize: 13,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
