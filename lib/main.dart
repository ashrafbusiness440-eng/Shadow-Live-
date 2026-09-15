import 'widgets/bottom_nav_bar.dart';
import 'package:flutter/material.dart';
import 'package:firebase_core/firebase_core.dart';
import 'firebase_options.dart';

import 'package:flutter_bloc/flutter_bloc.dart';
import 'features/auth/bloc/auth_bloc.dart';
import 'features/user/bloc/user_bloc.dart';
import 'shared/services/firebase_service.dart' as shared_fb;
import 'shared/services/storage_service.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'widgets/host_section.dart';
import 'widgets/participant_grid.dart';
import 'widgets/notifications_section.dart';
import 'features/auth/screens/login_screen.dart';
import 'features/auth/screens/email_login_screen.dart';
import 'features/auth/screens/profile_setup_screen.dart';
import 'features/auth/screens/account_success_screen.dart';
import 'features/auth/screens/account_linking_screen.dart';
import 'features/auth/screens/account_ready_screen.dart';
import 'features/onboarding/screens/splash_screen.dart';
import 'features/onboarding/screens/onboarding_screen.dart';
import 'features/onboarding/screens/auth_choice_screen.dart';
import 'features/main/screens/main_shell_screen.dart';
import 'features/auth/screens/register_screen.dart';
import 'features/user/screens/profile_screen.dart';
import 'features/wallet/screens/wallet_screen.dart';
import 'features/wallet/screens/recharge_screen.dart';
import 'screens/room/create_room_screen.dart';
import 'screens/room/room_list_screen.dart';
import 'screens/settings/settings_screen.dart';
import 'services/navigation_service.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
  runApp(MultiBlocProvider(providers: [
    BlocProvider(create: (_) => AuthBloc(shared_fb.FirebaseService(), StorageService())..add(AuthCheckRequested())),
    BlocProvider(create: (_) => UserBloc(shared_fb.FirebaseService(), StorageService())),
  ], child: const MyApp()));
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
    debugShowCheckedModeBanner: false,
    title: 'Shadow Live',
    navigatorKey: NavigationService.navigatorKey,
    theme: ThemeData(colorScheme: ColorScheme.dark(primary: Colors.yellow[400]!, surface: Colors.black), textTheme: GoogleFonts.robotoTextTheme(Theme.of(context).textTheme).apply(bodyColor: Colors.white)),
    initialRoute: AppRoutes.splash,
    routes: {
      AppRoutes.splash: (_) => const SplashScreen(),
      AppRoutes.onboarding: (_) => const OnboardingScreen(),
      AppRoutes.authChoice: (_) => const AuthChoiceScreen(),
      AppRoutes.main: (_) => const MainShellScreen(),
      AppRoutes.login: (_) => const LoginScreen(),
      AppRoutes.emailLogin: (_) => const EmailLoginScreen(),
      AppRoutes.profileSetup: (_) => const ProfileSetupScreen(),
      AppRoutes.accountSuccess: (_) => const AccountSuccessScreen(),
      AppRoutes.accountLinking: (_) => const AccountLinkingScreen(),
      AppRoutes.accountReady: (_) => const AccountReadyScreen(),
      AppRoutes.register: (_) => const RegisterScreen(),
      AppRoutes.profile: (_) => const ProfileScreen(),
      AppRoutes.settings: (_) => const SettingsScreen(),
      AppRoutes.wallet: (_) => const WalletScreen(),
      AppRoutes.recharge: (_) => const RechargeScreen(),
      AppRoutes.roomList: (_) => const RoomListScreen(),
      AppRoutes.createRoom: (_) => const CreateRoomScreen(),
      AppRoutes.voiceChatRoom: (_) => const VoiceChatRoom(),
    },
  );
}

class VoiceChatRoom extends StatelessWidget {
  const VoiceChatRoom({super.key});
  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: Colors.black,
    body: Center(child: Container(constraints: const BoxConstraints(maxWidth: 400), child: Stack(children: [
      SingleChildScrollView(child: Padding(padding: const EdgeInsets.symmetric(horizontal: 16), child: Column(children: [
        const SizedBox(height: 120), const HostSection(), const SizedBox(height: 32),
        Container(padding: const EdgeInsets.all(12), decoration: BoxDecoration(color: Colors.grey[800]!.withValues(alpha: .5), borderRadius: BorderRadius.circular(12)), child: Row(children: [
          Container(width: 40, height: 40, decoration: const BoxDecoration(image: DecorationImage(image: CachedNetworkImageProvider('https://example.com/gift.jpg'), fit: BoxFit.cover))),
          const SizedBox(width: 12), const Expanded(child: Text('Wish List')), TextButton(onPressed: () => NavigationService.navigateTo(AppRoutes.settings), child: const Text('Send')),
        ])),
        const SizedBox(height: 32), const ParticipantGrid(), const SizedBox(height: 100),
      ]))),
      const NotificationsSection(),
      const Positioned(bottom: 0, left: 0, right: 0, child: BottomNavBar(currentIndex: 1)),
    ]))),
  );
}
