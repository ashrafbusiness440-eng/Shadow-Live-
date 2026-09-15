import 'package:flutter/material.dart';

import '../../../screens/room/room_list_screen.dart';
import '../../home/screens/home_screen.dart';
import '../../user/screens/profile_screen.dart';

class MainShellScreen extends StatefulWidget {
  const MainShellScreen({super.key});

  @override
  State<MainShellScreen> createState() => _MainShellScreenState();
}

class _MainShellScreenState extends State<MainShellScreen> {
  int _currentIndex = 0;

  final List<Widget> _pages = const [
    HomeScreen(),
    _ComingSoonPage(title: 'الألعاب', icon: Icons.sports_esports_rounded),
    RoomListScreen(),
    _ComingSoonPage(title: 'الرسائل', icon: Icons.chat_bubble_rounded),
    _ComingSoonPage(title: 'المنشورات', icon: Icons.article_rounded),
    ProfileScreen(),
  ];

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: const Color(0xFF05060D),
        body: IndexedStack(index: _currentIndex, children: _pages),
        bottomNavigationBar: _ShadowBottomNavigation(
          currentIndex: _currentIndex,
          onChanged: (index) => setState(() => _currentIndex = index),
        ),
      ),
    );
  }
}

class _ShadowBottomNavigation extends StatelessWidget {
  final int currentIndex;
  final ValueChanged<int> onChanged;

  const _ShadowBottomNavigation({
    required this.currentIndex,
    required this.onChanged,
  });

  static const _items = <({String label, IconData icon, IconData activeIcon})>[
    (
      label: 'الرئيسية',
      icon: Icons.home_outlined,
      activeIcon: Icons.home_rounded
    ),
    (
      label: 'الألعاب',
      icon: Icons.sports_esports_outlined,
      activeIcon: Icons.sports_esports_rounded
    ),
    (
      label: 'الغرف',
      icon: Icons.groups_outlined,
      activeIcon: Icons.groups_rounded
    ),
    (
      label: 'الرسائل',
      icon: Icons.chat_bubble_outline,
      activeIcon: Icons.chat_bubble_rounded
    ),
    (
      label: 'المنشورات',
      icon: Icons.article_outlined,
      activeIcon: Icons.article_rounded
    ),
    (
      label: 'الملف الشخصي',
      icon: Icons.person_outline_rounded,
      activeIcon: Icons.person_rounded
    ),
  ];

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      child: Container(
        height: 76,
        decoration: BoxDecoration(
          color: const Color(0xFF090A11),
          border: Border(
              top: BorderSide(color: Colors.white.withValues(alpha: .09))),
          boxShadow: const [
            BoxShadow(
                color: Colors.black54, blurRadius: 18, offset: Offset(0, -4)),
          ],
        ),
        child: Row(
          children: List.generate(_items.length, (index) {
            final item = _items[index];
            final selected = currentIndex == index;
            return Expanded(
              child: InkWell(
                onTap: () => onChanged(index),
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 180),
                  margin:
                      const EdgeInsets.symmetric(horizontal: 2, vertical: 7),
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(16),
                    gradient: selected
                        ? LinearGradient(
                            begin: Alignment.topCenter,
                            end: Alignment.bottomCenter,
                            colors: [
                              const Color(0xFFFFC84A).withValues(alpha: .18),
                              const Color(0xFFFFC84A).withValues(alpha: .03),
                            ],
                          )
                        : null,
                  ),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(
                        selected ? item.activeIcon : item.icon,
                        size: 23,
                        color:
                            selected ? const Color(0xFFFFC84A) : Colors.white60,
                      ),
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
                            fontWeight:
                                selected ? FontWeight.w800 : FontWeight.w500,
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
  }
}

class _ComingSoonPage extends StatelessWidget {
  final String title;
  final IconData icon;

  const _ComingSoonPage({required this.title, required this.icon});

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
                      color: const Color(0xFF8A3DFF).withValues(alpha: .35)),
                ),
                child: Icon(icon, color: const Color(0xFFFFD54A), size: 38),
              ),
              const SizedBox(height: 18),
              Text(
                title,
                style: const TextStyle(
                    color: Colors.white,
                    fontSize: 24,
                    fontWeight: FontWeight.w900),
              ),
              const SizedBox(height: 8),
              const Text(
                'سيتم تفعيل هذا القسم عند بدء مرحلته',
                style: TextStyle(color: Colors.white54, fontSize: 13),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
