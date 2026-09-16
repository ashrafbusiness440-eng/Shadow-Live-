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
import 'features/user/screens/edit_profile_screen.dart';
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
    theme: ThemeData(
      colorScheme: ColorScheme.dark(primary: Colors.yellow[400]!, surface: Colors.black),
      textTheme: GoogleFonts.robotoTextTheme(Theme.of(context).textTheme).apply(bodyColor: Colors.white),
    ),
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
      AppRoutes.editProfile: (_) => const EditProfileScreen(),
      AppRoutes.settings: (_) => const SettingsScreen(),
      AppRoutes.roomList: (_) => const RoomListScreen(),
      AppRoutes.createRoom: (_) => const CreateRoomScreen(),
      AppRoutes.voiceChatRoom: (_) => const VoiceChatRoom(),
    },
  );
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
          child: Stack(children: [
            SingleChildScrollView(child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Column(children: [
                const SizedBox(height: 120),
                const HostSection(),
                const SizedBox(height: 32),
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(color: Colors.grey[800]!.withValues(alpha: 0.5), borderRadius: BorderRadius.circular(12)),
                  child: Row(children: [
                    Container(width: 40,height: 40,decoration: const BoxDecoration(image: DecorationImage(image: CachedNetworkImageProvider('https://example.com/gift.jpg'),fit: BoxFit.cover))),
                    const SizedBox(width: 12),
                    const Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start,children: [Text('Wish List',style: TextStyle(fontWeight: FontWeight.bold)),Text('Send her a wish gift',style: TextStyle(color: Colors.grey,fontSize: 12))])),
                    TextButton(onPressed: () => NavigationService.navigateTo(AppRoutes.settings),child: Text('Send',style: TextStyle(color: Colors.yellow[400],fontWeight: FontWeight.bold))),
                  ]),
                ),
                const SizedBox(height: 32),
                const ParticipantGrid(),
                const SizedBox(height: 100),
              ]),
            )),
            Positioned(top: 0,left: 0,right: 0,child: Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(gradient: LinearGradient(begin: Alignment.topCenter,end: Alignment.bottomCenter,colors: [Colors.black.withValues(alpha: 0.8),Colors.transparent])),
              child: Column(children: [
                Row(mainAxisAlignment: MainAxisAlignment.spaceBetween,children: [
                  Row(children: [
                    GestureDetector(onTap: () => NavigationService.navigateTo(AppRoutes.profile),child: const CircleAvatar(radius:20,backgroundImage:CachedNetworkImageProvider('https://example.com/avatar.jpg'))),
                    const SizedBox(width:8),
                    const Column(crossAxisAlignment:CrossAxisAlignment.start,children:[Text('Enrique Pemala',style:TextStyle(fontWeight:FontWeight.bold)),Text('8811M',style:TextStyle(color:Colors.grey,fontSize:12))]),
                  ]),
                  Row(children: [IconButton(icon:const Icon(Icons.share),onPressed:(){}),const Text('387'),IconButton(icon:const Icon(Icons.settings),onPressed:()=>NavigationService.navigateTo(AppRoutes.settings))]),
                ]),
              ]),
            )),
            const NotificationsSection(),
            Positioned(bottom:80,left:0,right:0,child:Container(
              padding:const EdgeInsets.all(16),color:Colors.black.withValues(alpha:0.8),
              child:Row(mainAxisAlignment:MainAxisAlignment.spaceBetween,children:[
                const Row(children:[Icon(Icons.star),SizedBox(width:16),Icon(Icons.sentiment_satisfied_alt),SizedBox(width:16),Icon(Icons.list)]),
                Row(children:[GestureDetector(onTap:()=>NavigationService.navigateToReplacement(AppRoutes.roomList),child:Container(padding:const EdgeInsets.all(8),decoration:BoxDecoration(color:Colors.red[600],shape:BoxShape.circle),child:const Icon(Icons.call_end))),const SizedBox(width:16),const Icon(Icons.mic_off)]),
              ]),
            )),
            const Positioned(bottom:0,left:0,right:0,child:BottomNavBar(currentIndex:1)),
          ]),
        ),
      ),
    );
  }
}
