import 'package:flutter/material.dart';

class NavigationService {
  static final GlobalKey<NavigatorState> navigatorKey = GlobalKey<NavigatorState>();

  static Future<dynamic> navigateTo(String routeName, {dynamic arguments}) => navigatorKey.currentState!.pushNamed(routeName, arguments: arguments);
  static Future<dynamic> navigateToReplacement(String routeName, {dynamic arguments}) => navigatorKey.currentState!.pushReplacementNamed(routeName, arguments: arguments);
  static Future<dynamic> navigateToAndRemoveUntil(String routeName, {dynamic arguments}) => navigatorKey.currentState!.pushNamedAndRemoveUntil(routeName, (Route<dynamic> route) => false, arguments: arguments);
  static void goBack() => navigatorKey.currentState!.pop();
}

class AppRoutes {
  static const String splash = '/splash';
  static const String onboarding = '/onboarding';
  static const String authChoice = '/auth-choice';
  static const String emailLogin = '/email-login';
  static const String emailVerification = '/email-verification';
  static const String phoneAuth = '/phone-auth';
  static const String otp = '/otp';
  static const String profileSetup = '/profile-setup';
  static const String accountSuccess = '/account-success';
  static const String accountLinking = '/account-linking';
  static const String extraInfo = '/extra-info';
  static const String interests = '/interests';
  static const String permissions = '/permissions';
  static const String accountReady = '/account-ready';
  static const String main = '/main';
  static const String login = '/login';
  static const String register = '/register';
  static const String profile = '/profile';
  static const String editProfile = '/edit-profile';
  static const String settings = '/settings';
  static const String roomList = '/room-list';
  static const String createRoom = '/create-room';
  static const String voiceChatRoom = '/voice-chat-room';
  static const String recharge = '/recharge';
  static const String rechargeCheckout = '/recharge-checkout';
}
