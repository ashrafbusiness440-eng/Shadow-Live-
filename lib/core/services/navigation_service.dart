import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../constants/route_constants.dart';
import '../utils/app_logger.dart';

class NavigationService {
  static final NavigationService _instance = NavigationService._internal();
  factory NavigationService() => _instance;
  NavigationService._internal();

  late final GlobalKey<NavigatorState> navigatorKey;
  late final GoRouter router;

  void initialize(GoRouter routerInstance) {
    router = routerInstance;
    navigatorKey = router.routerDelegate.navigatorKey;
    AppLogger.i('Navigation service initialized', tag: 'Navigation');
  }

  // Navigate to a named route
  Future<dynamic> navigateTo(String routeName, {Map<String, dynamic>? params}) async {
    try {
      AppLogger.d('Navigating to: $routeName', tag: 'Navigation');
      if (params != null && params.isNotEmpty) {
        return await router.pushNamed(
          routeName,
          queryParams: Map<String, String>.from(
            params.map((key, value) => MapEntry(key, value.toString())),
          ),
        );
      } else {
        return await router.pushNamed(routeName);
      }
    } catch (e, stackTrace) {
      AppLogger.e(
        'Navigation error',
        tag: 'Navigation',
        error: e,
        stackTrace: stackTrace,
      );
      return null;
    }
  }

  // Replace current route
  Future<dynamic> replaceTo(String routeName, {Map<String, dynamic>? params}) async {
    try {
      AppLogger.d('Replacing route with: $routeName', tag: 'Navigation');
      if (params != null && params.isNotEmpty) {
        return await router.pushReplacementNamed(
          routeName,
          queryParams: Map<String, String>.from(
            params.map((key, value) => MapEntry(key, value.toString())),
          ),
        );
      } else {
        return await router.pushReplacementNamed(routeName);
      }
    } catch (e, stackTrace) {
      AppLogger.e(
        'Route replacement error',
        tag: 'Navigation',
        error: e,
        stackTrace: stackTrace,
      );
      return null;
    }
  }

  // Navigate back
  void goBack() {
    try {
      AppLogger.d('Navigating back', tag: 'Navigation');
      router.pop();
    } catch (e) {
      AppLogger.e('Navigation back error', tag: 'Navigation', error: e);
    }
  }

  // Navigate to home
  Future<void> navigateToHome() async {
    try {
      AppLogger.d('Navigating to home', tag: 'Navigation');
      await router.goNamed('home');
    } catch (e) {
      AppLogger.e('Home navigation error', tag: 'Navigation', error: e);
    }
  }

  // Navigate to login
  Future<void> navigateToLogin() async {
    try {
      AppLogger.d('Navigating to login', tag: 'Navigation');
      await router.goNamed('login');
    } catch (e) {
      AppLogger.e('Login navigation error', tag: 'Navigation', error: e);
    }
  }

  // Navigate to register
  Future<void> navigateToRegister() async {
    try {
      AppLogger.d('Navigating to register', tag: 'Navigation');
      await router.goNamed('register');
    } catch (e) {
      AppLogger.e('Register navigation error', tag: 'Navigation', error: e);
    }
  }

  // Navigate to profile
  Future<void> navigateToProfile({String? userId}) async {
    try {
      AppLogger.d('Navigating to profile', tag: 'Navigation');
      if (userId != null) {
        await router.pushNamed('profile', queryParams: {'userId': userId});
      } else {
        await router.pushNamed('profile');
      }
    } catch (e) {
      AppLogger.e('Profile navigation error', tag: 'Navigation', error: e);
    }
  }

  // Navigate to room
  Future<void> navigateToRoom({
    required String roomId,
    bool isHost = false,
  }) async {
    try {
      AppLogger.d('Navigating to room: $roomId', tag: 'Navigation');
      await router.pushNamed(
        'room',
        params: {'roomId': roomId},
        queryParams: {'isHost': isHost.toString()},
      );
    } catch (e) {
      AppLogger.e('Room navigation error', tag: 'Navigation', error: e);
    }
  }

  // Navigate to settings
  Future<void> navigateToSettings() async {
    try {
      AppLogger.d('Navigating to settings', tag: 'Navigation');
      await router.pushNamed('settings');
    } catch (e) {
      AppLogger.e('Settings navigation error', tag: 'Navigation', error: e);
    }
  }

  // Navigate to notifications
  Future<void> navigateToNotifications() async {
    try {
      AppLogger.d('Navigating to notifications', tag: 'Navigation');
      await router.pushNamed('notifications');
    } catch (e) {
      AppLogger.e('Notifications navigation error', tag: 'Navigation', error: e);
    }
  }

  // Navigate to gift shop
  Future<void> navigateToGiftShop() async {
    try {
      AppLogger.d('Navigating to gift shop', tag: 'Navigation');
      await router.pushNamed('giftShop');
    } catch (e) {
      AppLogger.e('Gift shop navigation error', tag: 'Navigation', error: e);
    }
  }

  // Navigate to VIP center
  Future<void> navigateToVipCenter() async {
    try {
      AppLogger.d('Navigating to VIP center', tag: 'Navigation');
      await router.pushNamed('vipCenter');
    } catch (e) {
      AppLogger.e('VIP center navigation error', tag: 'Navigation', error: e);
    }
  }

  // Navigate to wallet
  Future<void> navigateToWallet() async {
    try {
      AppLogger.d('Navigating to wallet', tag: 'Navigation');
      await router.pushNamed('wallet');
    } catch (e) {
      AppLogger.e('Wallet navigation error', tag: 'Navigation', error: e);
    }
  }

  // Navigate to achievements
  Future<void> navigateToAchievements() async {
    try {
      AppLogger.d('Navigating to achievements', tag: 'Navigation');
      await router.pushNamed('achievements');
    } catch (e) {
      AppLogger.e('Achievements navigation error', tag: 'Navigation', error: e);
    }
  }

  // Navigate to PK center
  Future<void> navigateToPkCenter() async {
    try {
      AppLogger.d('Navigating to PK center', tag: 'Navigation');
      await router.pushNamed('pkCenter');
    } catch (e) {
      AppLogger.e('PK center navigation error', tag: 'Navigation', error: e);
    }
  }

  // Navigate to error page
  Future<void> navigateToError(String errorCode) async {
    try {
      AppLogger.d('Navigating to error page: $errorCode', tag: 'Navigation');
      await router.pushNamed('error', queryParams: {'code': errorCode});
    } catch (e) {
      AppLogger.e('Error page navigation error', tag: 'Navigation', error: e);
    }
  }

  // Clear navigation stack and start fresh
  Future<void> clearStackAndNavigateTo(String routeName) async {
    try {
      AppLogger.d(
        'Clearing navigation stack and navigating to: $routeName',
        tag: 'Navigation',
      );
      await router.go(routeName);
    } catch (e) {
      AppLogger.e('Clear stack navigation error', tag: 'Navigation', error: e);
    }
  }

  // Check if can go back
  bool canGoBack() {
    return router.canPop();
  }

  // Get current route name
  String? getCurrentRouteName() {
    try {
      final RouteMatch lastMatch = router.routerDelegate.currentConfiguration.last;
      return lastMatch.matchedLocation;
    } catch (e) {
      AppLogger.e('Error getting current route name', tag: 'Navigation', error: e);
      return null;
    }
  }
}