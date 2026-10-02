import 'package:flutter/material.dart';
import '../services/navigation_service.dart';

class BottomNavBar extends StatelessWidget {
  final int currentIndex;

  const BottomNavBar({super.key, required this.currentIndex});

  static const items = <BottomNavigationBarItem>[
    BottomNavigationBarItem(
      icon: Icon(Icons.home_outlined),
      activeIcon: Icon(Icons.home_rounded),
      label: 'الرئيسية',
    ),
    BottomNavigationBarItem(
      icon: Icon(Icons.groups_outlined),
      activeIcon: Icon(Icons.groups_rounded),
      label: 'الغرف',
    ),
    BottomNavigationBarItem(
      icon: Icon(Icons.sports_esports_outlined),
      activeIcon: Icon(Icons.sports_esports_rounded),
      label: 'الألعاب',
    ),
    BottomNavigationBarItem(
      icon: Icon(Icons.chat_bubble_outline_rounded),
      activeIcon: Icon(Icons.chat_bubble_rounded),
      label: 'الرسائل',
    ),
    BottomNavigationBarItem(
      icon: Icon(Icons.auto_stories_outlined),
      activeIcon: Icon(Icons.auto_stories_rounded),
      label: 'يومياتي',
    ),
    BottomNavigationBarItem(
      icon: Icon(Icons.person_outline_rounded),
      activeIcon: Icon(Icons.person_rounded),
      label: 'الملف الشخصي',
    ),
  ];

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Container(
        decoration: BoxDecoration(
          color: Colors.black.withValues(alpha: 0.8),
          borderRadius: const BorderRadius.vertical(
            top: Radius.circular(20),
          ),
        ),
        child: BottomNavigationBar(
          currentIndex: currentIndex.clamp(0, items.length - 1).toInt(),
          onTap: (index) {
            switch (index) {
              case 0:
                NavigationService.navigateToReplacement(AppRoutes.main);
                break;
              case 1:
                NavigationService.navigateToReplacement(AppRoutes.roomList);
                break;
              case 5:
                NavigationService.navigateToReplacement(AppRoutes.profile);
                break;
              default:
                NavigationService.navigateToReplacement(AppRoutes.main);
            }
          },
          type: BottomNavigationBarType.fixed,
          backgroundColor: Colors.transparent,
          elevation: 0,
          selectedItemColor: Colors.yellow[700],
          unselectedItemColor: Colors.grey,
          items: items,
        ),
      ),
    );
  }
}
