import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../features/auth/screens/login_screen.dart';
import '../../features/auth/screens/register_screen.dart';
import '../../features/home/screens/home_screen.dart';
import '../../screens/room/room_list_screen.dart';
import '../../features/user/screens/profile_screen.dart';

class AppRouter {
  static final _rootNavigatorKey = GlobalKey<NavigatorState>();
  static final _shellNavigatorKey = GlobalKey<NavigatorState>();

  static final router = GoRouter(
    navigatorKey: _rootNavigatorKey,
    initialLocation: '/login',
    routes: [
      // Auth Routes
      GoRoute(
        path: '/login',
        name: 'login',
        builder: (context, state) => const LoginScreen(),
      ),
      GoRoute(
        path: '/register',
        name: 'register',
        builder: (context, state) => const RegisterScreen(),
      ),

      // Main App Shell
      ShellRoute(
        navigatorKey: _shellNavigatorKey,
        builder: (context, state, child) {
          return Scaffold(
            body: child,
            // Bottom navigation can be added here if needed
          );
        },
        routes: [
          // Home Route
          GoRoute(
            path: '/home',
            name: 'home',
            builder: (context, state) => const HomeScreen(),
            routes: [
              // Room Route
              GoRoute(
                path: 'room/:roomId',
                name: 'room',
                builder: (context, state) {
                  // The legacy Agora RoomScreen was removed. Active voice
                  // rooms are now opened by Shadow Live's provider-neutral
                  // room flow from RoomListScreen.
                  return const RoomListScreen();
                },
              ),
            ],
          ),

          // Profile Route
          GoRoute(
            path: '/profile',
            name: 'profile',
            builder: (context, state) => const ProfileScreen(),
          ),
        ],
      ),
    ],

    // Redirect logic
    redirect: (BuildContext context, GoRouterState state) {
      // Add authentication check and redirect logic here
      // Example:
      // final isAuth = context.read<AuthBloc>().state is Authenticated;
      // final isAuthRoute = state.location == '/login' || state.location == '/register';

      // if (!isAuth && !isAuthRoute) {
      //   return '/login';
      // }
      // if (isAuth && isAuthRoute) {
      //   return '/home';
      // }

      return null;
    },

    // Error handling
    errorBuilder: (context, state) => Scaffold(
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Text(
              'Page Not Found',
              style: TextStyle(
                fontSize: 24,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: () => context.go('/home'),
              child: const Text('Go Home'),
            ),
          ],
        ),
      ),
    ),
  );
}
