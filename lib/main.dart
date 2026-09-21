import 'dart:async';
import 'widgets/bottom_nav_bar.dart';
import 'package:flutter/material.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_storage/firebase_storage.dart';
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
import 'features/voice/services/voice_service.dart';
import 'features/voice/services/zego_voice_service.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp(
    options: DefaultFirebaseOptions.currentPlatform,
  );
  if (const bool.fromEnvironment('USE_FIREBASE_EMULATORS')) {
    await FirebaseAuth.instance.useAuthEmulator('127.0.0.1', 9099);
    FirebaseFirestore.instance.useFirestoreEmulator('127.0.0.1', 8080);
    await FirebaseStorage.instance.useStorageEmulator('127.0.0.1', 9199);
  }
  runApp(
    MultiBlocProvider(
      providers: [
        BlocProvider(
          create: (_) => AuthBloc(
            shared_fb.FirebaseService(),
            StorageService(),
          )..add(AuthCheckRequested()),
        ),
        BlocProvider(
          create: (_) => UserBloc(
            shared_fb.FirebaseService(),
            StorageService(),
          ),
        ),
      ],
      child: const MyApp(),
    ),
  );
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'Shadow Live',
      navigatorKey: NavigationService.navigatorKey,
      theme: ThemeData(
        colorScheme: ColorScheme.dark(
          primary: Colors.yellow[400]!,
          surface: Colors.black,
        ),
        textTheme: GoogleFonts.robotoTextTheme(
          Theme.of(context).textTheme,
        ).apply(bodyColor: Colors.white),
      ),
      initialRoute: AppRoutes.splash,
      routes: {
        AppRoutes.splash: (context) => const SplashScreen(),
        AppRoutes.onboarding: (context) => const OnboardingScreen(),
        AppRoutes.authChoice: (context) => const AuthChoiceScreen(),
        AppRoutes.main: (context) => const MainShellScreen(),
        AppRoutes.login: (context) => const LoginScreen(),
        AppRoutes.emailLogin: (context) => const EmailLoginScreen(),
        AppRoutes.profileSetup: (context) => const ProfileSetupScreen(),
        AppRoutes.accountSuccess: (context) => const AccountSuccessScreen(),
        AppRoutes.accountLinking: (context) => const AccountLinkingScreen(),
        AppRoutes.accountReady: (context) => const AccountReadyScreen(),
        AppRoutes.register: (context) => const RegisterScreen(),
        AppRoutes.profile: (context) => const ProfileScreen(),
        AppRoutes.editProfile: (context) => const EditProfileScreen(),
        AppRoutes.settings: (context) => const SettingsScreen(),
        AppRoutes.roomList: (context) => const RoomListScreen(),
        AppRoutes.createRoom: (context) => const CreateRoomScreen(),
        AppRoutes.voiceChatRoom: (context) => const VoiceChatRoom(),
      },
    );
  }
}

class VoiceChatRoom extends StatefulWidget {
  const VoiceChatRoom({super.key});

  @override
  State<VoiceChatRoom> createState() => _VoiceChatRoomState();
}

class _VoiceChatRoomState extends State<VoiceChatRoom> {
  final VoiceService _voiceService = ZegoVoiceService();
  bool _voiceStarted = false;
  bool _voiceJoining = true;
  bool _voiceMicMuted = true;
  String? _voiceError;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_voiceStarted) return;
    _voiceStarted = true;
    unawaited(_connectVoice());
  }

  Future<void> _connectVoice() async {
    final raw = ModalRoute.of(context)?.settings.arguments;
    final args = raw is Map ? Map<String, dynamic>.from(raw) : <String, dynamic>{};
    final roomId = (args['roomId'] ?? '').toString().trim();
    final user = FirebaseAuth.instance.currentUser;
    if (roomId.isEmpty || user == null) {
      if (mounted) {
        setState(() {
          _voiceJoining = false;
          _voiceError = roomId.isEmpty ? 'room_id_missing' : 'not_signed_in';
        });
      }
      return;
    }

    final displayName = (user.displayName ??
            args['displayName'] ??
            args['hostName'] ??
            'Shadow Live')
        .toString()
        .trim();

    try {
      await _voiceService.initialize();
      await _voiceService.joinRoom(
        roomId: roomId,
        userId: user.uid,
        displayName: displayName.isEmpty ? 'Shadow Live' : displayName,
      );
      if (mounted) {
        setState(() {
          _voiceJoining = false;
          _voiceError = null;
          _voiceMicMuted = true;
        });
      }
    } catch (error) {
      if (mounted) {
        setState(() {
          _voiceJoining = false;
          _voiceError = error.toString();
        });
      }
    }
  }

  Future<void> _toggleVoiceMic() async {
    if (_voiceJoining || _voiceError != null) return;
    try {
      if (_voiceMicMuted) {
        await _voiceService.unmuteMic();
      } else {
        await _voiceService.muteMic();
      }
      if (mounted) {
        setState(() => _voiceMicMuted = !_voiceMicMuted);
      }
    } catch (error) {
      if (mounted) setState(() => _voiceError = error.toString());
    }
  }

  Future<void> _leaveVoiceRoom() async {
    try {
      await _voiceService.leaveRoom();
    } catch (_) {}
    if (mounted) {
      NavigationService.navigateToReplacement(AppRoutes.roomList);
    }
  }

  @override
  void dispose() {
    unawaited(_voiceService.dispose());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: Center(
        child: Container(
          constraints: const BoxConstraints(maxWidth: 400),
          child: Stack(
            children: [
              SingleChildScrollView(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: Column(
                    children: [
                      const SizedBox(height: 120),
                      const HostSection(),
                      const SizedBox(height: 32),
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: Colors.grey[800]!.withValues(alpha: 0.5),
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
                                  image: CachedNetworkImageProvider('https://example.com/gift.jpg'),
                                  fit: BoxFit.cover,
                                ),
                              ),
                            ),
                            const SizedBox(width: 12),
                            const Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text('Wish List', style: TextStyle(fontWeight: FontWeight.bold)),
                                  Text('Send her a wish gift', style: TextStyle(color: Colors.grey, fontSize: 12)),
                                ],
                              ),
                            ),
                            TextButton(
                              onPressed: () => NavigationService.navigateTo(AppRoutes.settings),
                              child: Text('Send', style: TextStyle(color: Colors.yellow[400], fontWeight: FontWeight.bold)),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 32),
                      const ParticipantGrid(),
                      const SizedBox(height: 100),
                    ],
                  ),
                ),
              ),
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
                      colors: [Colors.black.withValues(alpha: 0.8), Colors.transparent],
                    ),
                  ),
                  child: Column(
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Row(
                            children: [
                              GestureDetector(
                                onTap: () => NavigationService.navigateTo(AppRoutes.profile),
                                child: const CircleAvatar(radius: 20, backgroundImage: CachedNetworkImageProvider('https://example.com/avatar.jpg')),
                              ),
                              const SizedBox(width: 8),
                              Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  const Text('Enrique Pemala', style: TextStyle(fontWeight: FontWeight.bold)),
                                  Row(children: [Icon(Icons.star, color: Colors.yellow[400], size: 16), const Text('8811M', style: TextStyle(color: Colors.grey, fontSize: 12))]),
                                ],
                              ),
                            ],
                          ),
                          Row(
                            children: [
                              IconButton(icon: const Icon(Icons.share), onPressed: () {}),
                              Container(padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6), decoration: BoxDecoration(color: Colors.black.withValues(alpha: 0.5), borderRadius: BorderRadius.circular(20)), child: const Text('387')),
                              IconButton(icon: const Icon(Icons.settings), onPressed: () => NavigationService.navigateTo(AppRoutes.settings)),
                            ],
                          ),
                        ],
                      ),
                      const SizedBox(height: 16),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                            decoration: BoxDecoration(color: Colors.yellow[500], borderRadius: BorderRadius.circular(20)),
                            child: const Row(children: [Icon(Icons.military_tech, color: Colors.black, size: 16), SizedBox(width: 4), Text('Top Score', style: TextStyle(color: Colors.black, fontWeight: FontWeight.bold, fontSize: 12))]),
                          ),
                          const Row(children: [Text('For You', style: TextStyle(color: Colors.grey, fontSize: 14)), Icon(Icons.chevron_right, color: Colors.grey, size: 20)]),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
              const NotificationsSection(),
              Positioned(
                bottom: 80,
                left: 0,
                right: 0,
                child: Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(color: Colors.black.withValues(alpha: 0.8), borderRadius: const BorderRadius.vertical(top: Radius.circular(20))),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Row(children: [Icon(Icons.star, color: Colors.yellow[400]), const SizedBox(width: 16), const Icon(Icons.sentiment_satisfied_alt), const SizedBox(width: 16), const Icon(Icons.list)]),
                      Row(children: [GestureDetector(onTap: _leaveVoiceRoom, child: Container(padding: const EdgeInsets.all(8), decoration: BoxDecoration(color: Colors.red[600], shape: BoxShape.circle), child: const Icon(Icons.call_end))), const SizedBox(width: 16), GestureDetector(onTap: _voiceJoining || _voiceError != null ? null : _toggleVoiceMic, child: Container(padding: const EdgeInsets.all(8), decoration: BoxDecoration(color: _voiceError != null ? Colors.red[900] : Colors.grey[800], shape: BoxShape.circle), child: Icon(_voiceMicMuted ? Icons.mic_off : Icons.mic)))]),
                    ],
                  ),
                ),
              ),
              const Positioned(bottom: 0, left: 0, right: 0, child: BottomNavBar(currentIndex: 1)),
            ],
          ),
        ),
      ),
    );
  }
}
