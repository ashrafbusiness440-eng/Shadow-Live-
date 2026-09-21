import 'dart:async';
import 'widgets/bottom_nav_bar.dart';
import 'package:flutter/material.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_auth/firebase_auth.dart';
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
import 'features/voice/services/voice_service.dart';
import 'features/voice/services/zego_voice_service.dart';

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
  VoiceConnectionState _voiceConnectionState = VoiceConnectionState.idle;
  StreamSubscription<VoiceConnectionState>? _voiceConnectionSubscription;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_voiceStarted) return;
    _voiceStarted = true;
    unawaited(_connectVoice());
  }

  Future<void> _connectVoice() async {
    final raw = ModalRoute.of(context)?.settings.arguments;
    final args =
        raw is Map ? Map<String, dynamic>.from(raw) : <String, dynamic>{};
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
      _voiceConnectionSubscription ??=
          _voiceService.connectionStates.listen((state) {
        if (!mounted) return;
        setState(() => _voiceConnectionState = state);
      });
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
    if (_voiceJoining ||
        _voiceError != null ||
        _voiceConnectionState != VoiceConnectionState.connected) {
      return;
    }
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
    final subscription = _voiceConnectionSubscription;
    if (subscription != null) {
      unawaited(subscription.cancel());
    }
    unawaited(_voiceService.dispose());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
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
                            color: Colors.grey[800]!.withValues(alpha: .5),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Row(
                            children: [
                              Container(
                                width: 40,
                                height: 40,
                                decoration: const BoxDecoration(
                                  image: DecorationImage(
                                    image: CachedNetworkImageProvider(
                                      'https://example.com/gift.jpg',
                                    ),
                                    fit: BoxFit.cover,
                                  ),
                                ),
                              ),
                              const SizedBox(width: 12),
                              const Expanded(child: Text('Wish List')),
                              TextButton(
                                onPressed: () => NavigationService.navigateTo(
                                  AppRoutes.settings,
                                ),
                                child: const Text('Send'),
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 32),
                        const ParticipantGrid(),
                        const SizedBox(height: 140),
                      ],
                    ),
                  ),
                ),
                if (_voiceJoining ||
                    _voiceConnectionState == VoiceConnectionState.reconnecting ||
                    _voiceConnectionState == VoiceConnectionState.failed ||
                    _voiceError != null)
                  Positioned(
                    top: 24,
                    left: 16,
                    right: 16,
                    child: SafeArea(
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 12,
                          vertical: 8,
                        ),
                        decoration: BoxDecoration(
                          color: Colors.black.withValues(alpha: .65),
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Text(
                          _voiceError != null ||
                                  _voiceConnectionState ==
                                      VoiceConnectionState.failed
                              ? 'تعذر الاتصال بالصوت'
                              : _voiceConnectionState ==
                                      VoiceConnectionState.reconnecting
                                  ? 'جاري إعادة الاتصال بالصوت...'
                                  : 'جاري الاتصال بالصوت...',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            color: _voiceError != null ||
                                    _voiceConnectionState ==
                                        VoiceConnectionState.failed
                                ? Colors.redAccent
                                : Colors.white70,
                          ),
                        ),
                      ),
                    ),
                  ),
                const NotificationsSection(),
                Positioned(
                  bottom: 76,
                  left: 16,
                  right: 16,
                  child: SafeArea(
                    top: false,
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.end,
                      children: [
                        GestureDetector(
                          onTap: _voiceJoining ||
                                  _voiceError != null ||
                                  _voiceConnectionState !=
                                      VoiceConnectionState.connected
                              ? null
                              : _toggleVoiceMic,
                          child: Container(
                            padding: const EdgeInsets.all(12),
                            decoration: BoxDecoration(
                              color: _voiceError != null
                                  ? Colors.red[900]
                                  : Colors.grey[850],
                              shape: BoxShape.circle,
                            ),
                            child: Icon(
                              _voiceMicMuted ? Icons.mic_off : Icons.mic,
                              color: Colors.white,
                            ),
                          ),
                        ),
                        const SizedBox(width: 12),
                        GestureDetector(
                          onTap: _leaveVoiceRoom,
                          child: Container(
                            padding: const EdgeInsets.all(12),
                            decoration: BoxDecoration(
                              color: Colors.red[700],
                              shape: BoxShape.circle,
                            ),
                            child: const Icon(
                              Icons.call_end,
                              color: Colors.white,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
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
