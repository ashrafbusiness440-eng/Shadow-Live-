import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'widgets/host_section.dart';
import 'widgets/participant_grid.dart';
import 'widgets/notifications_section.dart';
import 'screens/auth/login_screen.dart';
import 'screens/auth/register_screen.dart';
import 'screens/profile/profile_screen.dart';
import 'screens/room/create_room_screen.dart';
import 'screens/room/room_list_screen.dart';
import 'screens/settings/settings_screen.dart';
import 'services/navigation_service.dart';

void main() {
  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Voice Chat Room',
      navigatorKey: NavigationService.navigatorKey,
      theme: ThemeData(
        colorScheme: ColorScheme.dark(
          primary: Colors.yellow[400]!,
          background: Colors.black,
        ),
        textTheme: GoogleFonts.robotoTextTheme(
          Theme.of(context).textTheme,
        ).apply(bodyColor: Colors.white),
      ),
      initialRoute: AppRoutes.login,
      routes: {
        AppRoutes.login: (context) => const LoginScreen(),
        AppRoutes.register: (context) => const RegisterScreen(),
        AppRoutes.profile: (context) => const ProfileScreen(),
        AppRoutes.settings: (context) => const SettingsScreen(),
        AppRoutes.roomList: (context) => const RoomListScreen(),
        AppRoutes.createRoom: (context) => const CreateRoomScreen(),
        AppRoutes.voiceChatRoom: (context) => const VoiceChatRoom(),
      },
    );
  }
}

class VoiceChatRoom extends StatelessWidget {
  const VoiceChatRoom({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: Center(
        child: Container(
          constraints: const BoxConstraints(maxWidth: 400),
          child: Stack(
            children: [
              // Main content
              SingleChildScrollView(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: Column(
                    children: [
                      const SizedBox(height: 120), // Space for top gradient
                      const HostSection(),
                      const SizedBox(height: 32),
                      // Wishlist section
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: Colors.grey[800]!.withOpacity(0.5),
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Row(
                          children: [
                            Container(
                              width: 40,
                              height: 40,
                              decoration: BoxDecoration(
                                borderRadius: BorderRadius.circular(8),
                                image: const DecorationImage(
                                  image: CachedNetworkImageProvider(
                                    'https://example.com/gift.jpg',
                                  ),
                              ),
                                  fit: BoxFit.cover,
                                ),
                              ),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: const [
                                  Text(
                                    'Wish List',
                                    style: TextStyle(fontWeight: FontWeight.bold),
                                  ),
                                  Text(
                                    'Send her a wish gift',
                                    style: TextStyle(
                                      color: Colors.grey,
                                      fontSize: 12,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            TextButton(
                              onPressed: () => NavigationService.navigateTo(AppRoutes.settings),
                              child: Text(
                                'Send',
                                style: TextStyle(
                                  color: Colors.yellow[400],
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 32),
                      const ParticipantGrid(),
                      const SizedBox(height: 100), // Space for bottom nav
                    ],
                  ),
                ),
              ),
              // Top gradient and user info
              Positioned(
                top: 0,
                left: 0,
                right: 0,
                child: Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.topCenter,
                      end: Alignment.bottomCenter,
                      colors: [
                        Colors.black.withOpacity(0.8),
                        Colors.transparent,
                      ],
                    ),
                  ),
                  child: Column(
                    children: [
                      // User profile and room stats
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          // Profile section
                          Row(
                            children: [
                              GestureDetector(
                                onTap: () => NavigationService.navigateTo(AppRoutes.profile),
                                child: CircleAvatar(
                                radius: 20,
                                backgroundImage: CachedNetworkImageProvider(
                                  'https://example.com/avatar.jpg',
                                ),
                              ),
                              const SizedBox(width: 8),
                              Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  const Text(
                                    'Enrique Pemala',
                                    style: TextStyle(
                                      fontWeight: FontWeight.bold,
                                    ),
                                  ),
                                  Row(
                                    children: [
                                      Icon(
                                        Icons.star,
                                        color: Colors.yellow[400],
                                        size: 16,
                                      ),
                                      const Text(
                                        '8811M',
                                        style: TextStyle(
                                          color: Colors.grey,
                                          fontSize: 12,
                                        ),
                                      ),
                                    ],
                                  ),
                                ],
                              ),
                            ],
                          ),
                          // Room controls
                          Row(
                            children: [
                              IconButton(
                                icon: const Icon(Icons.share),
                                onPressed: () {},
                              ),
                              Container(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 12,
                                  vertical: 6,
                                ),
                                decoration: BoxDecoration(
                                  color: Colors.black.withOpacity(0.5),
                                  borderRadius: BorderRadius.circular(20),
                                ),
                                child: const Text('387'),
                              ),
                              IconButton(
                                icon: const Icon(Icons.settings),
                                onPressed: () => NavigationService.navigateTo(AppRoutes.settings),
                              ),
                            ],
                          ),
                        ],
                      ),
                      const SizedBox(height: 16),
                      // Top score and category
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 12,
                              vertical: 4,
                            ),
                            decoration: BoxDecoration(
                              color: Colors.yellow[500],
                              borderRadius: BorderRadius.circular(20),
                            ),
                            child: Row(
                              children: const [
                                Icon(
                                  Icons.military_tech,
                                  color: Colors.black,
                                  size: 16,
                                ),
                                SizedBox(width: 4),
                                Text(
                                  'Top Score',
                                  style: TextStyle(
                                    color: Colors.black,
                                    fontWeight: FontWeight.bold,
                                    fontSize: 12,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          Row(
                            children: const [
                              Text(
                                'For You',
                                style: TextStyle(
                                  color: Colors.grey,
                                  fontSize: 14,
                                ),
                              ),
                              Icon(
                                Icons.chevron_right,
                                color: Colors.grey,
                                size: 20,
                              ),
                            ],
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
              // Notifications
              const NotificationsSection(),
              // Room Controls
              Positioned(
                bottom: 80,
                left: 0,
                right: 0,
                child: Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: Colors.black.withOpacity(0.8),
                    borderRadius: const BorderRadius.vertical(
                      top: Radius.circular(20),
                    ),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Row(
                        children: [
                          Icon(
                            Icons.star,
                            color: Colors.yellow[400],
                          ),
                          const SizedBox(width: 16),
                          const Icon(Icons.sentiment_satisfied_alt),
                          const SizedBox(width: 16),
                          const Icon(Icons.list),
                        ],
                      ),
                      Row(
                        children: [
                          GestureDetector(
                            onTap: () => NavigationService.navigateToReplacement(AppRoutes.roomList),
                            child: Container(
                              padding: const EdgeInsets.all(8),
                              decoration: BoxDecoration(
                                color: Colors.red[600],
                                shape: BoxShape.circle,
                              ),
                              child: const Icon(Icons.call_end),
                            ),
                          ),
                          const SizedBox(width: 16),
                          Container(
                            padding: const EdgeInsets.all(8),
                            decoration: BoxDecoration(
                              color: Colors.grey[800],
                              shape: BoxShape.circle,
                            ),
                            child: const Icon(Icons.mic_off),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
              // Bottom Navigation
              const Positioned(
                bottom: 0,
                left: 0,
                right: 0,
                child: BottomNavBar(currentIndex: 1),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
