import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../screens/room/room_list_screen.dart';
import '../../auth/bloc/auth_bloc.dart';
import '../../chat/screens/chat_list_screen.dart';
import '../../home/screens/home_screen.dart';
import '../../user/screens/profile_screen.dart';

class MainShellScreen extends StatefulWidget {
  const MainShellScreen({super.key});

  @override
  State<MainShellScreen> createState() => _MainShellScreenState();
}

class _MainShellScreenState extends State<MainShellScreen> {
  int _currentNavIndex = 0;

  final List<Widget> _pages = const [
    HomeScreen(),
    RoomListScreen(),
    _ComingSoonPage(
      title: 'الألعاب',
      icon: Icons.sports_esports_rounded,
    ),
    ChatListScreen(),
    ProfileScreen(),
  ];

  bool get _guest => FirebaseAuth.instance.currentUser?.isAnonymous == true;

  int _pageForNav(int navIndex) {
    switch (navIndex) {
      case 0:
        return 0;
      case 1:
      case 2:
        return 1;
      case 3:
        return 2;
      case 4:
        return 3;
      case 5:
        return 4;
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
    if (_guest && (navIndex == 3 || navIndex == 4)) {
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
        body: IndexedStack(
          index: _pageForNav(_currentNavIndex),
          children: _pages,
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
      label: 'صوت',
      icon: Icons.mic_none_rounded,
      activeIcon: Icons.mic_rounded,
      center: true,
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
      label: 'الملف',
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
                          index == 4 && unread > 0
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
