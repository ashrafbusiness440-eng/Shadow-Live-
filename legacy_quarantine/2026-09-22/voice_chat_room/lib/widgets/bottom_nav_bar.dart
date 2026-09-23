import 'package:flutter/material.dart';
import '../services/navigation_service.dart';

class BottomNavBar extends StatelessWidget {
  final int currentIndex;

  const BottomNavBar({super.key, required this.currentIndex});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.black.withOpacity(0.8),
        borderRadius: const BorderRadius.vertical(
          top: Radius.circular(20),
        ),
      ),
      child: BottomNavigationBar(
        currentIndex: currentIndex,
        onTap: (index) {
          switch (index) {
            case 0:
              NavigationService.navigateToReplacement(AppRoutes.roomList);
              break;
            case 1:
              NavigationService.navigateToReplacement(AppRoutes.voiceChatRoom);
              break;
            case 2:
              NavigationService.navigateToReplacement(AppRoutes.profile);
              break;
          }
        },
        backgroundColor: Colors.transparent,
        elevation: 0,
        selectedItemColor: Colors.yellow[700],
        unselectedItemColor: Colors.grey,
        items: const [
          BottomNavigationBarItem(
            icon: Icon(Icons.home),
            label: 'Home',
          ),
          BottomNavigationBarItem(
            icon: Icon(Icons.mic),
            label: 'Live',
          ),
          BottomNavigationBarItem(
            icon: Icon(Icons.person),
            label: 'Profile',
          ),
        ],
      ),
    );
  }
}