import 'dart:async';
import 'dart:typed_data';
import 'dart:math';
import 'dart:ui';
import 'widgets/bottom_nav_bar.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:image_picker/image_picker.dart';
import 'firebase_options.dart';

import 'package:flutter_bloc/flutter_bloc.dart';
import 'features/auth/bloc/auth_bloc.dart';
import 'features/user/bloc/user_bloc.dart';
import 'shared/services/firebase_service.dart' as shared_fb;
import 'shared/services/storage_service.dart';
import 'shared/services/user_storage_service.dart';

import 'package:google_fonts/google_fonts.dart';
import 'widgets/host_section.dart';
import 'features/auth/screens/login_screen.dart';
import 'features/auth/screens/email_login_screen.dart';
import 'features/auth/screens/email_verification_screen.dart';
import 'features/auth/widgets/account_enforcement_host.dart';
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
import 'features/agency/screens/my_agency_entry_page.dart';
import 'features/agency/screens/agency_application_page.dart';
import 'features/agency/screens/agency_search_page.dart';
import 'features/notifications/screens/notifications_page.dart';
import 'features/profile/widgets/quick_profile_sheet.dart';
import 'features/mysterious/widgets/mysterious_identity_widgets.dart';
import 'features/profile/widgets/profile_avatar_with_frame.dart';
import 'features/profile/widgets/registry_badge.dart';
import 'features/profile/widgets/user_level_badges.dart';
import 'features/profile/screens/user_level_screen.dart';
import 'screens/room/create_room_screen.dart';
import 'screens/room/room_list_screen.dart';
import 'screens/settings/settings_screen.dart';
import 'services/navigation_service.dart';
import 'features/voice/services/voice_room_session_controller.dart';
import 'features/room/services/room_action_service.dart';
import 'features/room/services/room_image_source.dart';
import 'features/room/services/room_invite_service.dart';
import 'features/room/services/room_insights_service.dart';
import 'features/room/services/room_bootstrap_service.dart';
import 'features/room/services/room_moderation_service.dart';
import 'features/room/services/room_moderator_service.dart';
import 'features/room/widgets/room_chat_panel.dart';
import 'features/gift/widgets/room_gift_sheet.dart';
import 'features/room/widgets/room_moderator_manager_sheet.dart';
import 'features/room/widgets/room_music_sheet.dart';
import 'features/room/widgets/room_pk_panel.dart';
import 'features/room/widgets/room_rocket_banner_host.dart';
import 'features/room/widgets/cosmetic_effect_widgets.dart';
import 'features/room/widgets/room_effect_coordinator.dart';
import 'features/room/services/room_rocket_service.dart';
import 'core/assets/shadow_asset_registry.dart';
import 'features/room/widgets/star_battle_sheet.dart';
import 'features/room/services/room_seat_service.dart';
import 'features/games/services/game_runtime_service.dart';
import 'features/games/widgets/room_game_overlay.dart';
import 'features/profile/screens/my_items_screen.dart';
import 'features/agency/screens/public_agency_page.dart';
import 'features/agency/services/agency_room_link.dart';
import 'features/agency/widgets/agency_room_image_crop_sheet.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp(
    options: DefaultFirebaseOptions.currentPlatform,
  );
  await FirebaseAuth.instance.setLanguageCode('ar');

  const e2eTest = bool.fromEnvironment('E2E_TEST');
  const e2eRoomTest = bool.fromEnvironment('E2E_ROOM_TEST');
  if ((e2eTest || e2eRoomTest) && FirebaseAuth.instance.currentUser == null) {
    try {
      await FirebaseAuth.instance.signInAnonymously();
    } catch (_) {
      // The E2E shell can still render its diagnostic route if auth is unavailable.
    }
  }
  if (const bool.fromEnvironment('USE_FIREBASE_EMULATORS')) {
    await FirebaseAuth.instance.useAuthEmulator('127.0.0.1', 9099);
    FirebaseFirestore.instance.useFirestoreEmulator('127.0.0.1', 8080);
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
      builder: (context, child) => AccountEnforcementHost(
        child: RoomRocketBannerHost(
          child: child ?? const SizedBox.shrink(),
        ),
      ),
      theme: ThemeData(
        colorScheme: ColorScheme.dark(
          primary: Colors.yellow[400]!,
          surface: Colors.black,
        ),
        textTheme: GoogleFonts.robotoTextTheme(
          Theme.of(context).textTheme,
        ).apply(bodyColor: Colors.white),
      ),
      initialRoute: const bool.fromEnvironment('E2E_ROOM_TEST')
          ? AppRoutes.voiceChatRoom
          : const bool.fromEnvironment('E2E_TEST')
              ? AppRoutes.main
              : AppRoutes.splash,
      routes: {
        AppRoutes.splash: (context) => const SplashScreen(),
        AppRoutes.onboarding: (context) => const OnboardingScreen(),
        AppRoutes.authChoice: (context) => const AuthChoiceScreen(),
        AppRoutes.main: (context) => const MainShellScreen(),
        AppRoutes.login: (context) => const LoginScreen(),
        AppRoutes.emailLogin: (context) => const EmailLoginScreen(),
        AppRoutes.emailVerification: (context) => const EmailVerificationScreen(),
        AppRoutes.profileSetup: (context) => const ProfileSetupScreen(),
        AppRoutes.accountSuccess: (context) => const AccountSuccessScreen(),
        AppRoutes.accountLinking: (context) => const AccountLinkingScreen(),
        AppRoutes.accountReady: (context) => const AccountReadyScreen(),
        AppRoutes.register: (context) => const RegisterScreen(),
        AppRoutes.profile: (context) => const ProfileScreen(),
        AppRoutes.editProfile: (context) => const EditProfileScreen(),
        AppRoutes.settings: (context) => const SettingsScreen(),
        AppRoutes.myAgency: (context) => const MyAgencyEntryPage(),
        AppRoutes.agencyApplication: (context) => const AgencyApplicationPage(),
        AppRoutes.agencySearch: (context) => const AgencySearchPage(),
        AppRoutes.notifications: (context) => const NotificationsPage(),
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
  final VoiceRoomSessionController _voiceSession =
      VoiceRoomSessionController.instance;
  final RoomActionService _roomActions = RoomActionService();
  final UserStorageService _userStorage = UserStorageService();
  final ImagePicker _roomCoverPicker = ImagePicker();
  final RoomInviteService _roomInvites = RoomInviteService();
  final RoomInsightsService _roomInsightsService = RoomInsightsService();
  final RoomBootstrapService _roomBootstrapService = RoomBootstrapService();
  final RoomModerationService _roomModeration = RoomModerationService();
  final RoomModeratorService _roomModeratorService = RoomModeratorService();
  final RoomSeatService _roomSeatService = RoomSeatService();
  late final RoomEffectCoordinator _roomEffectCoordinator;
  bool _voiceStarted = false;

  @override
  void initState() {
    super.initState();
    _roomEffectCoordinator = RoomEffectCoordinator(
      playEffectSound: _voiceSession.playRoomEffectSound,
      stopEffectSounds: _voiceSession.stopRoomEffectSounds,
    );
    _voiceSession.addListener(_syncVoiceSession);
  }

  void _syncVoiceSession() {
    if (!mounted) return;
    final roomClosed = _voiceSession.error == 'room_closed';
    final roomBanned = _voiceSession.error == 'room_banned';
    setState(() {
      _voiceJoining = _voiceSession.joining;
      _voiceMicMuted = _voiceSession.micMuted;
      _voiceError = _voiceSession.error;
      if (_voiceSession.roomArguments.isNotEmpty) {
        _roomArguments = _voiceSession.roomArguments;
      }
    });
    _roomEffectCoordinator.setPreferences(
      visualEnabled: _roomEffectsEnabled,
      effectSoundEnabled: _effectSoundEnabled,
    );
    final rawEntrance = _voiceSession.roomArguments['recentEntrance'];
    if (rawEntrance is Map) {
      _roomEffectCoordinator.ingestEntrance(
        Map<String, dynamic>.from(rawEntrance),
      );
    }
    for (final message in _voiceSession.roomChatMessages.take(8)) {
      final systemKind = (message['systemKind'] ?? '').toString();
      if (systemKind == 'gift') {
        _roomEffectCoordinator.ingestGiftMessage(message);
      } else if (
        systemKind == 'animated_emoji' ||
        (message['animatedEmojiId'] ?? '').toString().trim().isNotEmpty
      ) {
        _roomEffectCoordinator.ingestAnimatedEmojiMessage(message);
      }
    }
    if ((roomClosed || roomBanned) && !_roomClosedHandled) {
      _roomClosedHandled = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              roomBanned
                  ? 'تم إخراجك من الغرفة.'
                  : 'تم إغلاق الغرفة من صاحبها.',
            ),
          ),
        );
        Navigator.of(context).pushAndRemoveUntil(
          MaterialPageRoute(
            builder: (_) => const MainShellScreen(initialNavIndex: 1),
          ),
          (_) => false,
        );
      });
    }
  }

  bool _voiceJoining = true;
  bool _voiceMicMuted = true;
  String? _voiceError;
  Map<String, dynamic> _roomArguments = <String, dynamic>{};
  String _ownerDisplayName = 'صاحب الغرفة';
  String _ownerPhotoUrl = '';
  String _ownerLocation = '';
  bool _roomSoundEnabled = true;
  bool _effectSoundEnabled = true;
  bool _roomEffectsEnabled = true;
  bool _roomGhostMode = false;
  bool _canUseRoomGhostMode = false;
  int _roomGhostRequiredVipLevel = 5;
  RoomInsights? _roomInsights;
  bool _loadingRoomInsights = false;
  bool _changingRoomFollow = false;
  bool _changingRoomFavorite = false;
  RoomSeatState? _roomSeatState;
  bool _changingSeat = false;
  bool _micActionInFlight = false;
  RoomModeratorState? _roomModeratorState;
  StreamSubscription<Map<String, dynamic>>? _roomLiveSubscription;
  RoomRocketState? _bootstrapRocketState;
  List<GameCatalogEntry>? _bootstrapGames;
  bool _roomClosedHandled = false;
  bool _initialGameOpened = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_voiceStarted) return;
    _voiceStarted = true;
    unawaited(_connectVoice());
  }

  Future<void> _connectVoice() async {
    if (const bool.fromEnvironment('E2E_ROOM_TEST')) {
      if (!mounted) return;
      setState(() {
        _roomArguments = <String, dynamic>{
          'roomId': 'e2e_room',
          'publicId': '123456',
          'name': 'غرفة Shadow التجريبية',
          'title': 'غرفة Shadow التجريبية',
          'ownerUid': 'owner_e2e',
          'roomType': 'agency',
          'type': 'agency',
          'agencyId': '123456',
          'onlineCount': 18,
          'chatEnabled': true,
          'level': 5,
        };
        _ownerDisplayName = 'Ashraf';
        _ownerPhotoUrl = '';
        _ownerLocation = 'AE';
        _voiceJoining = false;
        _voiceMicMuted = true;
        _voiceError = null;
        _roomModeratorState = const RoomModeratorState(
          roomId: 'e2e_room',
          isOwner: true,
          limit: 5,
          myCapabilities: {
            'manageMic',
            'moderateUsers',
            'moderateChat',
            'manageMusic',
            'manageMusicPolicy',
            'managePk',
            'manageIds',
          },
          moderators: [],
        );
        _roomSeatState = RoomSeatState(
          roomId: 'e2e_room',
          seats: const [
            VoiceSeat(index: 0, uid: 'u1', displayName: 'Shadow', profileImageUrl: '', muted: false, starBattleCoins: 12000),
            VoiceSeat(index: 1, uid: 'u2', displayName: 'Ashraf', profileImageUrl: '', muted: true, starBattleCoins: 8400),
            VoiceSeat(index: 2, uid: 'u3', displayName: 'Lina', profileImageUrl: '', muted: false, starBattleCoins: 2200),
            VoiceSeat(index: 3, uid: '', displayName: '', profileImageUrl: '', muted: true),
            VoiceSeat(index: 4, uid: '', displayName: '', profileImageUrl: '', muted: true),
            VoiceSeat(index: 5, uid: '', displayName: '', profileImageUrl: '', muted: true),
            VoiceSeat(index: 6, uid: '', displayName: '', profileImageUrl: '', muted: true),
            VoiceSeat(index: 7, uid: '', displayName: '', profileImageUrl: '', muted: true),
            VoiceSeat(index: 8, uid: '', displayName: '', profileImageUrl: '', muted: true),
            VoiceSeat(index: 9, uid: '', displayName: '', profileImageUrl: '', muted: true),
            VoiceSeat(index: 10, uid: '', displayName: '', profileImageUrl: '', muted: true),
            VoiceSeat(index: 11, uid: '', displayName: '', profileImageUrl: '', muted: true),
            VoiceSeat(index: 12, uid: '', displayName: '', profileImageUrl: '', muted: true),
            VoiceSeat(index: 13, uid: '', displayName: '', profileImageUrl: '', muted: true),
            VoiceSeat(index: 14, uid: '', displayName: '', profileImageUrl: '', muted: true),
            VoiceSeat(index: 15, uid: '', displayName: '', profileImageUrl: '', muted: true),
            VoiceSeat(index: 16, uid: '', displayName: '', profileImageUrl: '', muted: true),
            VoiceSeat(index: 17, uid: '', displayName: '', profileImageUrl: '', muted: true),
            VoiceSeat(index: 18, uid: '', displayName: '', profileImageUrl: '', muted: true),
            VoiceSeat(index: 19, uid: '', displayName: '', profileImageUrl: '', muted: true),
          ],
          micInvites: const [],
          micRequests: const ['request_1', 'request_2'],
          micInviteOnly: true,
          starBattleActive: true,
          isOwner: true,
          isActive: true,
          onlineCount: 18,
        );
        _roomInsights = const RoomInsights(
          roomId: 'e2e_room',
          level: 5,
          levelPoints: 18600,
          levelTarget: 25000,
          followerCount: 320,
          followed: true,
          favorited: true,
          dailySupport: 18500,
          weeklySupport: 64200,
          monthlySupport: 241000,
          activityScore: 950,
          dailyRank: 4,
          supporters: [
            RoomSupporter(uid: 's1', rank: 1, displayName: 'A', profileImageUrl: '', totalSupport: 10000, dailySupport: 10000),
            RoomSupporter(uid: 's2', rank: 2, displayName: 'B', profileImageUrl: '', totalSupport: 6000, dailySupport: 6000),
            RoomSupporter(uid: 's3', rank: 3, displayName: 'C', profileImageUrl: '', totalSupport: 2500, dailySupport: 2500),
          ],
          ranking: [],
        );
      });
      if (const bool.fromEnvironment('E2E_GAME_TEST')) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (!mounted) return;
          unawaited(_showRoomGameOverlay(initialGameKey: 'greedy_cat'));
        });
      }
      return;
    }
    final raw = ModalRoute.of(context)?.settings.arguments;
    final args = raw is Map ? Map<String, dynamic>.from(raw) : <String, dynamic>{};
    _roomArguments = args;
    final fallbackOwnerName =
        (args['hostName'] ?? args['ownerName'] ?? '').toString().trim();
    if (fallbackOwnerName.isNotEmpty) {
      _ownerDisplayName = fallbackOwnerName;
    }
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

    final authDisplayName = (user.displayName ?? '').trim();
    final emailName = (user.email ?? '').trim();
    final displayName = authDisplayName.isNotEmpty
        ? authDisplayName
        : emailName.contains('@')
            ? emailName.split('@').first
            : 'مستخدم Shadow Live';

    try {
      await _voiceSession.join({
        ...args,
        'roomId': roomId,
        'displayName': displayName.isEmpty ? 'Shadow Live' : displayName,
      });
      if (mounted) {
        setState(() {
          _voiceJoining = _voiceSession.joining;
          _voiceError = _voiceSession.error;
          _voiceMicMuted = _voiceSession.micMuted;
        });
      }
      unawaited(_roomActions.recordRoomVisit(roomId));
      unawaited(_watchRoomLiveState(roomId));
      unawaited(_loadRoomBootstrap(roomId));
      _openInitialGameIfNeeded(args);
    } catch (error) {
      if (mounted) {
        final code = error.toString();
        setState(() {
          _voiceJoining = false;
          _voiceError = code;
        });
        if (code.contains('room_password_invalid') ||
            code.contains('room_password_required')) {
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (!mounted) return;
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text(
                  code.contains('room_password_invalid')
                      ? 'كلمة مرور الغرفة غير صحيحة.'
                      : 'هذه الغرفة تحتاج كلمة مرور.',
                ),
              ),
            );
            Navigator.of(context).maybePop();
          });
        } else if (code.contains('room_unavailable')) {
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (!mounted) return;
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(
                content: Text('هذه الغرفة غير متاحة حالياً.'),
              ),
            );
            Navigator.of(context).maybePop();
          });
        }
      }
    }
  }

  bool get _currentUserCanSpeak {
    final uid = FirebaseAuth.instance.currentUser?.uid ?? '';
    final state = _roomSeatState;
    if (state?.isOwner == true) return true;
    return state?.seats.any((seat) => seat.uid == uid) == true;
  }

  Future<void> _toggleVoiceMic() async {
    if (_micActionInFlight) return;
    _micActionInFlight = true;
    try {
      await _performToggleVoiceMic();
    } finally {
      _micActionInFlight = false;
    }
  }

  Future<void> _performToggleVoiceMic() async {
    if (_voiceJoining || _voiceError != null) return;
    final uid = FirebaseAuth.instance.currentUser?.uid ?? '';
    final state = _roomSeatState;
    final roomId = (_roomArguments['roomId'] ?? '').toString();
    final hasSeat =
        state?.seats.any((seat) => seat.uid == uid) == true;
    final canSpeak = state?.isOwner == true || hasSeat;

    if (!canSpeak) {
      if (state == null) return;

      final customerService = _isCustomerServiceRoom;
      final canTakeDirectly = state.isHost ||
          state.canManageMic ||
          (!customerService && !state.micInviteOnly) ||
          state.invited(uid);
      if (canTakeDirectly) {
        final emptySeats = state.seats
            .where(
              (seat) =>
                  !seat.occupied &&
                  (!customerService ||
                      state.isHost ||
                      state.canManageMic ||
                      seat.index >= 2),
            )
            .toList();
        if (emptySeats.isEmpty) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('لا يوجد مايك متاح حالياً.')),
          );
          return;
        }
        final taken = await _runSeatAction(
          () => _roomSeatService.takeSeat(
            roomId: roomId,
            seatIndex: emptySeats.first.index,
          ),
        );
        // A failed seat action must never open the live microphone.
        if (taken == null ||
            !(taken.isOwner ||
                taken.seats.any((seat) => seat.uid == uid))) {
          return;
        }
        // A newly occupied seat starts server-muted. Acknowledge unmute
        // through the existing seat endpoint BEFORE enabling live audio.
        final opened = await _runSeatAction(
          () => _roomSeatService.setSeatMuted(
            roomId: roomId,
            muted: false,
          ),
        );
        if (opened == null ||
            !opened.seats.any(
              (seat) => seat.uid == uid && !seat.muted,
            )) {
          return;
        }
        try {
          await _voiceSession.setMicMuted(false);
          if (mounted) setState(() => _voiceMicMuted = false);
        } catch (_) {
          // Keep server mic accounting in sync if ZEGO refuses to unmute.
          await _runSeatAction(
            () => _roomSeatService.setSeatMuted(
              roomId: roomId,
              muted: true,
            ),
          );
        }
        return;
      }

      if (state.requested(uid)) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('طلب المايك ما زال قيد الانتظار.')),
        );
      } else {
        await _runSeatAction(() => _roomSeatService.requestMic(roomId));
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('تم إرسال طلب المايك للإدارة.')),
          );
        }
      }
      return;
    }

    try {
      final muted = !_voiceSession.micMuted;
      // Muting is immediate for safety. Unmuting must be acknowledged by
      // the existing seat authority before opening the local microphone.
      if (muted) {
        await _voiceSession.setMicMuted(true);
      }
      if (hasSeat && roomId.isNotEmpty) {
        final updated = await _runSeatAction(
          () => _roomSeatService.setSeatMuted(
            roomId: roomId,
            muted: muted,
          ),
        );
        if (updated == null ||
            !updated.seats.any(
              (seat) => seat.uid == uid && seat.muted == muted,
            )) {
          return;
        }
      }
      if (!muted) {
        try {
          await _voiceSession.setMicMuted(false);
        } catch (_) {
          if (hasSeat && roomId.isNotEmpty) {
            await _runSeatAction(
              () => _roomSeatService.setSeatMuted(
                roomId: roomId,
                muted: true,
              ),
            );
          }
          rethrow;
        }
      }
      if (mounted) {
        setState(() => _voiceMicMuted = muted);
      }
    } catch (error) {
      if (mounted) setState(() => _voiceError = error.toString());
    }
  }

  Future<void> _leaveVoiceRoom() async {
    final uid = FirebaseAuth.instance.currentUser?.uid ?? '';
    final roomId = (_roomArguments['roomId'] ?? '').toString();
    final hasSeat =
        _roomSeatState?.seats.any((seat) => seat.uid == uid) == true;
    if (hasSeat && roomId.isNotEmpty) {
      try {
        await _roomSeatService.leaveSeat(roomId);
      } catch (_) {}
    }
    await _voiceSession.leave();
    if (mounted) {
      Navigator.of(context).pushAndRemoveUntil(
        MaterialPageRoute(
          builder: (_) => const MainShellScreen(initialNavIndex: 1),
        ),
        (_) => false,
      );
    }
  }

  Future<void> _minimizeVoiceRoom({int destinationNavIndex = 1}) async {
    if (!_voiceSession.active) return;
    _voiceSession.minimize();
    if (!mounted) return;
    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(
        builder: (_) => MainShellScreen(
          initialNavIndex: destinationNavIndex,
        ),
      ),
      (_) => false,
    );
  }

  Future<void> _closePersonalRoom() async {
    final roomId = (_roomArguments['roomId'] ?? '').toString();
    if (roomId.isEmpty) return;
    try {
      await _roomActions.closePersonalRoom(roomId);
      await _leaveVoiceRoom();
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تعذر إغلاق الغرفة حالياً.')),
      );
    }
  }

  String get _ownerFlag {
    final location = _ownerLocation.trim();
    if (location.isEmpty) return '';
    final emojiMatch = RegExp(
      r'^[\u{1F1E6}-\u{1F1FF}]{2}',
      unicode: true,
    ).firstMatch(location);
    if (emojiMatch != null) return emojiMatch.group(0) ?? '';

    final codeMatch = RegExp(r'\\b([A-Za-z]{2})\\b').firstMatch(location);
    final code = codeMatch?.group(1)?.toUpperCase() ?? '';
    if (code.length != 2) return '';
    final first = 0x1F1E6 + code.codeUnitAt(0) - 65;
    final second = 0x1F1E6 + code.codeUnitAt(1) - 65;
    return String.fromCharCodes([first, second]);
  }

  Future<void> _loadOwnerProfile(
    Map<String, dynamic> args,
  ) async {
    final ownerUid = (args['ownerUid'] ??
            args['ownerId'] ??
            args['hostId'] ??
            '')
        .toString()
        .trim();
    final current = FirebaseAuth.instance.currentUser;
    var fallback = (args['hostName'] ?? args['ownerName'] ?? '').toString();
    if (fallback.trim().isEmpty && current?.uid == ownerUid) {
      fallback = current?.displayName ?? '';
    }
    if (fallback.trim().isNotEmpty && mounted) {
      setState(() => _ownerDisplayName = fallback.trim());
    }
    if (ownerUid.isEmpty) return;

    try {
      final snap = await FirebaseFirestore.instance
          .collection('public_profiles')
          .doc(ownerUid)
          .get();
      final data = snap.data();
      if (!mounted || data == null) return;
      setState(() {
        final name =
            (data['displayName'] ?? data['username'] ?? '').toString().trim();
        if (name.isNotEmpty) _ownerDisplayName = name;
        _ownerPhotoUrl =
            (data['profileImageUrl'] ?? data['photoUrl'] ?? '').toString();
        _ownerLocation = (data['location'] ?? '').toString();
      });
    } catch (_) {}
  }

  Future<void> _loadRoomInsights(String roomId) async {
    if (roomId.isEmpty || _loadingRoomInsights) return;
    if (mounted) setState(() => _loadingRoomInsights = true);
    try {
      final insights = await _roomInsightsService.load(roomId);
      if (mounted) setState(() => _roomInsights = insights);
    } catch (_) {
      // Voice remains available even if non-critical room insights fail.
    } finally {
      if (mounted) setState(() => _loadingRoomInsights = false);
    }
  }

  Future<void> _loadRoomBootstrap(String roomId) async {
    if (roomId.isEmpty) return;
    if (mounted) setState(() => _loadingRoomInsights = true);
    try {
      final snapshot = await _roomBootstrapService.load(roomId);
      if (!mounted ||
          (_roomArguments['roomId'] ?? '').toString().trim() != roomId) {
        return;
      }

      _voiceSession.applyBootstrapRoom(snapshot.room);
      final owner = snapshot.ownerProfile;
      final ownerName =
          (owner['displayName'] ?? '').toString().trim();
      final ownerPhoto =
          (owner['profileImageUrl'] ?? '').toString().trim();
      final ownerLocation =
          (owner['location'] ?? '').toString().trim();

      setState(() {
        _roomArguments = <String, dynamic>{
          ..._roomArguments,
          ...snapshot.room,
        };
        if (ownerName.isNotEmpty) _ownerDisplayName = ownerName;
        _ownerPhotoUrl = ownerPhoto;
        _ownerLocation = ownerLocation;
        _roomSeatState = snapshot.seatState;
        _roomModeratorState = snapshot.moderatorState;
        _roomInsights = snapshot.insights;
        _bootstrapRocketState = snapshot.rocketState;
        _bootstrapGames = snapshot.games;
      });
      _applyRoomSeatSafety(snapshot.seatState);
      unawaited(_refreshRoomGhostMode());
    } catch (_) {
      // Voice/audio stay independent. The shared room snapshot stream keeps
      // seats/moderators live even when the non-critical bootstrap is blocked.
    } finally {
      if (mounted) setState(() => _loadingRoomInsights = false);
    }
  }

  void _applyRoomSeatSafety(RoomSeatState state) {
    final uid = FirebaseAuth.instance.currentUser?.uid ?? '';
    final hasSeat = state.seats.any((seat) => seat.uid == uid);
    if (!state.isOwner && !hasSeat && !_voiceSession.micMuted && _voiceSession.active) {
      unawaited(_voiceSession.setMicMuted(true));
    }
    if (!state.isActive && _voiceSession.active) {
      unawaited(_voiceSession.leave());
    }
  }

  Future<void> _watchRoomLiveState(String roomId) async {
    if (roomId.isEmpty) return;
    await _roomLiveSubscription?.cancel();
    _roomLiveSubscription = _voiceSession.roomStateEvents
        .where(
          (data) =>
              (data['roomId'] ?? '').toString().trim() == roomId,
        )
        .listen(
      (data) {
        if (!mounted) return;
        final onlineCount =
            (_voiceSession.roomArguments['onlineCount'] as num?)?.toInt();
        final previousModeratorState = _roomModeratorState;
        final globalRoomManage =
            previousModeratorState?.globalRoomManage == true;
        final seatState = _roomSeatService.fromRoomData(
          roomId,
          data,
          onlineCountOverride: onlineCount,
          globalManageMic: globalRoomManage,
        );
        final rawModeratorState =
            _roomModeratorService.fromRoomData(roomId, data);
        final moderatorState = rawModeratorState.copyWithPlatformAccess(
          platformOwner: previousModeratorState?.platformOwner == true,
          ownerAbsoluteRoomAccess:
              previousModeratorState?.ownerAbsoluteRoomAccess == true,
          globalRoomManage: globalRoomManage,
          authoritySuppressed:
              previousModeratorState?.authoritySuppressed == true,
        );
        setState(() {
          _roomArguments = <String, dynamic>{
            ..._roomArguments,
            ...data,
            if (onlineCount != null) 'onlineCount': onlineCount,
            if (onlineCount != null) 'participantsCount': onlineCount,
          };
          _roomSeatState = seatState;
          _roomModeratorState = moderatorState;
        });
        _applyRoomSeatSafety(seatState);
      },
      onError: (_) {},
    );
  }

  Future<void> _toggleRoomFavorite() async {
    final roomId = (_roomArguments['roomId'] ?? '').toString().trim();
    final current = _roomInsights;
    if (roomId.isEmpty ||
        current == null ||
        _changingRoomFavorite) {
      return;
    }

    setState(() => _changingRoomFavorite = true);
    try {
      final updated = await _roomInsightsService.setFavorite(
        roomId: roomId,
        favorite: !current.favorited,
      );
      if (mounted) setState(() => _roomInsights = updated);
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('تعذر تحديث مفضلة الغرفة حالياً.'),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _changingRoomFavorite = false);
    }
  }

  Future<void> _toggleRoomFollow() async {
    final roomId = (_roomArguments['roomId'] ?? '').toString().trim();
    final current = _roomInsights;
    if (roomId.isEmpty || current == null || _changingRoomFollow) return;

    setState(() => _changingRoomFollow = true);
    try {
      final updated = await _roomInsightsService.setFollowing(
        roomId: roomId,
        following: !current.followed,
      );
      if (mounted) setState(() => _roomInsights = updated);
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('تعذر تحديث متابعة الغرفة حالياً.')),
        );
      }
    } finally {
      if (mounted) setState(() => _changingRoomFollow = false);
    }
  }


  Future<void> _refreshRoomGhostMode() async {
    try {
      final state = await _roomActions.loadGhostState();
      if (mounted) {
        setState(() {
          _roomGhostMode = state.ghostMode;
          _canUseRoomGhostMode = state.canUseGhostMode;
          _roomGhostRequiredVipLevel = state.requiredVipLevel;
        });
      }
    } catch (_) {
      // Non-critical user preference; Room Menu must never wait on this.
    }
  }

  bool get _roomAuthoritySuppressed =>
      (_roomModeratorState?.authoritySuppressed == true) ||
      (_voiceSession.mysteriousModeEnabled &&
          _roomModeratorState?.platformOwner != true);

  bool get _canManageMic =>
      !_roomAuthoritySuppressed && (_voiceSession.isOwner ||
      (_roomModeratorState?.has('manageMic') ?? false));

  bool get _canModerateUsers =>
      !_roomAuthoritySuppressed &&
      (_voiceSession.isOwner ||
          (_roomModeratorState?.has('moderateUsers') ?? false));

  bool get _canModerateChat =>
      !_roomAuthoritySuppressed &&
      (_voiceSession.isOwner ||
          (_roomModeratorState?.has('moderateChat') ?? false));

  bool get _canManageMusic =>
      !_roomAuthoritySuppressed &&
      (_voiceSession.isOwner ||
          (_roomModeratorState?.has('manageMusic') ?? false));

  bool get _canManageMusicPolicy =>
      !_roomAuthoritySuppressed &&
      (_voiceSession.isOwner ||
          (_roomModeratorState?.has('manageMusicPolicy') ?? false));

  bool get _canManagePk =>
      !_roomAuthoritySuppressed &&
      (_voiceSession.isOwner ||
          (_roomModeratorState?.has('managePk') ?? false));

  bool get _canManageIds =>
      !_roomAuthoritySuppressed &&
      (_voiceSession.isOwner ||
          (_roomModeratorState?.has('manageIds') ?? false));

  Future<void> _showRoomModeratorsSheet() async {
    final roomId = (_roomArguments['roomId'] ?? '').toString().trim();
    if (roomId.isEmpty) return;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF0C101A),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(26)),
      ),
      builder: (_) => RoomModeratorManagerSheet(roomId: roomId),
    );
  }


  Future<RoomSeatState?> _runSeatAction(
    Future<RoomSeatState> Function() action,
  ) async {
    if (_changingSeat) return null;
    setState(() => _changingSeat = true);
    try {
      final state = await action();
      if (!mounted) return null;
      setState(() => _roomSeatState = state);
      // Reuse the existing seat safety check on an acknowledged mutation
      // instead of waiting for a second network snapshot.
      _applyRoomSeatSafety(state);
      return state;
    } on StateError catch (error) {
      if (!mounted) return null;
      final code = error.message.toString();
      final message = code == 'mic_invite_required'
          ? 'لازم الإدارة توافق على طلب المايك أولاً.'
          : code == 'mic_invite_expired'
              ? 'انتهت دعوة المايك. اطلب دعوة جديدة.'
              : code == 'customer_service_manager_mic_required'
                  ? 'هذا المايك مخصص للإدارة.'
                  : code == 'seat_occupied'
                      ? 'هذا المقعد مستخدم حالياً.'
                      : code == 'seat_locked'
                          ? 'هذا المايك مقفل من الإدارة.'
                          : code == 'seat_mute_locked'
                              ? 'هذا المايك مكتوم إجباريًا من الإدارة.'
                      : 'تعذر تنفيذ العملية حالياً.';
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(message)),
      );
      return null;
    } finally {
      if (mounted) setState(() => _changingSeat = false);
    }
  }

  Future<void> _showSeatQuickProfile(VoiceSeat seat) async {
    if (!seat.occupied || seat.uid.isEmpty) return;
    final roomId = (_roomArguments['roomId'] ?? '').toString();
    final actions = <QuickProfileAction>[];

    if ((_canManageMic || _canModerateUsers) &&
        seat.uid != (FirebaseAuth.instance.currentUser?.uid ?? '')) {
      if (_canManageMic) {
        actions.add(
          QuickProfileAction(
            icon: seat.muted ? Icons.mic_rounded : Icons.mic_off_rounded,
            label: seat.muted ? 'إزالة كتم المايك' : 'كتم المايك',
            color: const Color(0xFFFFD54A),
            onTap: () {
              unawaited(
                _runSeatAction(
                  () => _roomSeatService.setTargetSeatMuted(
                    roomId: roomId,
                    targetUid: seat.uid,
                    muted: !seat.muted,
                  ),
                ),
              );
            },
          ),
        );
        actions.add(
          QuickProfileAction(
            icon: Icons.person_remove_rounded,
            label: 'إنزال من المايك',
            color: Colors.orangeAccent,
            onTap: () {
              unawaited(
                _runSeatAction(
                  () => _roomSeatService.removeFromMic(
                    roomId: roomId,
                    targetUid: seat.uid,
                  ),
                ),
              );
            },
          ),
        );
      }
      if (_canModerateUsers) {
        actions.add(
          QuickProfileAction(
            icon: Icons.block_rounded,
            label: 'طرد / حظر من الغرفة',
            color: Colors.redAccent,
            onTap: () => _showKickOptions(seat),
          ),
        );
      }
    }

    if (seat.mysteriousMode) {
      await showMysteriousIdentitySheet(
        context,
        mysteriousId: seat.mysteriousId,
        actions: actions
            .map(
              (action) => MysteriousIdentityAction(
                icon: action.icon,
                label: action.label,
                color: action.color,
                onTap: action.onTap,
              ),
            )
            .toList(growable: false),
      );
      return;
    }

    await showQuickProfileSheet(
      context,
      userId: seat.uid,
      adminActions: actions,
    );
  }

  Future<void> _selectVacantRoomSeat(
    VoiceSeat seat,
    RoomSeatState state,
  ) async {
    if (!mounted || _changingSeat) return;
    final roomId = (_roomArguments['roomId'] ?? '').toString();
    final uid = FirebaseAuth.instance.currentUser?.uid ?? '';
    if (roomId.isEmpty || uid.isEmpty) return;
    if (seat.locked) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('هذا المايك مقفل من الإدارة.')),
      );
      return;
    }
    final hasSeat = state.seats.any((current) => current.uid == uid);
    if (_isCustomerServiceRoom &&
        seat.index < 2 &&
        !state.isHost &&
        !state.canManageMic) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('هذا المايك مخصص للإدارة.')),
      );
      return;
    }

    if (hasSeat) {
      await _runSeatAction(
        () => _roomSeatService.switchSeat(
          roomId: roomId,
          seatIndex: seat.index,
        ),
      );
    } else if (state.isOwner ||
        state.isHost ||
        state.canManageMic ||
        state.invited(uid) ||
        (!_isCustomerServiceRoom && !state.micInviteOnly)) {
      await _runSeatAction(
        () => _roomSeatService.takeSeat(
          roomId: roomId,
          seatIndex: seat.index,
        ),
      );
    } else if (state.requested(uid)) {
      await _runSeatAction(
        () => _roomSeatService.cancelMicRequest(roomId),
      );
    } else {
      await _runSeatAction(
        () => _roomSeatService.requestMic(roomId),
      );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('تم إرسال طلب المايك للإدارة.')),
        );
      }
    }
  }

  Future<void> _showVacantRoomSeatOptions(VoiceSeat seat) async {
    final state = _roomSeatState;
    if (state == null || !mounted) return;
    final roomId = (_roomArguments['roomId'] ?? '').toString();
    if (roomId.isEmpty) return;
    final manage = _canManageMic && state.canManageMic;

    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: const Color(0xFF111522),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (sheetContext) => Directionality(
        textDirection: TextDirection.rtl,
        child: SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 20),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  'خيارات المايك ${seat.index + 1}',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 17,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 10),
                if (!seat.locked)
                  ListTile(
                    leading: const Icon(
                      Icons.mic_external_on_rounded,
                      color: Color(0xFFFFD54A),
                    ),
                    title: Text(
                      state.seats.any((item) =>
                              item.uid ==
                              (FirebaseAuth.instance.currentUser?.uid ?? ''))
                          ? 'الانتقال إلى هذا المايك'
                          : 'الصعود إلى هذا المايك',
                      style: const TextStyle(color: Colors.white),
                    ),
                    onTap: () {
                      Navigator.pop(sheetContext);
                      unawaited(_selectVacantRoomSeat(seat, state));
                    },
                  )
                else
                  const ListTile(
                    leading: Icon(Icons.lock_rounded, color: Colors.orangeAccent),
                    title: Text(
                      'هذا المايك مقفل من الإدارة',
                      style: TextStyle(color: Colors.white70),
                    ),
                  ),
                if (manage) ...[
                  const Divider(height: 1, color: Colors.white12),
                  ListTile(
                    leading: Icon(
                      seat.locked
                          ? Icons.lock_open_rounded
                          : Icons.lock_rounded,
                      color: const Color(0xFFFFD54A),
                    ),
                    title: Text(
                      seat.locked ? 'فتح قفل المايك' : 'قفل المايك',
                      style: const TextStyle(color: Colors.white),
                    ),
                    onTap: () {
                      Navigator.pop(sheetContext);
                      unawaited(_runSeatAction(
                        () => _roomSeatService.setSeatLocked(
                          roomId: roomId,
                          seatIndex: seat.index,
                          locked: !seat.locked,
                        ),
                      ));
                    },
                  ),
                  ListTile(
                    leading: Icon(
                      seat.muteLocked
                          ? Icons.mic_rounded
                          : Icons.mic_off_rounded,
                      color: Colors.orangeAccent,
                    ),
                    title: Text(
                      seat.muteLocked
                          ? 'إلغاء الكتم الإجباري للمايك'
                          : 'كتم المايك إجباريًا',
                      style: const TextStyle(color: Colors.white),
                    ),
                    subtitle: const Text(
                      'لا يستطيع الجالس فتح الصوت حتى تفك الإدارة الكتم.',
                      style: TextStyle(color: Colors.white54, fontSize: 11),
                    ),
                    onTap: () {
                      Navigator.pop(sheetContext);
                      unawaited(_runSeatAction(
                        () => _roomSeatService.setSeatMuteLocked(
                          roomId: roomId,
                          seatIndex: seat.index,
                          muteLocked: !seat.muteLocked,
                        ),
                      ));
                    },
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }

  Future<void> _handleSeatTap(VoiceSeat seat) async {
    final roomId = (_roomArguments['roomId'] ?? '').toString();
    final uid = FirebaseAuth.instance.currentUser?.uid ?? '';
    final state = _roomSeatState;
    if (roomId.isEmpty || uid.isEmpty || state == null) return;

    if (!seat.occupied) {
      await _showVacantRoomSeatOptions(seat);
      return;
    }

    if (seat.uid == uid) {
      await showModalBottomSheet<void>(
        context: context,
        backgroundColor: const Color(0xFF111522),
        builder: (sheetContext) => SafeArea(
          child: ListTile(
            leading: const Icon(Icons.mic_off_rounded, color: Colors.redAccent),
            title: const Text(
              'النزول من المايك',
              style: TextStyle(color: Colors.white),
            ),
            onTap: () {
              Navigator.pop(sheetContext);
              unawaited(() async {
                // Stop local audio before waiting for the seat release.
                try {
                  await _voiceSession.setMicMuted(true);
                } catch (_) {}
                await _runSeatAction(
                  () => _roomSeatService.leaveSeat(roomId),
                );
              }());
            },
          ),
        ),
      );
      return;
    }

    await _showSeatQuickProfile(seat);
  }

  Future<void> _showKickOptions(VoiceSeat seat) async {
    final roomId = (_roomArguments['roomId'] ?? '').toString();
    if (roomId.isEmpty || seat.uid.isEmpty) return;

    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: const Color(0xFF111522),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (sheetContext) => Directionality(
        textDirection: TextDirection.rtl,
        child: SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 18),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  'طرد ' +
                      (seat.displayName.isEmpty
                          ? 'المستخدم'
                          : seat.displayName),
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w900,
                    fontSize: 18,
                  ),
                ),
                const SizedBox(height: 10),
                ...const [
                  ('1', 'دقيقة واحدة'),
                  ('5', '5 دقائق'),
                  ('15', '15 دقيقة'),
                  ('30', '30 دقيقة'),
                  ('10080', 'أسبوع'),
                  ('permanent', 'نهائي'),
                ].map(
                  (option) => ListTile(
                    leading: Icon(
                      option.$1 == 'permanent'
                          ? Icons.block_rounded
                          : Icons.timer_outlined,
                      color: option.$1 == 'permanent'
                          ? Colors.redAccent
                          : const Color(0xFFFFD54A),
                    ),
                    title: Text(
                      option.$2,
                      style: TextStyle(
                        color: option.$1 == 'permanent'
                            ? Colors.redAccent
                            : Colors.white,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    onTap: () async {
                      Navigator.pop(sheetContext);
                      try {
                        await _roomModeration.kick(
                          roomId: roomId,
                          targetUid: seat.uid,
                          duration: option.$1,
                        );
                        if (mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(
                              content: Text(
                                'تم طرد المستخدم لمدة ' + option.$2 + '.',
                              ),
                            ),
                          );
                        }
                      } on StateError catch (error) {
                        if (!mounted) return;
                        final code = error.message.toString();
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(
                            content: Text(
                              code == 'owner_protected'
                                  ? 'لا يمكن طرد صاحب الغرفة.'
                                  : code == 'vip_kick_protected'
                                      ? 'هذا المستخدم محمي من الطرد بميزة VIP6+.'
                                      : 'تعذر طرد المستخدم حالياً.',
                            ),
                          ),
                        );
                      }
                    },
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Future<void> _showRoomBansSheet() async {
    final roomId = (_roomArguments['roomId'] ?? '').toString();
    if (roomId.isEmpty || !_canModerateUsers) return;

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF0C101A),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(26)),
      ),
      builder: (sheetContext) => Directionality(
        textDirection: TextDirection.rtl,
        child: SafeArea(
          child: SizedBox(
            height: MediaQuery.of(sheetContext).size.height * .62,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 14, 16, 18),
              child: Column(
                children: [
                  Container(
                    width: 44,
                    height: 4,
                    decoration: BoxDecoration(
                      color: Colors.white24,
                      borderRadius: BorderRadius.circular(99),
                    ),
                  ),
                  const SizedBox(height: 14),
                  const Row(
                    children: [
                      Icon(
                        Icons.block_rounded,
                        color: Colors.redAccent,
                      ),
                      SizedBox(width: 8),
                      Text(
                        'المحظورون من الغرفة',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 19,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  Expanded(
                    child: FutureBuilder<List<RoomBanEntry>>(
                      future: _roomModeration.loadBans(roomId),
                      builder: (context, snapshot) {
                        if (snapshot.connectionState !=
                            ConnectionState.done) {
                          return const Center(
                            child: CircularProgressIndicator(
                              color: Color(0xFF8A3DFF),
                            ),
                          );
                        }
                        final bans = snapshot.data ?? const [];
                        if (bans.isEmpty) {
                          return const Center(
                            child: Text(
                              'لا يوجد مستخدمون محظورون حالياً',
                              style: TextStyle(color: Colors.white54),
                            ),
                          );
                        }
                        return ListView.separated(
                          itemCount: bans.length,
                          separatorBuilder: (_, __) =>
                              const Divider(color: Colors.white10),
                          itemBuilder: (_, index) {
                            final ban = bans[index];
                            return ListTile(
                              contentPadding: EdgeInsets.zero,
                              leading: ProfileAvatarWithFrame(
                                diameter: 40,
                                userId: ban.uid,
                                backgroundColor:
                                    const Color(0xFF25183F),
                                placeholderColor: Colors.white54,
                                fallbackProfile: <String, dynamic>{
                                  'profileImageUrl': ban.profileImageUrl,
                                  'profileAvatarAsset': ban.profileAvatarAsset,
                                  'activeProfileFrameAssetKey':
                                      ban.activeProfileFrameAssetKey,
                                  'activeProfileFrameImageUrl':
                                      ban.activeProfileFrameImageUrl,
                                  'activeProfileFrameExpiresAtMs':
                                      ban.activeProfileFrameExpiresAtMs,
                                  'activeProfileFramePermanent':
                                      ban.activeProfileFramePermanent,
                                },
                                fallbackIsVisualSnapshot: true,
                              ),
                              title: Text(
                                ban.displayName,
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                              subtitle: Text(
                                (ban.permanent
                                        ? 'حظر نهائي'
                                        : 'حظر مؤقت') +
                                    (ban.blockedByName.isNotEmpty
                                        ? ' — بواسطة ' + ban.blockedByName
                                        : ''),
                                style: const TextStyle(
                                  color: Colors.white54,
                                  fontSize: 10,
                                ),
                              ),
                              trailing: TextButton(
                                onPressed: () async {
                                  try {
                                    await _roomModeration.unban(
                                      roomId: roomId,
                                      targetUid: ban.uid,
                                    );
                                    if (sheetContext.mounted) {
                                      Navigator.pop(sheetContext);
                                    }
                                    if (mounted) {
                                      ScaffoldMessenger.of(context)
                                          .showSnackBar(
                                        const SnackBar(
                                          content: Text(
                                            'تم فك الحظر عن المستخدم.',
                                          ),
                                        ),
                                      );
                                    }
                                  } catch (_) {
                                    if (sheetContext.mounted) {
                                      ScaffoldMessenger.of(sheetContext)
                                          .showSnackBar(
                                        const SnackBar(
                                          content: Text(
                                            'تعذر فك الحظر حالياً.',
                                          ),
                                        ),
                                      );
                                    }
                                  }
                                },
                                child: const Text('فك الحظر'),
                              ),
                            );
                          },
                        );
                      },
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  int get _roomAudienceTotalCount {
    // Presence is authoritative when ready. A room snapshot may be a
    // moment behind it, but the count must never show ZERO while seated
    // members are plainly visible on the stage.
    final seated = (_roomSeatState?.seats ?? const <VoiceSeat>[])
        .where((seat) => seat.occupied)
        .length;
    final reported = (_roomArguments['onlineCount'] as num?)?.toInt() ?? 0;
    return max(max(reported, _voiceSession.roomParticipants.length), seated);
  }

  Widget _buildRoomAudienceStrip() {
    // Reuse the existing owner profile and the SAME realtime participant
    // snapshot; do not create a second listener for the audience bar.
    final ownerUid = (_roomArguments['ownerUid'] ??
            _roomArguments['ownerId'] ??
            _roomArguments['hostId'] ??
            '')
        .toString()
        .trim();
    final participants = _voiceSession.roomParticipants;
    final ownerMatches = participants.where((user) => user.uid == ownerUid);
    final ownerPresence = ownerMatches.isEmpty ? null : ownerMatches.first;
    final seatedUids = (_roomSeatState?.seats ?? const <VoiceSeat>[])
        .where((seat) => seat.occupied)
        .map((seat) => seat.uid)
        .toSet();
    final listeners = participants
        .where((user) =>
            user.uid != ownerUid && !seatedUids.contains(user.uid))
        .take(ownerUid.isEmpty ? 20 : 19)
        .toList(growable: false);
    final entries = <RoomPresenceUser?>[
      if (ownerUid.isNotEmpty) ownerPresence,
      ...listeners,
    ];
    final total = _roomAudienceTotalCount;

    return SizedBox(
      height: 57,
      child: Row(
        children: [
          InkWell(
            key: const Key('room-audience-count'),
            onTap: _showRoomParticipantsSheet,
            borderRadius: BorderRadius.circular(12),
            child: Container(
              width: 58,
              padding: const EdgeInsets.symmetric(vertical: 3),
              decoration: BoxDecoration(
                color: const Color(0xFF171321).withValues(alpha: .85),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: Colors.white24),
              ),
              child: Column(
                children: [
                  const Icon(Icons.people_alt_rounded,
                      color: Color(0xFFFFD54A), size: 18),
                  Text(
                    '$total',
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 12,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const Text('الحضور',
                      style: TextStyle(color: Colors.white70, fontSize: 8)),
                ],
              ),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: entries.isEmpty
                ? const Align(
                    alignment: Alignment.centerRight,
                    child: Text('الموجودون حاليًا على المايكات فقط',
                        style: TextStyle(
                            color: Colors.white54, fontSize: 10)),
                  )
                : ListView.separated(
                    key: const Key('room-audience-strip'),
                    scrollDirection: Axis.horizontal,
                    itemCount: entries.length,
                    separatorBuilder: (_, __) => const SizedBox(width: 7),
                    itemBuilder: (context, index) {
                      final isOwnerTile = ownerUid.isNotEmpty && index == 0;
                      final user = entries[index];
                      final isMysterious = user?.mysteriousMode == true;
                      final profileUid = isOwnerTile ? ownerUid : user!.uid;
                      final profileImage = isMysterious
                          ? ''
                          : isOwnerTile
                              ? ((user?.profileImageUrl.isNotEmpty == true)
                                  ? user!.profileImageUrl
                                  : _ownerPhotoUrl)
                              : user!.profileImageUrl;
                      final frameAssetKey =
                          user?.activeProfileFrameAssetKey ?? '';
                      final frameImageUrl =
                          user?.activeProfileFrameImageUrl ?? '';
                      final frameValid = user != null &&
                          frameAssetKey.isNotEmpty &&
                          (user.activeProfileFramePermanent ||
                              user.activeProfileFrameExpiresAtMs <= 0 ||
                              user.activeProfileFrameExpiresAtMs >
                                  DateTime.now().millisecondsSinceEpoch);

                      return InkWell(
                        onTap: () {
                          if (isMysterious) {
                            showMysteriousIdentitySheet(
                              context,
                              mysteriousId: user!.mysteriousId,
                            );
                          } else {
                            showQuickProfileSheet(
                              context,
                              userId: profileUid,
                            );
                          }
                        },
                        borderRadius: BorderRadius.circular(99),
                        child: Center(
                          child: Stack(
                            clipBehavior: Clip.none,
                            alignment: Alignment.center,
                            children: [
                              isMysterious
                                  ? const MysteriousIdentityAvatar(diameter: 38)
                                  : CircleAvatar(
                                      radius: 19,
                                      backgroundColor: const Color(0xFF25183F),
                                      backgroundImage: profileImage.isEmpty
                                          ? null
                                          : NetworkImage(profileImage),
                                      child: profileImage.isEmpty
                                          ? const Icon(Icons.person_rounded,
                                              color: Colors.white70, size: 18)
                                          : null,
                                    ),
                              if (!isMysterious && frameValid)
                                Positioned(
                                  left: -5,
                                  top: -5,
                                  child: IgnorePointer(
                                    child: SizedBox.square(
                                      dimension: 48,
                                      child: CosmeticAssetVisual(
                                        assetKey: frameAssetKey,
                                        imageUrl: frameImageUrl,
                                      ),
                                    ),
                                  ),
                                ),
                              if (isOwnerTile)
                                const Positioned(
                                  right: -3,
                                  bottom: -3,
                                  child: Icon(
                                    Icons.star_rounded,
                                    size: 16,
                                    color: Color(0xFFFFD54A),
                                  ),
                                ),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }

  Future<void> _showRoomParticipantsSheet() async {
    final roomId = (_roomArguments['roomId'] ?? '').toString();
    if (roomId.isEmpty) return;
    final me = FirebaseAuth.instance.currentUser?.uid ?? '';

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF0C101A),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(26)),
      ),
      builder: (sheetContext) => Directionality(
        textDirection: TextDirection.rtl,
        child: SafeArea(
          child: SizedBox(
            height: MediaQuery.sizeOf(sheetContext).height * .66,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 14, 16, 18),
              child: Column(
                children: [
                  Container(
                    width: 44,
                    height: 4,
                    decoration: BoxDecoration(
                      color: Colors.white24,
                      borderRadius: BorderRadius.circular(99),
                    ),
                  ),
                  const SizedBox(height: 14),
                  const Row(
                    children: [
                      Icon(
                        Icons.people_alt_rounded,
                        color: Color(0xFFFFD54A),
                      ),
                      SizedBox(width: 8),
                      Text(
                        'الموجودون في الغرفة',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 19,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  Expanded(
                    child: AnimatedBuilder(
                      animation: _voiceSession,
                      builder: (context, _) {
                        final seatedUids =
                            (_roomSeatState?.seats ?? const <VoiceSeat>[])
                                .where((seat) => seat.occupied)
                                .map((seat) => seat.uid)
                                .toSet();
                        final users = _voiceSession.roomParticipants
                            .where((user) =>
                                user.uid != me &&
                                !seatedUids.contains(user.uid))
                            .toList(growable: false);
                        if (users.isEmpty) {
                          return const Center(
                            child: Text(
                              'لا يوجد مستخدمون آخرون داخل الغرفة حالياً',
                              style: TextStyle(color: Colors.white54),
                            ),
                          );
                        }
                        return ListView.separated(
                          itemCount: users.length,
                          separatorBuilder: (_, __) =>
                              const Divider(color: Colors.white10),
                          itemBuilder: (_, index) {
                            final user = users[index];
                            final seat = (_roomSeatState?.seats ??
                                    const <VoiceSeat>[])
                                .where((item) => item.uid == user.uid)
                                .fold<VoiceSeat?>(
                                  null,
                                  (found, item) => found ?? item,
                                );
                            final onMic = seat != null;
                            final invited =
                                _roomSeatState?.invited(user.uid) == true;
                            final adminActions = <QuickProfileAction>[];
                            if (_canManageMic) {
                              if (!onMic) {
                                adminActions.add(
                                  QuickProfileAction(
                                    icon: Icons.mic_external_on_rounded,
                                    label: invited
                                        ? 'تمت دعوته للمايك'
                                        : 'دعوة إلى المايك',
                                    color: const Color(0xFFFFD54A),
                                    onTap: invited
                                        ? () {}
                                        : () {
                                            unawaited(
                                              _runSeatAction(
                                                () => _roomSeatService
                                                    .inviteToMic(
                                                  roomId: roomId,
                                                  targetUid: user.uid,
                                                ),
                                              ),
                                            );
                                          },
                                  ),
                                );
                              } else {
                                adminActions.addAll([
                                  QuickProfileAction(
                                    icon: seat.muted
                                        ? Icons.mic_rounded
                                        : Icons.mic_off_rounded,
                                    label: seat.muted
                                        ? 'إزالة كتم المايك'
                                        : 'كتم المايك',
                                    color: const Color(0xFFFFD54A),
                                    onTap: () {
                                      unawaited(
                                        _runSeatAction(
                                          () => _roomSeatService
                                              .setTargetSeatMuted(
                                            roomId: roomId,
                                            targetUid: user.uid,
                                            muted: !seat.muted,
                                          ),
                                        ),
                                      );
                                    },
                                  ),
                                  QuickProfileAction(
                                    icon: Icons.person_remove_rounded,
                                    label: 'إنزال من المايك',
                                    color: Colors.orangeAccent,
                                    onTap: () {
                                      unawaited(
                                        _runSeatAction(
                                          () => _roomSeatService.removeFromMic(
                                            roomId: roomId,
                                            targetUid: user.uid,
                                          ),
                                        ),
                                      );
                                    },
                                  ),
                                ]);
                              }
                            }
                            return MysteriousRoomPresenceSkin(
                              enabled: user.mysteriousMode,
                              child: ListTile(
                              contentPadding: EdgeInsets.zero,
                              onTap: () {
                                Navigator.pop(sheetContext);
                                if (user.mysteriousMode) {
                                  showMysteriousIdentitySheet(
                                    context,
                                    mysteriousId: user.mysteriousId,
                                    actions: adminActions
                                        .map(
                                          (action) =>
                                              MysteriousIdentityAction(
                                            icon: action.icon,
                                            label: action.label,
                                            color: action.color,
                                            onTap: action.onTap,
                                          ),
                                        )
                                        .toList(growable: false),
                                  );
                                  return;
                                }
                                showQuickProfileSheet(
                                  context,
                                  userId: user.uid,
                                  adminActions: adminActions,
                                );
                              },
                              leading: user.mysteriousMode
                                  ? const MysteriousIdentityAvatar(
                                      diameter: 40,
                                    )
                                  : ProfileAvatarWithFrame(
                                      diameter: 40,
                                      userId: user.uid,
                                      backgroundColor:
                                          const Color(0xFF25183F),
                                      placeholderColor: Colors.white54,
                                      fallbackProfile: <String, dynamic>{
                                        'profileImageUrl':
                                            user.profileImageUrl,
                                        'activeProfileFrameAssetKey':
                                            user.activeProfileFrameAssetKey,
                                        'activeProfileFrameImageUrl':
                                            user.activeProfileFrameImageUrl,
                                        'activeProfileFrameExpiresAtMs':
                                            user.activeProfileFrameExpiresAtMs,
                                        'activeProfileFramePermanent':
                                            user.activeProfileFramePermanent,
                                      },
                                      fallbackIsVisualSnapshot: true,
                                      vipLevel: user.vipLevel,
                                      useVipFallback: true,
                                    ),
                              title: Text(
                                user.displayName,
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                              subtitle: const Text(
                                'موجود داخل الغرفة',
                                style: TextStyle(
                                  color: Color(0xFF39D98A),
                                  fontSize: 10,
                                ),
                              ),
                              trailing: _canManageMic
                                  ? onMic
                                      ? const Chip(
                                          label: Text('على المايك'),
                                          visualDensity:
                                              VisualDensity.compact,
                                        )
                                      : FilledButton(
                                          onPressed: invited
                                              ? null
                                              : () async {
                                                  try {
                                                    final state =
                                                        await _roomSeatService
                                                            .inviteToMic(
                                                      roomId: roomId,
                                                      targetUid: user.uid,
                                                    );
                                                    if (mounted) {
                                                      setState(
                                                        () => _roomSeatState =
                                                            state,
                                                      );
                                                    }
                                                  } catch (_) {}
                                                },
                                          style: FilledButton.styleFrom(
                                            backgroundColor:
                                                const Color(0xFF6D27D9),
                                          ),
                                          child: Text(
                                            invited ? 'مدعو' : 'دعوة',
                                          ),
                                        )
                                  : const Icon(
                                      Icons.chevron_left_rounded,
                                      color: Colors.white38,
                                    ),
                              ),
                            );
                          },
                        );
                      },
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Future<void> _showMicRequestsSheet() async {
    final state = _roomSeatState;
    if (state == null || !_canManageMic) return;
    final roomId = (_roomArguments['roomId'] ?? '').toString();
    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: const Color(0xFF111522),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (sheetContext) => Directionality(
        textDirection: TextDirection.rtl,
        child: SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 20),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text(
                  'طلبات المايك',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 19,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 12),
                if (state.micRequests.isEmpty)
                  const Padding(
                    padding: EdgeInsets.all(22),
                    child: Text(
                      'لا توجد طلبات حالياً',
                      style: TextStyle(color: Colors.white54),
                    ),
                  )
                else
                  ...state.micRequests.map(
                    (uid) => ListTile(
                      leading: const CircleAvatar(
                        backgroundColor: Color(0xFF25183F),
                        child: Icon(Icons.mic_rounded, color: Color(0xFFFFD54A)),
                      ),
                      title: FutureBuilder<
                          DocumentSnapshot<Map<String, dynamic>>>(
                        future: FirebaseFirestore.instance
                            .collection('public_profiles')
                            .doc(uid)
                            .get(),
                        builder: (context, snapshot) {
                          final data = snapshot.data?.data();
                          final name = (data?['displayName'] ??
                                  data?['username'] ??
                                  '')
                              .toString()
                              .trim();
                          return Text(
                            name.isNotEmpty
                                ? name
                                : (uid.length > 10
                                    ? uid.substring(0, 10) + '…'
                                    : uid),
                            style: const TextStyle(
                              color: Colors.white,
                              fontWeight: FontWeight.w700,
                            ),
                          );
                        },
                      ),
                      trailing: Wrap(
                        spacing: 6,
                        children: [
                          IconButton(
                            tooltip: 'رفض',
                            onPressed: () {
                              Navigator.pop(sheetContext);
                              unawaited(
                                _runSeatAction(
                                  () => _roomSeatService.rejectMicRequest(
                                    roomId: roomId,
                                    targetUid: uid,
                                  ),
                                ),
                              );
                            },
                            icon: const Icon(Icons.close_rounded, color: Colors.redAccent),
                          ),
                          IconButton(
                            tooltip: 'قبول',
                            onPressed: () {
                              Navigator.pop(sheetContext);
                              unawaited(
                                _runSeatAction(
                                  () => _roomSeatService.approveMicRequest(
                                    roomId: roomId,
                                    targetUid: uid,
                                  ),
                                ),
                              );
                            },
                            icon: const Icon(Icons.check_rounded, color: Color(0xFF39D98A)),
                          ),
                        ],
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildMicStatusBanner() {
    final state = _roomSeatState;
    final uid = FirebaseAuth.instance.currentUser?.uid ?? '';
    final roomId = (_roomArguments['roomId'] ?? '').toString();
    if (state == null || uid.isEmpty || state.isOwner) {
      return const SizedBox.shrink();
    }

    final hasSeat = state.seats.any((seat) => seat.uid == uid);
    if (hasSeat) return const SizedBox.shrink();

    if (state.invited(uid)) {
      return Container(
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
        decoration: BoxDecoration(
          color: const Color(0xFF39D98A).withValues(alpha: .12),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(
            color: const Color(0xFF39D98A).withValues(alpha: .35),
          ),
        ),
        child: Row(
          children: [
            const Icon(
              Icons.mic_rounded,
              color: Color(0xFF39D98A),
              size: 20,
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                _isCustomerServiceRoom
                    ? 'تمت دعوتك للمايك — الدعوة صالحة 60 ثانية'
                    : 'تمت دعوتك للمايك — اختر مقعداً فارغاً',
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 11,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
            TextButton(
              onPressed: _changingSeat
                  ? null
                  : () {
                      final emptySeats = state.seats
                          .where(
                            (seat) =>
                                !seat.occupied &&
                                (!_isCustomerServiceRoom ||
                                    state.isHost ||
                                    state.canManageMic ||
                                    seat.index >= 2),
                          )
                          .toList();
                      if (emptySeats.isEmpty) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                            content: Text('لا يوجد مقعد فارغ حالياً.'),
                          ),
                        );
                        return;
                      }
                      unawaited(
                        _runSeatAction(
                          () => _roomSeatService.takeSeat(
                            roomId: roomId,
                            seatIndex: emptySeats.first.index,
                          ),
                        ),
                      );
                    },
              child: const Text('قبول'),
            ),
            TextButton(
              onPressed: _changingSeat
                  ? null
                  : () => _runSeatAction(
                        () => _roomSeatService.declineMicInvite(roomId),
                      ),
              child: const Text('رفض'),
            ),
          ],
        ),
      );
    }

    if (state.requested(uid)) {
      return Container(
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
        decoration: BoxDecoration(
          color: const Color(0xFFFFD54A).withValues(alpha: .10),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(
            color: const Color(0xFFFFD54A).withValues(alpha: .30),
          ),
        ),
        child: Row(
          children: [
            const Icon(
              Icons.hourglass_top_rounded,
              color: Color(0xFFFFD54A),
              size: 19,
            ),
            const SizedBox(width: 8),
            const Expanded(
              child: Text(
                'طلب المايك قيد الانتظار',
                style: TextStyle(
                  color: Colors.white70,
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            TextButton(
              onPressed: _changingSeat
                  ? null
                  : () => _runSeatAction(
                        () => _roomSeatService.cancelMicRequest(roomId),
                      ),
              child: const Text('إلغاء'),
            ),
          ],
        ),
      );
    }

    return const SizedBox.shrink();
  }

  String _formatStarBattleCoins(int value) {
    if (value >= 1000000) {
      final number = value / 1000000;
      return (number >= 10 ? number.toStringAsFixed(0) : number.toStringAsFixed(2)) + 'M';
    }
    if (value >= 1000) {
      final number = value / 1000;
      return (number >= 10 ? number.toStringAsFixed(0) : number.toStringAsFixed(1)) + 'K';
    }
    return value.toString();
  }

  int _fallbackRoomSeatCapacity() {
    final direct = (_roomArguments['effectiveSeats'] as num?)?.toInt() ??
        (_roomArguments['seatCount'] as num?)?.toInt();
    if (direct != null && direct >= 1 && direct <= 50) return direct;

    final level = (_roomInsights?.level ??
            (_roomArguments['level'] as num?)?.toInt() ??
            1)
        .clamp(1, 6);
    final type = (_roomArguments['roomType'] ??
            _roomArguments['type'] ??
            'personal')
        .toString();
    if (type == 'customer_service') return 5;
    if (type == 'agency') {
      return const [10, 12, 14, 16, 20, 22][level - 1];
    }
    return const [8, 10, 12, 15, 20, 20][level - 1];
  }

  Widget _buildVoiceSeats() {
    final state = _roomSeatState;
    final seats = state?.seats ??
        List.generate(
          _fallbackRoomSeatCapacity(),
          (index) => VoiceSeat(
            index: index,
            uid: '',
            displayName: '',
            profileImageUrl: '',
            muted: true,
            starBattleCoins: 0,
          ),
        );

    // Keep the complete mic stage compact even at LV.6 / agency capacity.
    // 20-22 seats stay within four rows instead of pushing the room feed
    // below the fold.
    final count = seats.length;
    final columns = count <= 8 ? 4 : (count <= 12 ? 4 : (count <= 20 ? 5 : 6));
    final compact = count > 12;
    final micSize = count > 20 ? 38.0 : (compact ? 42.0 : 54.0);
    final badgeSize = compact ? 17.0 : 20.0;
    final nameSize = compact ? 8.5 : 10.0;
    final starSize = compact ? 8.0 : 9.0;

    return AnimatedBuilder(
      animation: _roomEffectCoordinator,
      builder: (context, _) => GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: seats.length,
      gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: columns,
        mainAxisSpacing: compact ? 5 : 14,
        crossAxisSpacing: compact ? 5 : 10,
        childAspectRatio: compact ? .88 : .78,
      ),
      itemBuilder: (_, index) {
        final seat = seats[index];
        final giftEffect = seat.occupied
            ? _roomEffectCoordinator.seatEffectFor(seat.uid)
            : null;
        final giftEffectSize = giftEffect == null
            ? 0.0
            : (giftEffect.size > 0
                ? giftEffect.size.toDouble()
                : micSize + 20);
        return InkWell(
          onTap: _changingSeat ? null : () => _handleSeatTap(seat),
          borderRadius: BorderRadius.circular(18),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Stack(
                clipBehavior: Clip.none,
                children: [
                  if (giftEffect != null)
                    Positioned(
                      left: (micSize - giftEffectSize) / 2,
                      top: (micSize - giftEffectSize) / 2,
                      child: IgnorePointer(
                        child: SizedBox(
                          width: giftEffectSize,
                          height: giftEffectSize,
                          child: CosmeticAssetVisual(
                            assetKey: giftEffect.assetKey,
                            imageUrl: giftEffect.imageUrl,
                            fit: BoxFit.contain,
                          ),
                        ),
                      ),
                    ),
                  if (seat.voiceWaveActive && !seat.mysteriousMode)
                    Positioned(
                      left: -8,
                      top: -8,
                      child: IgnorePointer(
                        child: SizedBox(
                          width: micSize + 16,
                          height: micSize + 16,
                          child: CosmeticAssetVisual(
                            assetKey: seat.voiceWaveAssetKey,
                            imageUrl: seat.voiceWaveImageUrl,
                          ),
                        ),
                      ),
                    ),
                  seat.mysteriousMode
                      ? MysteriousIdentityAvatar(diameter: micSize)
                      : Container(
                          width: micSize,
                          height: micSize,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color: const Color(0xFF151B29),
                            border: Border.all(
                              color: seat.occupied
                                  ? const Color(0xFF8A3DFF)
                                  : Colors.white12,
                              width: seat.occupied ? 2 : 1,
                            ),
                            image: seat.profileImageUrl.isEmpty
                                ? null
                                : DecorationImage(
                                    image: NetworkImage(
                                      seat.profileImageUrl,
                                    ),
                                    fit: BoxFit.cover,
                                  ),
                          ),
                          child: seat.occupied
                              ? (seat.profileImageUrl.isEmpty
                                  ? Icon(
                                      Icons.person_rounded,
                                      size: compact ? 20 : 24,
                                      color: Colors.white70,
                                    )
                                  : null)
                              : Icon(
                                  _isCustomerServiceRoom
                                      ? (seat.index < 2
                                          ? Icons.admin_panel_settings_rounded
                                          : Icons.lock_open_rounded)
                                      : Icons.add_rounded,
                                  size: compact ? 19 : 24,
                                  color: _isCustomerServiceRoom &&
                                          seat.index < 2
                                      ? const Color(0xFFFFD54A)
                                      : Colors.white38,
                                ),
                        ),
                  if (seat.frameActive && !seat.mysteriousMode)
                    Positioned(
                      left: -6,
                      top: -6,
                      child: IgnorePointer(
                        child: SizedBox(
                          width: micSize + 12,
                          height: micSize + 12,
                          child: CosmeticAssetVisual(
                            assetKey: seat.frameAssetKey,
                            imageUrl: seat.frameImageUrl,
                          ),
                        ),
                      ),
                    ),
                  if (seat.occupied)
                    Positioned(
                      right: -2,
                      bottom: -2,
                      child: Container(
                        width: badgeSize,
                        height: badgeSize,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: seat.muted
                              ? const Color(0xFF2A2F3A)
                              : const Color(0xFF39D98A),
                          border: Border.all(
                            color: const Color(0xFF05060D),
                            width: 2,
                          ),
                        ),
                        child: Icon(
                          seat.muted
                              ? Icons.mic_off_rounded
                              : Icons.mic_rounded,
                          size: compact ? 9 : 11,
                          color: Colors.white,
                        ),
                      ),
                    ),
                ],
              ),
              SizedBox(height: compact ? 3 : 5),
              Text(
                seat.occupied
                    ? (seat.displayName.isEmpty ? 'متحدث' : seat.displayName)
                    : _isCustomerServiceRoom
                        ? (seat.index < 2
                            ? 'إدارة ' + (seat.index + 1).toString()
                            : 'دعوة ' + (seat.index - 1).toString())
                        : 'مقعد ' + (seat.index + 1).toString(),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: seat.occupied ? Colors.white70 : Colors.white38,
                  fontSize: nameSize,
                  fontWeight: FontWeight.w700,
                ),
              ),
              if (seat.occupied && seat.starBattleCoins > 0)
                Text(
                  _formatStarBattleCoins(seat.starBattleCoins) + ' ⭐',
                  maxLines: 1,
                  style: TextStyle(
                    color: const Color(0xFFFFD54A),
                    fontSize: starSize,
                    fontWeight: FontWeight.w900,
                  ),
                ),
            ],
          ),
        );
      },
      ),
    );
  }

  Future<void> _showSupportersSheet() async {
    final roomId = (_roomArguments['roomId'] ?? '').toString().trim();
    var supporters = _roomInsights?.supporters ?? const <RoomSupporter>[];
    if (roomId.isNotEmpty) {
      try {
        final detailed = await _roomInsightsService.load(
          roomId,
          includeSupporters: true,
        );
        supporters = detailed.supporters;
        if (mounted) setState(() => _roomInsights = detailed);
      } catch (_) {}
    }
    if (!mounted) return;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF0C101A),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(26)),
      ),
      builder: (sheetContext) => Directionality(
        textDirection: TextDirection.rtl,
        child: SafeArea(
          child: SizedBox(
            height: MediaQuery.of(sheetContext).size.height * .68,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 14, 16, 18),
              child: Column(
                children: [
                  Container(
                    width: 44,
                    height: 4,
                    decoration: BoxDecoration(
                      color: Colors.white24,
                      borderRadius: BorderRadius.circular(99),
                    ),
                  ),
                  const SizedBox(height: 14),
                  const Row(
                    children: [
                      Icon(
                        Icons.workspace_premium_rounded,
                        color: Color(0xFFFFD54A),
                      ),
                      SizedBox(width: 8),
                      Text(
                        'داعمو الغرفة',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 21,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 14),
                  Expanded(
                    child: supporters.isEmpty
                        ? const Center(
                            child: Text(
                              'لا يوجد دعم مسجل لهذه الغرفة بعد',
                              style: TextStyle(color: Colors.white54),
                            ),
                          )
                        : ListView.separated(
                            itemCount: supporters.length,
                            separatorBuilder: (_, __) =>
                                const Divider(color: Colors.white10),
                            itemBuilder: (_, index) {
                              final supporter = supporters[index];
                              final hasLevelBadges =
                                  supporter.wealthLevel > 0 ||
                                  supporter.attractionLevel > 0 ||
                                  supporter.gameLevel > 0;
                              final hasPublicBadges =
                                  supporter.vipLevel > 0 ||
                                  supporter.badges.isNotEmpty;
                              return ListTile(
                                contentPadding: EdgeInsets.zero,
                                onTap: supporter.mysteriousMode
                                    ? () {
                                        Navigator.of(sheetContext).pop();
                                        Future<void>.microtask(() async {
                                          if (!mounted) return;
                                          await showMysteriousIdentitySheet(
                                            context,
                                            mysteriousId:
                                                supporter.mysteriousId,
                                            rank: supporter.rank,
                                            support: supporter.totalSupport,
                                          );
                                        });
                                      }
                                    : supporter.uid.isEmpty
                                        ? null
                                        : () {
                                            Navigator.of(sheetContext).pop();
                                            Future<void>.microtask(() async {
                                              if (!mounted) return;
                                              await showQuickProfileSheet(
                                                context,
                                                userId: supporter.uid,
                                              );
                                            });
                                          },
                                leading: supporter.mysteriousMode
                                    ? const MysteriousIdentityAvatar(
                                        diameter: 40,
                                      )
                                    : ProfileAvatarWithFrame(
                                        diameter: 40,
                                        userId: supporter.uid,
                                        backgroundColor:
                                            const Color(0xFF25183F),
                                        placeholderColor:
                                            const Color(0xFFFFD54A),
                                        fallbackProfile: <String, dynamic>{
                                          'profileImageUrl':
                                              supporter.profileImageUrl,
                                          'activeProfileFrameAssetKey':
                                              supporter.activeProfileFrameAssetKey,
                                          'activeProfileFrameImageUrl':
                                              supporter.activeProfileFrameImageUrl,
                                          'activeProfileFrameExpiresAtMs':
                                              supporter.activeProfileFrameExpiresAtMs,
                                          'activeProfileFramePermanent':
                                              supporter.activeProfileFramePermanent,
                                        },
                                        fallbackIsVisualSnapshot: true,
                                        vipLevel: supporter.vipLevel,
                                        useVipFallback: true,
                                      ),
                                title: Text(
                                  supporter.displayName,
                                  style: const TextStyle(
                                    color: Colors.white,
                                    fontWeight: FontWeight.w800,
                                  ),
                                ),
                                subtitle: Padding(
                                  padding: const EdgeInsets.only(top: 4),
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        'ID: ' +
                                            (supporter.publicId.isEmpty
                                                ? '—'
                                                : supporter.publicId),
                                        textDirection: TextDirection.ltr,
                                        style: const TextStyle(
                                          color: Colors.white54,
                                          fontSize: 10,
                                        ),
                                      ),
                                      Text(
                                        'المركز ' +
                                            supporter.rank.toString(),
                                        style: const TextStyle(
                                          color: Colors.white54,
                                          fontSize: 10,
                                        ),
                                      ),
                                      if (hasPublicBadges) ...[
                                        const SizedBox(height: 6),
                                        Wrap(
                                          spacing: 5,
                                          runSpacing: 5,
                                          children: [
                                            if (supporter.vipLevel > 0)
                                              RegistryBadge(
                                                assetKey:
                                                    ShadowAssetKeys.vipBadge(
                                                  supporter.vipLevel,
                                                ),
                                                label:
                                                    'VIP ${supporter.vipLevel}',
                                              ),
                                            ...supporter.badges.take(4).map(
                                                  (badge) => RegistryBadge(
                                                    assetKey:
                                                        normalizePublicBadgeKey(
                                                      badge,
                                                    ),
                                                    label: publicBadgeLabel(
                                                      badge,
                                                    ),
                                                  ),
                                                ),
                                          ],
                                        ),
                                      ],
                                      if (hasLevelBadges) ...[
                                        const SizedBox(height: 6),
                                        UserLevelBadges.fromLevels(
                                          wealthLevel:
                                              supporter.wealthLevel,
                                          attractionLevel:
                                              supporter.attractionLevel,
                                          gameLevel: supporter.gameLevel,
                                          compact: true,
                                          onTap: (tabIndex) {
                                            Navigator.of(sheetContext).pop();
                                            Future<void>.microtask(() {
                                              if (!mounted) return;
                                              Navigator.of(context).push(
                                                MaterialPageRoute<void>(
                                                  builder: (_) =>
                                                      UserLevelScreen(
                                                    userId: supporter.uid,
                                                    initialTabIndex:
                                                        tabIndex,
                                                  ),
                                                ),
                                              );
                                            });
                                          },
                                        ),
                                      ],
                                    ],
                                  ),
                                ),
                                trailing: Text(
                                  supporter.totalSupport.toString(),
                                  style: const TextStyle(
                                    color: Color(0xFFFFD54A),
                                    fontWeight: FontWeight.w900,
                                  ),
                                ),
                              );
                            },
                          ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Future<void> _showRoomRankingSheet() async {
    final currentRoomId = (_roomArguments['roomId'] ?? '').toString();
    var ranking = _roomInsights?.ranking ?? const <RoomRankEntry>[];
    if (currentRoomId.trim().isNotEmpty) {
      try {
        final detailed = await _roomInsightsService.load(
          currentRoomId,
          includeRanking: true,
        );
        ranking = detailed.ranking;
        if (mounted) setState(() => _roomInsights = detailed);
      } catch (_) {}
    }
    if (!mounted) return;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF0C101A),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(26)),
      ),
      builder: (sheetContext) => Directionality(
        textDirection: TextDirection.rtl,
        child: SafeArea(
          child: SizedBox(
            height: MediaQuery.of(sheetContext).size.height * .72,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 14, 16, 18),
              child: Column(
                children: [
                  Container(
                    width: 44,
                    height: 4,
                    decoration: BoxDecoration(
                      color: Colors.white24,
                      borderRadius: BorderRadius.circular(99),
                    ),
                  ),
                  const SizedBox(height: 14),
                  const Row(
                    children: [
                      Icon(
                        Icons.emoji_events_rounded,
                        color: Color(0xFFFFD54A),
                      ),
                      SizedBox(width: 8),
                      Text(
                        'ترتيب الغرف اليومي',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 21,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 14),
                  Expanded(
                    child: ranking.isEmpty
                        ? const Center(
                            child: Text(
                              'لا توجد بيانات ترتيب حالياً',
                              style: TextStyle(color: Colors.white54),
                            ),
                          )
                        : ListView.separated(
                            itemCount: ranking.length,
                            separatorBuilder: (_, __) =>
                                const Divider(color: Colors.white10),
                            itemBuilder: (_, index) {
                              final entry = ranking[index];
                              final current = entry.roomId == currentRoomId;
                              return Container(
                                decoration: BoxDecoration(
                                  color: current
                                      ? const Color(0xFF8A3DFF)
                                          .withValues(alpha: .13)
                                      : Colors.transparent,
                                  borderRadius: BorderRadius.circular(14),
                                ),
                                child: ListTile(
                                  leading: CircleAvatar(
                                    backgroundColor: entry.rank <= 3
                                        ? const Color(0xFFFFD54A)
                                        : const Color(0xFF202534),
                                    child: Text(
                                      entry.rank.toString(),
                                      style: TextStyle(
                                        color: entry.rank <= 3
                                            ? Colors.black
                                            : Colors.white,
                                        fontWeight: FontWeight.w900,
                                      ),
                                    ),
                                  ),
                                  title: Text(
                                    entry.name,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                      color: Colors.white,
                                      fontWeight: FontWeight.w800,
                                    ),
                                  ),
                                  subtitle: entry.publicId.isEmpty
                                      ? null
                                      : Text(
                                          'ID: ' + entry.publicId,
                                          style: const TextStyle(
                                            color: Colors.white38,
                                            fontSize: 10,
                                          ),
                                        ),
                                  trailing: Column(
                                    mainAxisAlignment:
                                        MainAxisAlignment.center,
                                    crossAxisAlignment:
                                        CrossAxisAlignment.end,
                                    children: [
                                      Text(
                                        entry.activityScore.toString(),
                                        style: const TextStyle(
                                          color: Color(0xFFFFD54A),
                                          fontWeight: FontWeight.w900,
                                        ),
                                      ),
                                      const Text(
                                        'Activity',
                                        style: TextStyle(
                                          color: Colors.white38,
                                          fontSize: 9,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              );
                            },
                          ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Future<void> _showShareRoomSheet() async {
    final roomId = (_roomArguments['roomId'] ?? '').toString().trim();
    if (roomId.isEmpty) return;

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF0C101A),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(26)),
      ),
      builder: (sheetContext) {
        final sending = <String>{};
        return Directionality(
          textDirection: TextDirection.rtl,
          child: StatefulBuilder(
            builder: (context, setSheetState) => SafeArea(
              child: SizedBox(
                height: MediaQuery.of(context).size.height * .72,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 14, 16, 18),
                  child: Column(
                    children: [
                      Container(
                        width: 44,
                        height: 4,
                        decoration: BoxDecoration(
                          color: Colors.white24,
                          borderRadius: BorderRadius.circular(99),
                        ),
                      ),
                      const SizedBox(height: 14),
                      const Row(
                        children: [
                          Icon(
                            Icons.share_rounded,
                            color: Color(0xFFFFD54A),
                          ),
                          SizedBox(width: 8),
                          Text(
                            'مشاركة الغرفة',
                            style: TextStyle(
                              color: Colors.white,
                              fontSize: 21,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 14),
                      Expanded(
                        child: FutureBuilder<List<RoomInviteFriend>>(
                          future: _roomInvites.loadFriends(),
                          builder: (context, snapshot) {
                            if (snapshot.connectionState !=
                                ConnectionState.done) {
                              return const Center(
                                child: CircularProgressIndicator(
                                  color: Color(0xFF8A3DFF),
                                ),
                              );
                            }
                            if (snapshot.hasError) {
                              return const Center(
                                child: Text(
                                  'تعذر تحميل الأصدقاء حالياً',
                                  style: TextStyle(color: Colors.white60),
                                ),
                              );
                            }
                            final friends = snapshot.data ?? const [];
                            if (friends.isEmpty) {
                              return const Center(
                                child: Text(
                                  'لا يوجد أصدقاء بمتابعة متبادلة حالياً',
                                  style: TextStyle(color: Colors.white60),
                                ),
                              );
                            }
                            return ListView.separated(
                              itemCount: friends.length,
                              separatorBuilder: (_, __) =>
                                  const Divider(color: Colors.white10),
                              itemBuilder: (_, index) {
                                final friend = friends[index];
                                final busy = sending.contains(friend.uid);
                                return ListTile(
                                  contentPadding: EdgeInsets.zero,
                                  leading: ProfileAvatarWithFrame(
                                    diameter: 46,
                                    userId: friend.uid,
                                    backgroundColor:
                                        const Color(0xFF25183F),
                                    placeholderColor:
                                        const Color(0xFFFFD54A),
                                    fallbackProfile: <String, dynamic>{
                                      'profileImageUrl': friend.photoUrl,
                                    },
                                  ),
                                  title: Text(
                                    friend.name,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                      color: Colors.white,
                                      fontWeight: FontWeight.w800,
                                    ),
                                  ),
                                  subtitle: Text(
                                    friend.online
                                        ? 'متصل الآن'
                                        : 'غير متصل',
                                    style: TextStyle(
                                      color: friend.online
                                          ? const Color(0xFF39D98A)
                                          : Colors.white38,
                                      fontSize: 11,
                                    ),
                                  ),
                                  trailing: FilledButton(
                                    onPressed: busy
                                        ? null
                                        : () async {
                                            setSheetState(
                                              () => sending.add(friend.uid),
                                            );
                                            try {
                                              await _roomInvites.sendInvite(
                                                friendUid: friend.uid,
                                                roomId: roomId,
                                              );
                                              if (sheetContext.mounted) {
                                                ScaffoldMessenger.of(
                                                  sheetContext,
                                                ).showSnackBar(
                                                  SnackBar(
                                                    content: Text(
                                                      'تم إرسال الدعوة إلى ' +
                                                          friend.name,
                                                    ),
                                                  ),
                                                );
                                              }
                                            } on StateError catch (error) {
                                              if (sheetContext.mounted) {
                                                final code =
                                                    error.message.toString();
                                                final text = switch (code) {
                                                  'blocked' =>
                                                    'لا يمكن إرسال الدعوة بسبب الحظر.',
                                                  'mutual_follow_required' =>
                                                    'دعوات الغرف متاحة للأصدقاء بمتابعة متبادلة فقط.',
                                                  'not_in_room' =>
                                                    'يجب أن تكون داخل الغرفة لإرسال دعوتها.',
                                                  'rate_limited' =>
                                                    'تم إرسال دعوة لهذا المستخدم قبل قليل. حاول بعد لحظات.',
                                                  'room_unavailable' =>
                                                    'الغرفة لم تعد متاحة حالياً.',
                                                  _ =>
                                                    'تعذر إرسال الدعوة حالياً.',
                                                };
                                                ScaffoldMessenger.of(
                                                  sheetContext,
                                                ).showSnackBar(
                                                  SnackBar(
                                                    content: Text(text),
                                                  ),
                                                );
                                              }
                                            } catch (_) {
                                              if (sheetContext.mounted) {
                                                ScaffoldMessenger.of(
                                                  sheetContext,
                                                ).showSnackBar(
                                                  const SnackBar(
                                                    content: Text(
                                                      'تعذر إرسال الدعوة حالياً.',
                                                    ),
                                                  ),
                                                );
                                              }
                                            } finally {
                                              if (sheetContext.mounted) {
                                                setSheetState(
                                                  () => sending.remove(
                                                    friend.uid,
                                                  ),
                                                );
                                              }
                                            }
                                          },
                                    style: FilledButton.styleFrom(
                                      backgroundColor:
                                          const Color(0xFF6D27D9),
                                    ),
                                    child: busy
                                        ? const SizedBox(
                                            width: 16,
                                            height: 16,
                                            child: CircularProgressIndicator(
                                              strokeWidth: 2,
                                              color: Colors.white,
                                            ),
                                          )
                                        : const Text('مشاركة'),
                                  ),
                                );
                              },
                            );
                          },
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        );
      },
    );
  }

  Future<void> _setRoomAudioEnabled(bool value) async {
    final previous = _roomSoundEnabled;
    if (mounted) setState(() => _roomSoundEnabled = value);
    try {
      await _voiceSession.setRoomAudioEnabled(value);
    } catch (_) {
      if (!mounted) return;
      setState(() => _roomSoundEnabled = previous);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تعذر تغيير صوت الغرفة حالياً.')),
      );
    }
  }

  Future<void> _showStarBattleSheet() async {
    final roomId = (_roomArguments['roomId'] ?? '').toString().trim();
    if (roomId.isEmpty) return;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF0C101A),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(26)),
      ),
      builder: (_) => StarBattleSheet(
        roomId: roomId,
        canManage: _canManagePk,
      ),
    );
  }

  Future<void> _showRoomMusicSheet() async {
    final roomId = (_roomArguments['roomId'] ?? '').toString().trim();
    if (roomId.isEmpty) return;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF0C101A),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(26)),
      ),
      builder: (_) => RoomMusicSheet(
        roomId: roomId,
        canManage: _canManageMusic,
        canManagePolicy: _canManageMusicPolicy,
      ),
    );
  }

  void _openInitialGameIfNeeded(Map<String, dynamic> args) {
    final key = (args['initialGameKey'] ?? '').toString().trim();
    if (key.isEmpty || _initialGameOpened || !_roomGamesEnabled) return;
    _initialGameOpened = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      unawaited(_showRoomGameOverlay(initialGameKey: key));
    });
  }

  Future<void> _showRoomGameOverlay({String? initialGameKey}) async {
    if (!_roomGamesEnabled) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('الألعاب غير مفعّلة في هذه الغرفة.')),
        );
      }
      return;
    }
    final roomId = (_roomArguments['roomId'] ?? '').toString().trim();
    if (roomId.isEmpty) return;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: false,
      backgroundColor: Colors.transparent,
      barrierColor: Colors.black.withValues(alpha: .42),
      builder: (_) => RoomGameOverlaySheet(
        roomId: roomId,
        initialGameKey: initialGameKey,
        initialCatalog: _bootstrapGames,
      ),
    );
  }

  Future<void> _runLuckyWheel() async {
    if (!_canManageMic) return;
    final occupied = (_roomSeatState?.seats ?? const <VoiceSeat>[])
        .where((seat) => seat.occupied)
        .toList(growable: false);
    if (occupied.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('لا يوجد مستخدمون على المايكات حالياً.')),
      );
      return;
    }
    final selected = occupied[Random.secure().nextInt(occupied.length)];
    if (!mounted) return;
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => Directionality(
        textDirection: TextDirection.rtl,
        child: AlertDialog(
          backgroundColor: const Color(0xFF111522),
          title: const Row(
            children: [
              Icon(Icons.autorenew_rounded, color: Color(0xFFFFD54A)),
              SizedBox(width: 8),
              Text('عجلة الحظ', style: TextStyle(color: Colors.white)),
            ],
          ),
          content: Text(
            'تم اختيار المايك رقم ${selected.index + 1}',
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 22,
              fontWeight: FontWeight.w900,
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text('تم'),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _showToolsSheet() async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF171717),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(26)),
      ),
      builder: (sheetContext) => Directionality(
        textDirection: TextDirection.rtl,
        child: StatefulBuilder(
          builder: (context, setSheetState) {
            void toggleRoomSound(bool value) {
              setState(() => _roomSoundEnabled = value);
              setSheetState(() {});
              unawaited(
                _setRoomAudioEnabled(value).whenComplete(() {
                  if (sheetContext.mounted) setSheetState(() {});
                }),
              );
            }

            void toggleEffectSound(bool value) {
              setState(() => _effectSoundEnabled = value);
              _roomEffectCoordinator.setPreferences(
                visualEnabled: _roomEffectsEnabled,
                effectSoundEnabled: value,
              );
              setSheetState(() {});
            }

            void toggleRoomEffects(bool value) {
              setState(() => _roomEffectsEnabled = value);
              _roomEffectCoordinator.setPreferences(
                visualEnabled: value,
                effectSoundEnabled: _effectSoundEnabled,
              );
              setSheetState(() {});
            }

            Widget tool({
              required IconData icon,
              required String label,
              required VoidCallback onTap,
              Color iconColor = const Color(0xFFFFD54A),
            }) {
              return InkWell(
                borderRadius: BorderRadius.circular(18),
                onTap: onTap,
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Container(
                      width: 58,
                      height: 58,
                      decoration: const BoxDecoration(
                        color: Color(0xFF262626),
                        shape: BoxShape.circle,
                      ),
                      child: Icon(icon, color: iconColor, size: 30),
                    ),
                    const SizedBox(height: 7),
                    Text(
                      label,
                      textAlign: TextAlign.center,
                      maxLines: 2,
                      style: const TextStyle(
                        color: Colors.white70,
                        fontSize: 11,
                      ),
                    ),
                  ],
                ),
              );
            }

            void comingSoon(String label) {
              ScaffoldMessenger.of(sheetContext).showSnackBar(
                SnackBar(content: Text(label + ' سيتم ربطه في مرحلته.')),
              );
            }

            return SafeArea(
              child: ConstrainedBox(
                constraints: BoxConstraints(
                  maxHeight: MediaQuery.sizeOf(sheetContext).height * .78,
                ),
                child: SingleChildScrollView(
                  physics: const BouncingScrollPhysics(),
                  padding: const EdgeInsets.fromLTRB(16, 14, 16, 22),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Container(
                        width: 44,
                        height: 4,
                        decoration: BoxDecoration(
                          color: Colors.white24,
                          borderRadius: BorderRadius.circular(99),
                        ),
                      ),
                      const SizedBox(height: 16),
                      const Text(
                        'الأدوات',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 21,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      const SizedBox(height: 18),
                      GridView.count(
                        shrinkWrap: true,
                        physics: const NeverScrollableScrollPhysics(),
                        crossAxisCount: 5,
                        mainAxisSpacing: 16,
                        crossAxisSpacing: 8,
                        childAspectRatio: .78,
                        children: [
                        tool(
                          icon: Icons.account_balance_wallet_rounded,
                          label: 'مركز الشحن',
                          onTap: () {
                            Navigator.pop(sheetContext);
                            NavigationService.navigateTo(AppRoutes.recharge);
                          },
                          iconColor: const Color(0xFFFF8A80),
                        ),
                        tool(
                          icon: Icons.local_activity_rounded,
                          label: 'الأنشطة',
                          onTap: () => comingSoon('الأنشطة'),
                          iconColor: const Color(0xFFFFE082),
                        ),
                        tool(
                          icon: Icons.storefront_rounded,
                          label: 'المتجر',
                          onTap: () => comingSoon('المتجر'),
                          iconColor: const Color(0xFFFFF59D),
                        ),
                        tool(
                          icon: Icons.checkroom_rounded,
                          label: 'الإكسسوارات',
                          onTap: () {
                            Navigator.pop(sheetContext);
                            Navigator.of(context).push(
                              MaterialPageRoute(
                                builder: (_) => const MyItemsScreen(),
                              ),
                            );
                          },
                          iconColor: const Color(0xFFCE93D8),
                        ),
                        if (_roomGamesEnabled)
                          tool(
                            icon: Icons.sports_esports_rounded,
                            label: 'الألعاب',
                            onTap: () {
                              Navigator.pop(sheetContext);
                              _showRoomGameOverlay();
                            },
                            iconColor: const Color(0xFF80D8FF),
                          ),
                        tool(
                          icon: Icons.music_note_rounded,
                          label: 'الأغاني',
                          onTap: () {
                            Navigator.pop(sheetContext);
                            _showRoomMusicSheet();
                          },
                          iconColor: const Color(0xFFF48FB1),
                        ),
                        tool(
                          icon: Icons.star_rounded,
                          label: 'حرب النجوم',
                          onTap: () {
                            Navigator.pop(sheetContext);
                            _showStarBattleSheet();
                          },
                          iconColor: const Color(0xFFFFD54A),
                        ),
                        tool(
                          icon: Icons.autorenew_rounded,
                          label: 'عجلة الحظ',
                          onTap: _canManageMic
                              ? () {
                                  Navigator.pop(sheetContext);
                                  _runLuckyWheel();
                                }
                              : () => comingSoon('عجلة الحظ للمشرفين فقط'),
                          iconColor: const Color(0xFFFFF59D),
                        ),
                        _RoomToolToggle(
                          icon: Icons.auto_awesome_rounded,
                          label: 'مؤثرات الغرفة',
                          value: _roomEffectsEnabled,
                          onChanged: toggleRoomEffects,
                        ),
                        _RoomToolToggle(
                          icon: Icons.volume_up_rounded,
                          label: 'صوت الغرفة',
                          value: _roomSoundEnabled,
                          onChanged: toggleRoomSound,
                        ),
                        _RoomToolToggle(
                          icon: Icons.star_rounded,
                          label: 'صوت المؤثرات',
                          value: _effectSoundEnabled,
                          onChanged: toggleEffectSound,
                        ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            );
          },
        ),
      ),
    );
  }

  Future<void> _showRoomInfoSheet() async {
    final title = (_roomArguments['name'] ??
            _roomArguments['title'] ??
            'غرفة صوتية')
        .toString();
    final publicId = (_roomArguments['publicId'] ?? '—').toString();
    final category = _roomCategoryLabel;
    final description =
        (_roomArguments['description'] ?? '').toString().trim();
    final visibility =
        (_roomArguments['visibility'] ?? 'public').toString();
    final tags = _roomArguments['tags'] is List
        ? (_roomArguments['tags'] as List)
            .map((value) => value.toString())
            .where((value) => value.trim().isNotEmpty)
            .toList()
        : const <String>[];
    final online = _roomAudienceTotalCount.toString();
    final level = _roomInsights?.level ??
        ((_roomArguments['level'] as num?)?.toInt() ?? 1);

    String visibilityLabel() {
      switch (visibility) {
        case 'password':
          return 'بكلمة مرور';
        case 'hidden':
          return 'مخفية';
        default:
          return 'عامة';
      }
    }

    Widget infoRow(IconData icon, String label, String value) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 7),
        child: Row(
          children: [
            Icon(icon, size: 18, color: const Color(0xFFBFA5FF)),
            const SizedBox(width: 9),
            Text(
              label,
              style: const TextStyle(
                color: Colors.white54,
                fontSize: 11,
              ),
            ),
            const Spacer(),
            Flexible(
              child: Text(
                value,
                textAlign: TextAlign.end,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 11,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
          ],
        ),
      );
    }

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF0C101A),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(26)),
      ),
      builder: (sheetContext) => Directionality(
        textDirection: TextDirection.rtl,
        child: SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(18, 14, 18, 22),
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 44,
                    height: 4,
                    decoration: BoxDecoration(
                      color: Colors.white24,
                      borderRadius: BorderRadius.circular(99),
                    ),
                  ),
                  const SizedBox(height: 16),
                  CircleAvatar(
                    radius: 38,
                    backgroundColor: const Color(0xFF171D2B),
                    backgroundImage: _roomHeaderImageUrl.isEmpty
                        ? null
                        : NetworkImage(_roomHeaderImageUrl),
                    child: _roomHeaderImageUrl.isEmpty
                        ? const Icon(
                            Icons.person_rounded,
                            color: Colors.white54,
                            size: 34,
                          )
                        : null,
                  ),
                  const SizedBox(height: 10),
                  Text(
                    title,
                    maxLines: 2,
                    textAlign: TextAlign.center,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 19,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    _ownerDisplayName +
                        (_ownerLocation.trim().isEmpty
                            ? ''
                            : ' • ' + _ownerLocation),
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: Colors.white54,
                      fontSize: 11,
                    ),
                  ),
                  const SizedBox(height: 16),
                  Container(
                    padding: const EdgeInsets.all(13),
                    decoration: BoxDecoration(
                      color: const Color(0xFF141A28),
                      borderRadius: BorderRadius.circular(18),
                      border: Border.all(color: Colors.white10),
                    ),
                    child: Column(
                      children: [
                        infoRow(Icons.tag_rounded, 'ID', publicId),
                        infoRow(
                          Icons.category_rounded,
                          'التصنيف',
                          category,
                        ),
                        infoRow(
                          Icons.shield_outlined,
                          'الخصوصية',
                          visibilityLabel(),
                        ),
                        if (_showRoomLevel)
                          infoRow(
                            Icons.workspace_premium_rounded,
                            'المستوى',
                            'LV.' + level.toString(),
                          ),
                        infoRow(
                          Icons.group_rounded,
                          'المتصلون',
                          online,
                        ),
                        infoRow(
                          Icons.mic_external_on_rounded,
                          _isCustomerServiceRoom ? 'المداخل' : 'المقاعد',
                          (_roomSeatState?.seats.length ?? 0).toString(),
                        ),
                      ],
                    ),
                  ),
                  if (description.isNotEmpty) ...[
                    const SizedBox(height: 14),
                    Align(
                      alignment: AlignmentDirectional.centerStart,
                      child: Text(
                        description,
                        style: const TextStyle(
                          color: Colors.white70,
                          fontSize: 12,
                          height: 1.5,
                        ),
                      ),
                    ),
                  ],
                  if (tags.isNotEmpty) ...[
                    const SizedBox(height: 12),
                    Align(
                      alignment: AlignmentDirectional.centerStart,
                      child: Wrap(
                        spacing: 6,
                        runSpacing: 6,
                        children: tags
                            .map(
                              (tag) => Container(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 9,
                                  vertical: 5,
                                ),
                                decoration: BoxDecoration(
                                  color: const Color(0xFF8A3DFF)
                                      .withValues(alpha: .14),
                                  borderRadius: BorderRadius.circular(999),
                                ),
                                child: Text(
                                  '#' + tag,
                                  style: const TextStyle(
                                    color: Color(0xFFBFA5FF),
                                    fontSize: 10,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                              ),
                            )
                            .toList(),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Future<void> _showRoomSettingsSheet() async {
    final roomId = (_roomArguments['roomId'] ?? '').toString().trim();
    final canEditRoomSettings = !_roomAuthoritySuppressed &&
        (_voiceSession.isOwner ||
            (_roomModeratorState?.ownerAbsoluteRoomAccess ?? false));
    if (roomId.isEmpty || !canEditRoomSettings) return;
    final isAgencyRoom = _roomAgencyId.isNotEmpty;

    final nameController = TextEditingController(
      text: (_roomArguments['name'] ??
              _roomArguments['title'] ??
              'غرفتي')
          .toString(),
    );
    final descriptionController = TextEditingController(
      text: (_roomArguments['description'] ?? '').toString(),
    );
    final initialCoverImageUrl = isAgencyRoom
        ? roomSurfaceImageUrl(_roomArguments)
        : (_roomArguments['roomImageUrl'] ??
                _roomArguments['coverImageUrl'] ??
                _roomArguments['imageUrl'] ??
                '')
            .toString()
            .trim();
    final initialCoverObjectId = isAgencyRoom
        ? (_roomArguments['agencyRoomImageObjectId'] ??
                _roomArguments['roomImageObjectId'] ??
                '')
            .toString()
            .trim()
        : (_roomArguments['roomImageObjectId'] ??
                _roomArguments['coverImageObjectId'] ??
                '')
            .toString()
            .trim();
    Uint8List? pendingCoverBytes;
    var removeCover = false;
    final categoryController = TextEditingController(
      text: isAgencyRoom
          ? 'وكالة'
          : (_roomArguments['category'] ?? 'دردشة').toString(),
    );
    final tagsController = TextEditingController(
      text: _roomArguments['tags'] is List
          ? (_roomArguments['tags'] as List)
              .map((value) => value.toString())
              .join('، ')
          : '',
    );
    final passwordController = TextEditingController();
    var visibility =
        (_roomArguments['visibility'] ?? 'public').toString();
    if (!const {'public', 'password', 'hidden'}.contains(visibility)) {
      visibility = 'public';
    }
    var saving = false;
    var chatEnabled = _roomArguments['chatEnabled'] != false;

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF0C101A),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(26)),
      ),
      builder: (sheetContext) => Directionality(
        textDirection: TextDirection.rtl,
        child: StatefulBuilder(
          builder: (context, setSheetState) => SafeArea(
            child: Padding(
              padding: EdgeInsets.only(
                left: 16,
                right: 16,
                top: 14,
                bottom: MediaQuery.viewInsetsOf(context).bottom + 18,
              ),
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      width: 44,
                      height: 4,
                      decoration: BoxDecoration(
                        color: Colors.white24,
                        borderRadius: BorderRadius.circular(99),
                      ),
                    ),
                    const SizedBox(height: 14),
                    const Row(
                      children: [
                        Icon(
                          Icons.tune_rounded,
                          color: Color(0xFFFFD54A),
                        ),
                        SizedBox(width: 8),
                        Text(
                          'إعدادات الغرفة',
                          style: TextStyle(
                            color: Colors.white,
                            fontSize: 20,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),
                    TextField(
                      controller: nameController,
                      maxLength: 60,
                      style: const TextStyle(color: Colors.white),
                      decoration: const InputDecoration(
                        labelText: 'اسم الغرفة',
                        labelStyle: TextStyle(color: Colors.white60),
                      ),
                    ),
                    TextField(
                      controller: descriptionController,
                      maxLength: 240,
                      maxLines: 2,
                      style: const TextStyle(color: Colors.white),
                      decoration: const InputDecoration(
                        labelText: 'وصف الغرفة',
                        labelStyle: TextStyle(color: Colors.white60),
                      ),
                    ),
                    Align(
                      alignment: Alignment.centerRight,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'صورة الغرفة',
                            style: TextStyle(
                              color: Colors.white,
                              fontWeight: FontWeight.w900,
                              fontSize: 16,
                            ),
                          ),
                          const SizedBox(height: 3),
                          Text(
                            isAgencyRoom
                                ? 'هذه صورة غرفة الوكالة التي تظهر خارج الروم وفي الهيدر، وليست الخلفية.'
                                : 'تظهر في قائمة الغرف والهيدر فقط، وليست خلفية الغرفة.',
                            style: const TextStyle(
                              color: Colors.white54,
                              fontSize: 11,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 10),
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.center,
                      children: [
                        ClipRRect(
                          borderRadius: BorderRadius.circular(18),
                          child: Container(
                            width: 96,
                            height: 96,
                            color: const Color(0xFF151A27),
                            child: pendingCoverBytes != null
                                ? Image.memory(
                                    pendingCoverBytes!,
                                    fit: BoxFit.cover,
                                  )
                                : !removeCover &&
                                        initialCoverImageUrl.isNotEmpty
                                    ? Image.network(
                                        initialCoverImageUrl,
                                        fit: BoxFit.cover,
                                        errorBuilder: (_, __, ___) =>
                                            const Center(
                                          child: Icon(
                                            Icons.broken_image_outlined,
                                            color: Colors.white38,
                                            size: 34,
                                          ),
                                        ),
                                      )
                                    : const Center(
                                        child: Icon(
                                          Icons.meeting_room_rounded,
                                          color: Colors.white38,
                                          size: 38,
                                        ),
                                      ),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              FilledButton.icon(
                                onPressed: saving
                                    ? null
                                    : () async {
                                        final picked =
                                            await _roomCoverPicker.pickImage(
                                          source: ImageSource.gallery,
                                          imageQuality: 86,
                                          maxWidth: 1200,
                                          maxHeight: 1200,
                                          requestFullMetadata: false,
                                        );
                                        if (picked == null) return;
                                        final bytes = await picked.readAsBytes();
                                        try {
                                          detectSupportedImageMime(bytes);
                                        } catch (_) {
                                          if (sheetContext.mounted) {
                                            ScaffoldMessenger.of(sheetContext)
                                                .showSnackBar(
                                              const SnackBar(
                                                content: Text(
                                                  'صيغة الصورة غير مدعومة. استخدم JPG أو PNG أو WebP.',
                                                ),
                                              ),
                                            );
                                          }
                                          return;
                                        }
                                        if (!sheetContext.mounted) return;
                                        final croppedBytes =
                                            await showRoomImageCropSheet(
                                          sheetContext,
                                          imageBytes: bytes,
                                          title: isAgencyRoom
                                              ? 'قص صورة غرفة الوكالة'
                                              : 'قص صورة الغرفة',
                                        );
                                        if (croppedBytes == null ||
                                            !sheetContext.mounted) {
                                          return;
                                        }
                                        setSheetState(() {
                                          pendingCoverBytes = croppedBytes;
                                          removeCover = false;
                                        });
                                      },
                                icon: const Icon(Icons.photo_library_rounded),
                                label: Text(
                                  pendingCoverBytes == null
                                      ? 'اختيار صورة'
                                      : 'تغيير الصورة',
                                ),
                              ),
                              if (!isAgencyRoom &&
                                  (pendingCoverBytes != null ||
                                      (!removeCover &&
                                          initialCoverImageUrl.isNotEmpty)))
                                TextButton.icon(
                                  onPressed: saving
                                      ? null
                                      : () {
                                          setSheetState(() {
                                            pendingCoverBytes = null;
                                            removeCover = true;
                                          });
                                        },
                                  icon: const Icon(
                                    Icons.delete_outline_rounded,
                                    color: Colors.redAccent,
                                  ),
                                  label: const Text(
                                    'حذف الصورة',
                                    style: TextStyle(color: Colors.redAccent),
                                  ),
                                ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 14),
                    Material(
                      color: const Color(0xFF151A27),
                      borderRadius: BorderRadius.circular(16),
                      child: ListTile(
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(16),
                        ),
                        leading: const Icon(
                          Icons.wallpaper_rounded,
                          color: Color(0xFFBFA5FF),
                        ),
                        title: const Text(
                          'خلفية الغرفة',
                          style: TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        subtitle: const Text(
                          'اختيار من مقتنياتي — لا يتم رفع صورة الجهاز كخلفية.',
                          style: TextStyle(
                            color: Colors.white54,
                            fontSize: 10,
                          ),
                        ),
                        trailing: const Icon(
                          Icons.chevron_left_rounded,
                          color: Colors.white38,
                        ),
                        onTap: saving
                            ? null
                            : () {
                                Navigator.pop(sheetContext);
                                Navigator.of(context).push(
                                  MaterialPageRoute<void>(
                                    builder: (_) => const MyItemsScreen(
                                      initialType: 'room_background',
                                    ),
                                  ),
                                );
                              },
                      ),
                    ),
                    const SizedBox(height: 10),
                    TextField(
                      controller: categoryController,
                      enabled: !isAgencyRoom,
                      maxLength: 30,
                      style: const TextStyle(color: Colors.white),
                      decoration: InputDecoration(
                        labelText: 'التصنيف',
                        labelStyle: const TextStyle(color: Colors.white60),
                        helperText: isAgencyRoom
                            ? 'تصنيف غرفة الوكالة ثابت: وكالة'
                            : null,
                        helperStyle: const TextStyle(color: Colors.white38),
                      ),
                    ),
                    TextField(
                      controller: tagsController,
                      style: const TextStyle(color: Colors.white),
                      decoration: const InputDecoration(
                        labelText: 'الوسوم — افصل بينها بفاصلة',
                        labelStyle: TextStyle(color: Colors.white60),
                      ),
                    ),
                    const SizedBox(height: 8),
                    DropdownButtonFormField<String>(
                      initialValue: visibility,
                      dropdownColor: const Color(0xFF171D2B),
                      style: const TextStyle(color: Colors.white),
                      decoration: const InputDecoration(
                        labelText: 'خصوصية الغرفة',
                        labelStyle: TextStyle(color: Colors.white60),
                      ),
                      items: const [
                        DropdownMenuItem(
                          value: 'public',
                          child: Text('عامة'),
                        ),
                        DropdownMenuItem(
                          value: 'password',
                          child: Text('بكلمة مرور'),
                        ),
                        DropdownMenuItem(
                          value: 'hidden',
                          child: Text('مخفية'),
                        ),
                      ],
                      onChanged: saving
                          ? null
                          : (value) {
                              if (value == null) return;
                              setSheetState(() => visibility = value);
                            },
                    ),
                    if (visibility == 'password') ...[
                      const SizedBox(height: 10),
                      TextField(
                        controller: passwordController,
                        obscureText: true,
                        maxLength: 32,
                        style: const TextStyle(color: Colors.white),
                        decoration: InputDecoration(
                          labelText:
                              (_roomArguments['visibility'] ?? '').toString() ==
                                      'password'
                                  ? 'كلمة مرور جديدة — اتركها فارغة للإبقاء الحالية'
                                  : 'كلمة مرور الغرفة',
                          labelStyle:
                              const TextStyle(color: Colors.white60),
                          prefixIcon: const Icon(
                            Icons.lock_rounded,
                            color: Color(0xFFFFD54A),
                          ),
                        ),
                      ),
                    ],
                    if (visibility == 'hidden')
                      const Padding(
                        padding: EdgeInsets.only(top: 8),
                        child: Text(
                          'الغرفة المخفية لا تظهر في الاستكشاف وتتطلب صلاحية خاصة.',
                          style: TextStyle(
                            color: Colors.white54,
                            fontSize: 11,
                          ),
                        ),
                      ),
                    const SizedBox(height: 8),
                    SwitchListTile(
                      contentPadding: EdgeInsets.zero,
                      value: chatEnabled,
                      onChanged: saving
                          ? null
                          : (value) {
                              setSheetState(
                                () => chatEnabled = value,
                              );
                            },
                      activeThumbColor: Colors.white,
                      activeTrackColor: const Color(0xFF6D27D9),
                      title: const Text(
                        'دردشة الغرفة',
                        style: TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      subtitle: Text(
                        chatEnabled
                            ? 'الأعضاء يستطيعون إرسال الرسائل'
                            : 'الشات متوقف للأعضاء — صاحب الغرفة فقط',
                        style: const TextStyle(
                          color: Colors.white54,
                          fontSize: 10,
                        ),
                      ),
                    ),
                    const SizedBox(height: 18),
                    SizedBox(
                      width: double.infinity,
                      child: FilledButton.icon(
                        onPressed: saving
                            ? null
                            : () async {
                                final name = nameController.text.trim();
                                final description =
                                    descriptionController.text.trim();
                                final category =
                                    categoryController.text.trim();
                                final tags = tagsController.text
                                    .split(RegExp(r'[,،]'))
                                    .map((value) => value.trim())
                                    .where((value) => value.isNotEmpty)
                                    .take(8)
                                    .toList();

                                if (name.length < 2) {
                                  ScaffoldMessenger.of(sheetContext)
                                      .showSnackBar(
                                    const SnackBar(
                                      content: Text(
                                        'اسم الغرفة يجب أن يكون حرفين على الأقل.',
                                      ),
                                    ),
                                  );
                                  return;
                                }
                                if (visibility == 'password' &&
                                    (_roomArguments['visibility'] ?? '')
                                            .toString() !=
                                        'password' &&
                                    passwordController.text.length < 4) {
                                  ScaffoldMessenger.of(sheetContext)
                                      .showSnackBar(
                                    const SnackBar(
                                      content: Text(
                                        'كلمة المرور يجب أن تكون 4 أحرف على الأقل.',
                                      ),
                                    ),
                                  );
                                  return;
                                }

                                setSheetState(() => saving = true);
                                String? uploadedRoomImageObjectId;
                                Map<String, dynamic>? updatedRoom;
                                try {
                                  final existingCoverImageUrl =
                                      isAgencyRoom
                                          ? roomSurfaceImageUrl(_roomArguments)
                                          : (_roomArguments['roomImageUrl'] ??
                                                  _roomArguments['coverImageUrl'] ??
                                                  _roomArguments['imageUrl'] ??
                                                  '')
                                              .toString()
                                              .trim();
                                  final existingCoverObjectId =
                                      isAgencyRoom
                                          ? (_roomArguments['agencyRoomImageObjectId'] ??
                                                  _roomArguments['roomImageObjectId'] ??
                                                  '')
                                              .toString()
                                              .trim()
                                          : (_roomArguments['roomImageObjectId'] ??
                                                  _roomArguments['coverImageObjectId'] ??
                                                  '')
                                              .toString()
                                              .trim();

                                  var nextCoverImageUrl =
                                      isAgencyRoom
                                          ? existingCoverImageUrl
                                          : (removeCover
                                              ? ''
                                              : initialCoverImageUrl);
                                  String? nextCoverObjectId =
                                      isAgencyRoom
                                          ? existingCoverObjectId
                                          : (removeCover
                                              ? ''
                                              : initialCoverObjectId);

                                  if (!isAgencyRoom &&
                                      pendingCoverBytes != null) {
                                    final bytes = pendingCoverBytes!;
                                    final upload = await _userStorage.upload(
                                      scope: 'room_cover',
                                      bytes: bytes,
                                      mimeType:
                                          detectSupportedImageMime(bytes),
                                      targetId: roomId,
                                      replaceObjectId:
                                          initialCoverObjectId.isEmpty
                                              ? null
                                              : initialCoverObjectId,
                                    );
                                    final publicUrl =
                                        upload.publicUrl?.trim() ?? '';
                                    if (publicUrl.isEmpty) {
                                      throw StateError(
                                        'room_image_public_url_missing',
                                      );
                                    }
                                    uploadedRoomImageObjectId =
                                        upload.objectId;
                                    nextCoverImageUrl = publicUrl;
                                    nextCoverObjectId = upload.objectId;
                                  }

                                  updatedRoom =
                                      await _roomActions.updateRoomSettings(
                                    roomId: roomId,
                                    name: name,
                                    description: description,
                                    category: isAgencyRoom
                                        ? 'وكالة'
                                        : (category.isEmpty
                                            ? 'دردشة'
                                            : category),
                                    tags: tags,
                                    visibility: visibility,
                                    chatEnabled: chatEnabled,
                                    coverImageUrl:
                                        isAgencyRoom ? '' : nextCoverImageUrl,
                                    coverImageObjectId:
                                        isAgencyRoom ? null : nextCoverObjectId,
                                    password:
                                        passwordController.text.isEmpty
                                            ? null
                                            : passwordController.text,
                                  );

                                  String? agencyRoomImageUrl;
                                  String? agencyRoomImageObjectId;
                                  if (isAgencyRoom &&
                                      pendingCoverBytes != null) {
                                    final bytes = pendingCoverBytes!;
                                    final upload = await _userStorage.upload(
                                      scope: 'agency_room_image',
                                      bytes: bytes,
                                      mimeType:
                                          detectSupportedImageMime(bytes),
                                      targetId: _roomAgencyId,
                                      replaceObjectId:
                                          initialCoverObjectId.isEmpty
                                              ? null
                                              : initialCoverObjectId,
                                    );
                                    final publicUrl =
                                        upload.publicUrl?.trim() ?? '';
                                    if (publicUrl.isEmpty) {
                                      throw StateError(
                                        'room_image_public_url_missing',
                                      );
                                    }
                                    agencyRoomImageUrl = publicUrl;
                                    agencyRoomImageObjectId =
                                        upload.objectId;
                                  }

                                  if (!isAgencyRoom &&
                                      removeCover &&
                                      initialCoverObjectId.isNotEmpty) {
                                    try {
                                      await _userStorage
                                          .delete(initialCoverObjectId);
                                    } catch (_) {}
                                  }

                                  if (!mounted) return;
                                  setState(() {
                                    _roomArguments = {
                                      ..._roomArguments,
                                      ...updatedRoom!,
                                      if (agencyRoomImageUrl != null)
                                        'agencyRoomImageUrl':
                                            agencyRoomImageUrl,
                                      if (agencyRoomImageObjectId != null)
                                        'agencyRoomImageObjectId':
                                            agencyRoomImageObjectId,
                                    };
                                  });
                                  if (sheetContext.mounted) {
                                    Navigator.pop(sheetContext);
                                    ScaffoldMessenger.of(context)
                                        .showSnackBar(
                                      const SnackBar(
                                        content: Text(
                                          'تم حفظ إعدادات الغرفة.',
                                        ),
                                      ),
                                    );
                                  }
                                } on StateError catch (error) {
                                  if (!isAgencyRoom &&
                                      uploadedRoomImageObjectId != null &&
                                      updatedRoom == null) {
                                    try {
                                      await _userStorage.delete(
                                        uploadedRoomImageObjectId,
                                      );
                                    } catch (_) {}
                                  }
                                  if (!sheetContext.mounted) return;
                                  String message =
                                      'تعذر حفظ إعدادات الغرفة حالياً.';
                                  if (isAgencyRoom &&
                                      updatedRoom != null &&
                                      pendingCoverBytes != null) {
                                    message =
                                        'تم حفظ الإعدادات، لكن تعذر تحديث صورة غرفة الوكالة. حاول رفع الصورة مرة ثانية.';
                                  } else if (error.message ==
                                      'hidden_room_forbidden') {
                                    message =
                                        'لا تملك صلاحية إنشاء غرفة مخفية.';
                                  } else if (error.message ==
                                      'room_password_required') {
                                    message =
                                        'أدخل كلمة مرور للغرفة.';
                                  } else if (error.message == 'forbidden') {
                                    message =
                                        'لا تملك صلاحية تعديل إعدادات هذه الغرفة.';
                                  } else if (error.message ==
                                      'invalid_room_name') {
                                    message =
                                        'اسم الغرفة يجب أن يكون بين حرفين و60 حرفاً.';
                                  } else if (error.message ==
                                      'invalid_room_description') {
                                    message =
                                        'وصف الغرفة أطول من الحد المسموح.';
                                  } else if (error.message ==
                                      'invalid_room_category') {
                                    message =
                                        'تصنيف الغرفة غير صالح.';
                                  } else if (error.message ==
                                      'invalid_room_tags') {
                                    message =
                                        'أحد وسوم الغرفة أطول من الحد المسموح.';
                                  } else if (error.message ==
                                          'invalid_room_image' ||
                                      error.message ==
                                          'invalid_room_image_object' ||
                                      error.message ==
                                          'room_image_object_not_found' ||
                                      error.message ==
                                          'room_image_object_mismatch') {
                                    message =
                                        'صورة الغرفة غير متوافقة مع نوع الغرفة. أعد اختيار الصورة وحاول مجدداً.';
                                  } else if (error.message ==
                                      'room_not_found') {
                                    message =
                                        'الغرفة غير موجودة أو لم تعد متاحة.';
                                  } else if (error.message ==
                                          'unauthorized' ||
                                      error.message ==
                                          'not_signed_in' ||
                                      error.message ==
                                          'session_revoked') {
                                    message =
                                        'انتهت جلسة الدخول. سجّل الدخول من جديد.';
                                  }
                                  ScaffoldMessenger.of(sheetContext)
                                      .showSnackBar(
                                    SnackBar(content: Text(message)),
                                  );
                                } catch (_) {
                                  if (!isAgencyRoom &&
                                      uploadedRoomImageObjectId != null &&
                                      updatedRoom == null) {
                                    try {
                                      await _userStorage.delete(
                                        uploadedRoomImageObjectId,
                                      );
                                    } catch (_) {}
                                  }
                                  if (sheetContext.mounted) {
                                    ScaffoldMessenger.of(sheetContext)
                                        .showSnackBar(
                                      SnackBar(
                                        content: Text(
                                          isAgencyRoom &&
                                                  updatedRoom != null &&
                                                  pendingCoverBytes != null
                                              ? 'تم حفظ الإعدادات، لكن تعذر تحديث صورة غرفة الوكالة. حاول رفع الصورة مرة ثانية.'
                                              : 'تعذر حفظ إعدادات الغرفة حالياً.',
                                        ),
                                      ),
                                    );
                                  }
                                } finally {
                                  if (sheetContext.mounted) {
                                    setSheetState(() => saving = false);
                                  }
                                }
                              },
                        icon: saving
                            ? const SizedBox(
                                width: 16,
                                height: 16,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  color: Colors.white,
                                ),
                              )
                            : const Icon(Icons.save_rounded),
                        label: const Text('حفظ التعديلات'),
                        style: FilledButton.styleFrom(
                          backgroundColor: const Color(0xFF6D27D9),
                          padding: const EdgeInsets.symmetric(
                            vertical: 13,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );

    nameController.dispose();
    descriptionController.dispose();
    categoryController.dispose();
    tagsController.dispose();
    passwordController.dispose();
  }

  Future<void> _showChangeRoomIdSheet() async {
    final roomId = (_roomArguments['roomId'] ?? '').toString().trim();
    if (roomId.isEmpty || !_canManageIds) return;
    final controller = TextEditingController(
      text: (_roomArguments['publicId'] ?? '').toString(),
    );
    var saving = false;

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF111522),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (sheetContext) => Directionality(
        textDirection: TextDirection.rtl,
        child: StatefulBuilder(
          builder: (context, setSheetState) => SafeArea(
            child: Padding(
              padding: EdgeInsets.fromLTRB(
                18,
                14,
                18,
                MediaQuery.viewInsetsOf(context).bottom + 20,
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 44,
                    height: 4,
                    decoration: BoxDecoration(
                      color: Colors.white24,
                      borderRadius: BorderRadius.circular(99),
                    ),
                  ),
                  const SizedBox(height: 14),
                  const Row(
                    children: [
                      Icon(Icons.tag_rounded, color: Color(0xFFFFD54A)),
                      SizedBox(width: 8),
                      Text(
                        'تغيير معرّف الغرفة',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 19,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 14),
                  TextField(
                    controller: controller,
                    keyboardType: TextInputType.number,
                    maxLength: 8,
                    style: const TextStyle(color: Colors.white),
                    decoration: const InputDecoration(
                      labelText: 'معرّف جديد — من 3 إلى 8 أرقام',
                      labelStyle: TextStyle(color: Colors.white60),
                    ),
                  ),
                  const Text(
                    'المعرّف القديم يصبح متاحًا للاستخدام بعد نجاح التغيير.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: Colors.white38, fontSize: 10),
                  ),
                  const SizedBox(height: 14),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton.icon(
                      onPressed: saving
                          ? null
                          : () async {
                              final requested = controller.text.trim();
                              final current =
                                  (_roomArguments['publicId'] ?? '').toString();
                              final numeric = int.tryParse(requested) != null;
                              if (requested.length < 3 || requested.length > 8 || !numeric) {
                                ScaffoldMessenger.of(sheetContext).showSnackBar(
                                  const SnackBar(
                                    content: Text(
                                      'أدخل معرّف غرفة صحيحًا من 3 إلى 8 أرقام.',
                                    ),
                                  ),
                                );
                                return;
                              }
                              if (requested == current) {
                                ScaffoldMessenger.of(sheetContext).showSnackBar(
                                  const SnackBar(
                                    content: Text('هذا هو المعرّف الحالي للغرفة.'),
                                  ),
                                );
                                return;
                              }
                              setSheetState(() => saving = true);
                              try {
                                final changed =
                                    await _roomActions.changeRoomPublicId(
                                  roomId: roomId,
                                  publicId: requested,
                                );
                                if (!mounted) return;
                                setState(() {
                                  _roomArguments = {
                                    ..._roomArguments,
                                    'publicId': changed,
                                  };
                                });
                                if (sheetContext.mounted) {
                                  Navigator.pop(sheetContext);
                                  ScaffoldMessenger.of(context).showSnackBar(
                                    const SnackBar(
                                      content: Text(
                                        'تم تغيير معرّف الغرفة وأصبح المعرّف القديم متاحًا.',
                                      ),
                                    ),
                                  );
                                }
                              } on StateError catch (error) {
                                if (!sheetContext.mounted) return;
                                final message =
                                    error.message == 'public_id_taken'
                                        ? 'هذا المعرّف مستخدم حاليًا.'
                                        : error.message == 'forbidden'
                                            ? 'لا تملك صلاحية تغيير معرّف الغرفة.'
                                            : 'تعذر تغيير معرّف الغرفة حالياً.';
                                ScaffoldMessenger.of(sheetContext).showSnackBar(
                                  SnackBar(content: Text(message)),
                                );
                              } catch (_) {
                                if (sheetContext.mounted) {
                                  ScaffoldMessenger.of(sheetContext)
                                      .showSnackBar(
                                    const SnackBar(
                                      content: Text(
                                        'تعذر تغيير معرّف الغرفة حالياً.',
                                      ),
                                    ),
                                  );
                                }
                              } finally {
                                if (sheetContext.mounted) {
                                  setSheetState(() => saving = false);
                                }
                              }
                            },
                      style: FilledButton.styleFrom(
                        backgroundColor: const Color(0xFF6D27D9),
                        padding: const EdgeInsets.symmetric(vertical: 13),
                      ),
                      icon: saving
                          ? const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: Colors.white,
                              ),
                            )
                          : const Icon(Icons.swap_horiz_rounded),
                      label: const Text('تغيير الـID'),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
    controller.dispose();
  }
  Future<void> _showRoomMenu() async {
    final personal = (_roomArguments['roomType'] ?? '').toString() == 'personal';
    final actualOwner =
        !_roomAuthoritySuppressed && _voiceSession.isOwner;
    final owner = !_roomAuthoritySuppressed &&
        (actualOwner ||
            (_roomModeratorState?.ownerAbsoluteRoomAccess ?? false));
    final ghostMode = _roomGhostMode;
    if (!mounted) return;
    // Open immediately; refresh this non-critical preference in parallel.
    unawaited(_refreshRoomGhostMode());

    Widget sectionTitle(String label) => Padding(
          padding: const EdgeInsets.fromLTRB(4, 14, 4, 7),
          child: Text(
            label,
            style: const TextStyle(
              color: Colors.white54,
              fontSize: 11,
              fontWeight: FontWeight.w800,
            ),
          ),
        );

    Widget sectionCard(List<Widget> children) => Container(
          decoration: BoxDecoration(
            color: const Color(0xFF171C29),
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: Colors.white10),
          ),
          child: Column(children: children),
        );

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF0D111B),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(26)),
      ),
      builder: (sheetContext) => Directionality(
        textDirection: TextDirection.rtl,
        child: DraggableScrollableSheet(
          expand: false,
          initialChildSize: .68,
          minChildSize: .42,
          maxChildSize: .9,
          builder: (context, scrollController) => SafeArea(
            child: ListView(
              controller: scrollController,
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 22),
              children: [
                Center(
                  child: Container(
                    width: 44,
                    height: 4,
                    decoration: BoxDecoration(
                      color: Colors.white24,
                      borderRadius: BorderRadius.circular(99),
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                const Row(
                  children: [
                    Icon(
                      Icons.tune_rounded,
                      color: Color(0xFFFFD54A),
                      size: 24,
                    ),
                    SizedBox(width: 9),
                    Text(
                      'خيارات الغرفة',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 20,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                const Text(
                  'الإجراءات السريعة منفصلة عن الإدارة والإعدادات والمغادرة.',
                  style: TextStyle(color: Colors.white38, fontSize: 11),
                ),

                sectionTitle('إجراء سريع'),
                sectionCard([
                  ListTile(
                    leading: const Icon(
                      Icons.picture_in_picture_alt_rounded,
                      color: Color(0xFFFFD54A),
                    ),
                    title: const Text(
                      'تصغير الغرفة',
                      style: TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    subtitle: const Text(
                      'يبقى الصوت والمايك والجلسة شغّالين.',
                      style: TextStyle(color: Colors.white54, fontSize: 10),
                    ),
                    trailing: const Icon(
                      Icons.chevron_left_rounded,
                      color: Colors.white38,
                    ),
                    onTap: () {
                      Navigator.pop(sheetContext);
                      _minimizeVoiceRoom();
                    },
                  ),
                ]),

                if (_canModerateUsers || owner || _canManageMic ||
                    (_canModerateChat && !owner)) ...[
                  sectionTitle('إدارة الغرفة'),
                  sectionCard([
                    if (_canModerateUsers)
                      ListTile(
                        leading: const Icon(
                          Icons.block_rounded,
                          color: Colors.redAccent,
                        ),
                        title: const Text(
                          'المحظورون',
                          style: TextStyle(color: Colors.white),
                        ),
                        onTap: () {
                          Navigator.pop(sheetContext);
                          _showRoomBansSheet();
                        },
                      ),
                    if (_canModerateUsers &&
                        (owner || _canManageMic || (_canModerateChat && !owner)))
                      const Divider(height: 1, color: Colors.white10),
                    if (owner)
                      ListTile(
                        leading: const Icon(
                          Icons.admin_panel_settings_rounded,
                          color: Color(0xFFFFD54A),
                        ),
                        title: const Text(
                          'مشرفو الغرفة',
                          style: TextStyle(color: Colors.white),
                        ),
                        onTap: () {
                          Navigator.pop(sheetContext);
                          _showRoomModeratorsSheet();
                        },
                      ),
                    if (owner && (_canManageMic || (_canModerateChat && !owner)))
                      const Divider(height: 1, color: Colors.white10),
                    if (_canManageMic)
                      ListTile(
                        leading: Icon(
                          (_roomSeatState?.micInviteOnly ?? false)
                              ? Icons.lock_rounded
                              : Icons.mic_external_on_rounded,
                          color: const Color(0xFFFFD54A),
                        ),
                        title: const Text(
                          'الدخول إلى المايك',
                          style: TextStyle(color: Colors.white),
                        ),
                        subtitle: Text(
                          (_roomSeatState?.micInviteOnly ?? false)
                              ? 'بدعوة أو موافقة المشرفين'
                              : 'مفتوح — الضغط على + يصعد مباشرة',
                          style: const TextStyle(
                            color: Colors.white54,
                            fontSize: 10,
                          ),
                        ),
                        trailing: Switch(
                          value: _roomSeatState?.micInviteOnly ?? false,
                          onChanged: null,
                        ),
                        onTap: () async {
                          final roomId =
                              (_roomArguments['roomId'] ?? '').toString();
                          if (roomId.isEmpty) return;
                          final next =
                              !(_roomSeatState?.micInviteOnly ?? false);
                          Navigator.pop(sheetContext);
                          await _runSeatAction(
                            () => _roomSeatService.setMicInviteOnly(
                              roomId: roomId,
                              enabled: next,
                            ),
                          );
                        },
                      ),
                    if (_canManageMic && (_canModerateChat && !owner))
                      const Divider(height: 1, color: Colors.white10),
                    if (_canModerateChat && !owner)
                      ListTile(
                        leading: Icon(
                          (_roomArguments['chatEnabled'] != false)
                              ? Icons.chat_rounded
                              : Icons.chat_bubble_outline_rounded,
                          color: const Color(0xFFBFA5FF),
                        ),
                        title: const Text(
                          'دردشة الغرفة',
                          style: TextStyle(color: Colors.white),
                        ),
                        subtitle: Text(
                          (_roomArguments['chatEnabled'] != false)
                              ? 'مفعّلة للأعضاء'
                              : 'متوقفة للأعضاء',
                          style: const TextStyle(
                            color: Colors.white54,
                            fontSize: 10,
                          ),
                        ),
                        trailing: Switch(
                          value: _roomArguments['chatEnabled'] != false,
                          onChanged: null,
                        ),
                        onTap: () async {
                          final roomId =
                              (_roomArguments['roomId'] ?? '').toString();
                          if (roomId.isEmpty) return;
                          final next =
                              !(_roomArguments['chatEnabled'] != false);
                          try {
                            final enabled =
                                await _roomActions.setRoomChatEnabled(
                              roomId: roomId,
                              enabled: next,
                            );
                            if (mounted) {
                              setState(() {
                                _roomArguments = {
                                  ..._roomArguments,
                                  'chatEnabled': enabled,
                                };
                              });
                            }
                            if (sheetContext.mounted) {
                              Navigator.pop(sheetContext);
                            }
                          } catch (_) {
                            if (mounted) {
                              ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(
                                  content: Text(
                                    'تعذر تحديث دردشة الغرفة حالياً.',
                                  ),
                                ),
                              );
                            }
                          }
                        },
                      ),
                  ]),
                ],

                sectionTitle('الإعدادات'),
                sectionCard([
                  if (owner)
                    ListTile(
                      leading: const Icon(
                        Icons.settings_rounded,
                        color: Color(0xFFBFA5FF),
                      ),
                      title: const Text(
                        'إعدادات الغرفة',
                        style: TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      subtitle: const Text(
                        'الاسم، الصورة، الخلفية، الخصوصية والدردشة.',
                        style: TextStyle(color: Colors.white54, fontSize: 10),
                      ),
                      trailing: const Icon(
                        Icons.chevron_left_rounded,
                        color: Colors.white38,
                      ),
                      onTap: () {
                        Navigator.pop(sheetContext);
                        _showRoomSettingsSheet();
                      },
                    ),
                  if (owner && _canManageIds)
                    const Divider(height: 1, color: Colors.white10),
                  if (_canManageIds)
                    ListTile(
                      leading: const Icon(
                        Icons.tag_rounded,
                        color: Color(0xFFFFD54A),
                      ),
                      title: const Text(
                        'تغيير معرّف الغرفة',
                        style: TextStyle(color: Colors.white),
                      ),
                      subtitle: const Text(
                        'من 3 إلى 8 أرقام.',
                        style: TextStyle(color: Colors.white54, fontSize: 10),
                      ),
                      onTap: () {
                        Navigator.pop(sheetContext);
                        _showChangeRoomIdSheet();
                      },
                    ),
                  if ((owner || _canManageIds))
                    const Divider(height: 1, color: Colors.white10),
                  ListTile(
                    leading: Icon(
                      ghostMode
                          ? Icons.visibility_off_rounded
                          : Icons.visibility_rounded,
                      color: ghostMode
                          ? const Color(0xFFBFA5FF)
                          : Colors.white54,
                    ),
                    title: const Text(
                      'إخفاء الوجود في الغرفة',
                      style: TextStyle(color: Colors.white),
                    ),
                    subtitle: Text(
                      !_canUseRoomGhostMode
                          ? 'تفتح من VIP$_roomGhostRequiredVipLevel.'
                          : ghostMode
                              ? 'مفعّل — لا يظهر وجودك للعامة داخل الغرفة.'
                              : 'متوقف — يظهر وجودك للعامة بشكل طبيعي.',
                      style: const TextStyle(
                        color: Colors.white54,
                        fontSize: 10,
                      ),
                    ),
                    trailing: Switch(
                      value: ghostMode,
                      onChanged: null,
                    ),
                    onTap: !_canUseRoomGhostMode
                        ? null
                        : () async {
                      try {
                        final next =
                            await _roomActions.setGhostMode(!ghostMode);
                        if (mounted) {
                          setState(() => _roomGhostMode = next);
                        }
                        if (sheetContext.mounted) {
                          Navigator.pop(sheetContext);
                        }
                        if (mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(
                              content: Text(
                                next
                                    ? 'تم تفعيل إخفاء الوجود.'
                                    : 'تم إيقاف إخفاء الوجود.',
                              ),
                            ),
                          );
                        }
                      } catch (_) {
                        if (mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                              content: Text(
                                'تعذر تحديث إخفاء الوجود حالياً.',
                              ),
                            ),
                          );
                        }
                      }
                    },
                  ),
                ]),

                sectionTitle('الجلسة'),
                sectionCard([
                  ListTile(
                    leading: const Icon(
                      Icons.logout_rounded,
                      color: Colors.orangeAccent,
                    ),
                    title: const Text(
                      'مغادرة الغرفة',
                      style: TextStyle(
                        color: Colors.orangeAccent,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    subtitle: const Text(
                      'خروج كامل وإنهاء وجودك في الغرفة.',
                      style: TextStyle(color: Colors.white54, fontSize: 10),
                    ),
                    onTap: () {
                      Navigator.pop(sheetContext);
                      _leaveVoiceRoom();
                    },
                  ),
                  if (personal && actualOwner) ...[
                    const Divider(height: 1, color: Colors.white10),
                    ListTile(
                      leading: const Icon(
                        Icons.power_settings_new_rounded,
                        color: Colors.redAccent,
                      ),
                      title: const Text(
                        'إغلاق الغرفة',
                        style: TextStyle(
                          color: Colors.redAccent,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      subtitle: const Text(
                        'ينهي الجلسة الحالية للجميع.',
                        style: TextStyle(color: Colors.white54, fontSize: 10),
                      ),
                      onTap: () async {
                        Navigator.pop(sheetContext);
                        final confirmed = await showDialog<bool>(
                          context: context,
                          builder: (dialogContext) => Directionality(
                            textDirection: TextDirection.rtl,
                            child: AlertDialog(
                              backgroundColor: const Color(0xFF111522),
                              title: const Text(
                                'إغلاق الغرفة؟',
                                style: TextStyle(color: Colors.white),
                              ),
                              content: const Text(
                                'سيتم إغلاق الغرفة وإنهاء الجلسة الحالية للجميع.',
                                style: TextStyle(color: Colors.white70),
                              ),
                              actions: [
                                TextButton(
                                  onPressed: () =>
                                      Navigator.pop(dialogContext, false),
                                  child: const Text('إلغاء'),
                                ),
                                FilledButton(
                                  style: FilledButton.styleFrom(
                                    backgroundColor: Colors.redAccent,
                                  ),
                                  onPressed: () =>
                                      Navigator.pop(dialogContext, true),
                                  child: const Text('إغلاق الغرفة'),
                                ),
                              ],
                            ),
                          ),
                        );
                        if (confirmed == true && mounted) {
                          await _closePersonalRoom();
                        }
                      },
                    ),
                  ],
                ]),
              ],
            ),
          ),
        ),
      ),
    );
  }

  @override
  void dispose() {
    unawaited(_roomLiveSubscription?.cancel());
    _voiceSession.removeListener(_syncVoiceSession);
    _roomActions.close();
    _userStorage.close();
    _roomInvites.close();
    _roomBootstrapService.close();
    _roomInsightsService.close();
    _roomModeration.close();
    _roomModeratorService.close();
    _roomSeatService.close();
    _roomEffectCoordinator.dispose();
    super.dispose();
  }

  String get _roomAgencyId => agencyIdForRoom(_roomArguments);

  String get _roomType =>
      (_roomArguments['roomType'] ?? _roomArguments['type'] ?? 'personal')
          .toString()
          .trim();

  bool get _isOfficialRoom {
    final type = _roomType;
    return _roomArguments['systemOwned'] == true ||
        _roomArguments['officialRoom'] == true ||
        const {'official', 'administrative', 'customer_service'}.contains(type);
  }

  bool get _isCustomerServiceRoom => _roomType == 'customer_service';

  bool _roomFeatureEnabled(String key) {
    if (_roomArguments.containsKey(key)) {
      return _roomArguments[key] == true;
    }
    return !_isCustomerServiceRoom;
  }

  bool get _roomGiftsEnabled => _roomFeatureEnabled('giftsEnabled');
  bool get _roomGamesEnabled => _roomFeatureEnabled('gamesEnabled');
  bool get _roomRocketEnabled => _roomFeatureEnabled('roomRocketEnabled');

  bool get _showRoomLevel => !_isOfficialRoom;
  bool get _showRoomSupport =>
      !_isCustomerServiceRoom && (!_isOfficialRoom || _roomGiftsEnabled);

  String get _roomCategoryLabel {
    if (_roomAgencyId.isNotEmpty) return 'وكالة';
    if (_roomType == 'customer_service') return 'خدمة العملاء';

    final category = (_roomArguments['category'] ?? '').toString().trim();
    if (_isOfficialRoom && (category.isEmpty || category == 'دردشة')) {
      return 'إداري';
    }
    return category.isEmpty ? 'دردشة' : category;
  }

  Color get _roomIdentityAccent {
    if (_roomAgencyId.isNotEmpty) return const Color(0xFFB99CFF);
    if (_isOfficialRoom) return const Color(0xFFFFD54A);
    return const Color(0xFFBFA5FF);
  }

  String get _officialRoomBadgeLabel {
    if (!_isOfficialRoom) return '';
    if (_roomType == 'customer_service') return 'خدمة العملاء';
    return 'Shadow Live';
  }

  String get _roomHeaderImageUrl =>
      roomSurfaceImageUrl(_roomArguments);

  void _openAgencyPage() {
    final agencyId = _roomAgencyId;
    if (agencyId.isEmpty) return;
    final viewerAgencyId =
        (_roomArguments['viewerAgencyId'] ?? '').toString().trim();
    final viewerAgencyRole =
        (_roomArguments['viewerAgencyRole'] ?? '').toString().trim();
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => PublicAgencyPage(
          agencyId: agencyId,
          viewerAgencyId: viewerAgencyId,
          viewerAgencyRole: viewerAgencyRole,
          joinEnabled: viewerAgencyId.isEmpty,
          joinBlockedReason: viewerAgencyId.isEmpty || viewerAgencyId == agencyId
              ? null
              : 'أنت عضو في وكالة أخرى؛ يمكنك مشاهدة معلومات هذه الوكالة فقط.',
        ),
      ),
    );
  }

  Widget _buildAgencyLogoButton() {
    if (_roomAgencyId.isEmpty) return const SizedBox.shrink();
    final logo =
        (_roomArguments['agencyLogoUrl'] ?? '').toString().trim();
    final name = (_roomArguments['agencyName'] ?? 'الوكالة').toString().trim();
    return Tooltip(
      message: name.isEmpty ? 'صفحة الوكالة' : name,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          key: const Key('agency-room-logo-button'),
          borderRadius: BorderRadius.circular(16),
          onTap: _openAgencyPage,
          child: Container(
            width: 48,
            height: 48,
            padding: const EdgeInsets.all(3),
            decoration: BoxDecoration(
              color: const Color(0xFF25183F).withValues(alpha: .94),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: const Color(0x66B99CFF)),
              boxShadow: const [
                BoxShadow(
                  color: Color(0x33000000),
                  blurRadius: 12,
                  offset: Offset(0, 5),
                ),
              ],
            ),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(12),
              child: logo.isEmpty
                  ? const ColoredBox(
                      color: Color(0xFF31204F),
                      child: Icon(
                        Icons.apartment_rounded,
                        color: Color(0xFFB99CFF),
                        size: 25,
                      ),
                    )
                  : Image.network(
                      logo,
                      fit: BoxFit.cover,
                      errorBuilder: (_, __, ___) => const ColoredBox(
                        color: Color(0xFF31204F),
                        child: Icon(
                          Icons.apartment_rounded,
                          color: Color(0xFFB99CFF),
                          size: 25,
                        ),
                      ),
                    ),
            ),
          ),
        ),
      ),
    );
  }

  Future<void> _copyRoomPublicId(String publicId) async {
    final value = publicId.trim();
    if (value.isEmpty || value == '—') return;
    await Clipboard.setData(ClipboardData(text: value));
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('تم نسخ ID الغرفة.'),
        duration: Duration(milliseconds: 1400),
      ),
    );
  }

  Widget _buildOfficialRoomBadge() {
    final label = _officialRoomBadgeLabel;
    if (label.isEmpty) return const SizedBox.shrink();

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
      decoration: BoxDecoration(
        color: const Color(0xFFFFD54A).withValues(alpha: .12),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(
          color: const Color(0xFFFFD54A).withValues(alpha: .38),
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(
            Icons.verified_rounded,
            size: 11,
            color: Color(0xFFFFD54A),
          ),
          const SizedBox(width: 3),
          Text(
            label,
            style: const TextStyle(
              color: Color(0xFFFFE082),
              fontSize: 8,
              fontWeight: FontWeight.w900,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildRoomHeader({
    required String roomTitle,
    required String roomPublicId,
    required RoomInsights? insights,
  }) {
    final accent = _roomIdentityAccent;
    final category = _roomCategoryLabel;

    return ClipRRect(
      borderRadius: BorderRadius.circular(18),
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 8, sigmaY: 8),
        child: Container(
          padding: const EdgeInsets.fromLTRB(8, 7, 6, 7),
          decoration: BoxDecoration(
            color: Colors.black.withValues(alpha: .24),
            borderRadius: BorderRadius.circular(18),
            border: Border.all(
              color: Colors.white.withValues(alpha: .09),
            ),
          ),
          child: Row(
            children: [
              GestureDetector(
                onTap: _showRoomInfoSheet,
                child: Container(
                  padding: const EdgeInsets.all(1.5),
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    border: Border.all(
                      color: accent.withValues(alpha: .72),
                    ),
                  ),
                  child: CircleAvatar(
                    radius: 20.5,
                    backgroundColor: const Color(0xFF171D2B),
                    backgroundImage: _roomHeaderImageUrl.isEmpty
                        ? null
                        : NetworkImage(_roomHeaderImageUrl),
                    child: _roomHeaderImageUrl.isEmpty
                        ? Icon(
                            _isOfficialRoom
                                ? Icons.shield_rounded
                                : Icons.person_rounded,
                            color: accent.withValues(alpha: .8),
                          )
                        : null,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Flexible(
                          child: Text(
                            roomTitle,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 15,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                        ),
                        const SizedBox(width: 4),
                        InkWell(
                          key: const Key('room-favorite-button'),
                          onTap: _changingRoomFavorite || insights == null
                              ? null
                              : _toggleRoomFavorite,
                          borderRadius: BorderRadius.circular(999),
                          child: Padding(
                            padding: const EdgeInsets.all(2),
                            child: Icon(
                              insights?.favorited == true
                                  ? Icons.star_rounded
                                  : Icons.star_border_rounded,
                              size: 18,
                              color: const Color(0xFFFFD54A),
                            ),
                          ),
                        ),
                        if (_isOfficialRoom) ...[
                          const SizedBox(width: 5),
                          _buildOfficialRoomBadge(),
                        ],
                      ],
                    ),
                    const SizedBox(height: 3),
                    Row(
                      children: [
                        InkWell(
                          onTap: () => _copyRoomPublicId(roomPublicId),
                          borderRadius: BorderRadius.circular(99),
                          child: const Padding(
                            padding: EdgeInsets.all(2),
                            child: Icon(
                              Icons.copy_rounded,
                              size: 12,
                              color: Colors.white54,
                            ),
                          ),
                        ),
                        const SizedBox(width: 3),
                        Text(
                          '# $roomPublicId',
                          textDirection: TextDirection.ltr,
                          style: const TextStyle(
                            color: Colors.white60,
                            fontSize: 9,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(width: 6),
                        Container(
                          width: 3,
                          height: 3,
                          decoration: const BoxDecoration(
                            color: Colors.white30,
                            shape: BoxShape.circle,
                          ),
                        ),
                        const SizedBox(width: 6),
                        Flexible(
                          child: Text(
                            category,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              color: accent.withValues(alpha: .92),
                              fontSize: 9,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                        const SizedBox(width: 5),
                        InkWell(
                          key: const Key('room-follow-button'),
                          onTap: _changingRoomFollow || insights == null
                              ? null
                              : _toggleRoomFollow,
                          borderRadius: BorderRadius.circular(999),
                          child: Padding(
                            padding: const EdgeInsets.all(2),
                            child: Icon(
                              insights?.followed == true
                                  ? Icons.favorite_rounded
                                  : Icons.favorite_border_rounded,
                              size: 16,
                              color: insights?.followed == true
                                  ? accent
                                  : Colors.white54,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              IconButton(
                tooltip: 'مشاركة الغرفة',
                visualDensity: VisualDensity.compact,
                onPressed: _showShareRoomSheet,
                icon: const Icon(
                  Icons.share_rounded,
                  size: 19,
                ),
              ),
              InkWell(
                onTap: _showRoomParticipantsSheet,
                borderRadius: BorderRadius.circular(999),
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 7,
                    vertical: 5,
                  ),
                  decoration: BoxDecoration(
                    color: Colors.black.withValues(alpha: .32),
                    borderRadius: BorderRadius.circular(999),
                    border: Border.all(color: Colors.white10),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(
                        Icons.people_alt_rounded,
                        size: 12,
                        color: Colors.white70,
                      ),
                      const SizedBox(width: 4),
                      Text(
                        _roomAudienceTotalCount.toString(),
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 9,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              IconButton(
                tooltip: 'المزيد',
                visualDensity: VisualDensity.compact,
                onPressed: _showRoomMenu,
                icon: const Icon(
                  Icons.more_horiz_rounded,
                  size: 21,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _showRoomLevelSheet() async {
    final insights = _roomInsights;
    if (insights == null) return;

    final rawType = (_roomArguments['roomType'] ??
            _roomArguments['type'] ??
            'personal')
        .toString();
    final isAgency = rawType == 'agency';
    final isCustomerService = rawType == 'customer_service';

    final seatByLevel = isCustomerService
        ? const <int>[5, 5, 5, 5, 5, 5]
        : isAgency
            ? const <int>[10, 12, 14, 16, 20, 22]
            : const <int>[8, 10, 12, 15, 20, 20];
    final moderatorByLevel = isCustomerService
        ? const <int>[2, 2, 2, 2, 2, 2]
        : isAgency
            ? const <int>[5, 6, 7, 9, 11, 14]
            : const <int>[3, 4, 5, 7, 9, 12];

    final remaining = max<num>(
      0,
      insights.levelTarget - insights.levelPoints,
    );

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF0D1019),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(26)),
      ),
      builder: (sheetContext) => Directionality(
        textDirection: TextDirection.rtl,
        child: SafeArea(
          child: SizedBox(
            height: MediaQuery.of(sheetContext).size.height * .68,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 14, 16, 18),
              child: Column(
                children: [
                  Container(
                    width: 44,
                    height: 4,
                    decoration: BoxDecoration(
                      color: Colors.white24,
                      borderRadius: BorderRadius.circular(99),
                    ),
                  ),
                  const SizedBox(height: 14),
                  Row(
                    children: [
                      const Icon(
                        Icons.workspace_premium_rounded,
                        color: Color(0xFFFFD54A),
                      ),
                      const SizedBox(width: 8),
                      Text(
                        'مستوى الغرفة — LV.${insights.level}',
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 20,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 14),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: const Color(0xFF151A27),
                      borderRadius: BorderRadius.circular(18),
                      border: Border.all(color: Colors.white10),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '${insights.levelPoints} / ${insights.levelTarget} نقطة',
                          style: const TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        const SizedBox(height: 9),
                        LinearProgressIndicator(
                          value: insights.levelProgress,
                          minHeight: 7,
                          borderRadius: BorderRadius.circular(99),
                          color: const Color(0xFF8A3DFF),
                          backgroundColor: Colors.white12,
                        ),
                        const SizedBox(height: 8),
                        Text(
                          insights.level >= 6
                              ? 'وصلت الغرفة إلى أعلى Level حاليًا.'
                              : 'باقي $remaining نقطة للوصول إلى LV.${insights.level + 1}',
                          style: const TextStyle(
                            color: Colors.white60,
                            fontSize: 12,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      Expanded(
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 8,
                          ),
                          decoration: BoxDecoration(
                            color: const Color(0xFF151A27),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Column(
                            children: [
                              const Text(
                                'اليوم',
                                style: TextStyle(
                                  color: Colors.white54,
                                  fontSize: 10,
                                ),
                              ),
                              const SizedBox(height: 3),
                              Text(
                                insights.dailySupport.toString(),
                                style: const TextStyle(
                                  color: Color(0xFFFFD54A),
                                  fontWeight: FontWeight.w900,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                      const SizedBox(width: 7),
                      Expanded(
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 8,
                          ),
                          decoration: BoxDecoration(
                            color: const Color(0xFF151A27),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Column(
                            children: [
                              const Text(
                                'الأسبوع',
                                style: TextStyle(
                                  color: Colors.white54,
                                  fontSize: 10,
                                ),
                              ),
                              const SizedBox(height: 3),
                              Text(
                                insights.weeklySupport.toString(),
                                style: const TextStyle(
                                  color: Color(0xFFC9B8FF),
                                  fontWeight: FontWeight.w900,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                      const SizedBox(width: 7),
                      Expanded(
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 8,
                          ),
                          decoration: BoxDecoration(
                            color: const Color(0xFF151A27),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Column(
                            children: [
                              const Text(
                                'الشهر',
                                style: TextStyle(
                                  color: Colors.white54,
                                  fontSize: 10,
                                ),
                              ),
                              const SizedBox(height: 3),
                              Text(
                                insights.monthlySupport.toString(),
                                style: const TextStyle(
                                  color: Color(0xFF72D572),
                                  fontWeight: FontWeight.w900,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 14),
                  const Align(
                    alignment: Alignment.centerRight,
                    child: Text(
                      'ميزات المستويات',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 16,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ),
                  const SizedBox(height: 8),
                  Expanded(
                    child: ListView.separated(
                      itemCount: 6,
                      separatorBuilder: (_, __) =>
                          const Divider(color: Colors.white10, height: 1),
                      itemBuilder: (_, index) {
                        final level = index + 1;
                        final current = level == insights.level;
                        final reached = level <= insights.level;
                        return Container(
                          color: current
                              ? const Color(0xFF8A3DFF).withValues(alpha: .12)
                              : Colors.transparent,
                          child: ListTile(
                            leading: CircleAvatar(
                              radius: 18,
                              backgroundColor: reached
                                  ? const Color(0xFFFFD54A)
                                  : const Color(0xFF202534),
                              child: Text(
                                level.toString(),
                                style: TextStyle(
                                  color: reached ? Colors.black : Colors.white60,
                                  fontWeight: FontWeight.w900,
                                ),
                              ),
                            ),
                            title: Text(
                              'LV.$level',
                              style: TextStyle(
                                color: current
                                    ? const Color(0xFFFFD54A)
                                    : Colors.white,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                            subtitle: Text(
                              '${seatByLevel[index]} مايك • حتى ${moderatorByLevel[index]} مشرف',
                              style: const TextStyle(
                                color: Colors.white60,
                                fontSize: 11,
                              ),
                            ),
                            trailing: current
                                ? const Chip(label: Text('الحالي'))
                                : reached
                                    ? const Icon(
                                        Icons.check_circle_rounded,
                                        color: Color(0xFF72D572),
                                      )
                                    : const Icon(
                                        Icons.lock_outline_rounded,
                                        color: Colors.white30,
                                      ),
                          ),
                        );
                      },
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Future<void> _showRoomRocketSheet() async {
    if (!_roomRocketEnabled) return;
    final roomId = (_roomArguments['roomId'] ?? '').toString().trim();
    if (roomId.isEmpty) return;
    final service = RoomRocketService();
    try {
      await showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        backgroundColor: const Color(0xFF0C101A),
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(26)),
        ),
        builder: (sheetContext) => Directionality(
          textDirection: TextDirection.rtl,
          child: SafeArea(
            child: StreamBuilder<RoomRocketState>(
              stream: service.watchRoomState(roomId),
              initialData: _bootstrapRocketState,
              builder: (context, snapshot) {
                final state = snapshot.data ??
                    const RoomRocketState(
                      currentLevel: 1,
                      progressCoins: 0,
                      thresholdCoins: 100000,
                      contributors: [],
                    );
                final top = state.contributors.take(3).toList(growable: false);
                return Padding(
                  padding: const EdgeInsets.fromLTRB(18, 16, 18, 22),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Row(
                        children: [
                          const Icon(
                            Icons.rocket_launch_rounded,
                            color: Color(0xFFFFD54A),
                            size: 30,
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Text(
                              'صاروخ الغرفة • LV.${state.currentLevel}',
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 20,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 16),
                      LinearProgressIndicator(
                        value: state.progress,
                        minHeight: 9,
                        borderRadius: BorderRadius.circular(99),
                        color: const Color(0xFFFFD54A),
                        backgroundColor: Colors.white12,
                      ),
                      const SizedBox(height: 8),
                      Text(
                        '${state.progressCoins} / ${state.thresholdCoins} Coins',
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          color: Colors.white70,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 18),
                      const Text(
                        'أعلى المساهمين في المستوى الحالي',
                        style: TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      const SizedBox(height: 8),
                      if (top.isEmpty)
                        const Padding(
                          padding: EdgeInsets.symmetric(vertical: 14),
                          child: Text(
                            'لا توجد مساهمات بعد',
                            textAlign: TextAlign.center,
                            style: TextStyle(color: Colors.white54),
                          ),
                        )
                      else
                        ...top.asMap().entries.map((entry) {
                          final item = entry.value;
                          final name =
                              (item['displayName'] ?? 'مستخدم Shadow Live')
                                  .toString();
                          final userId =
                              (item['uid'] ?? item['userId'] ?? '')
                                  .toString()
                                  .trim();
                          final photo =
                              (item['profileImageUrl'] ?? '').toString();
                          final coins = (item['coins'] as num?)?.toInt() ?? 0;
                          return ListTile(
                            contentPadding: EdgeInsets.zero,
                            leading: userId.isEmpty
                                ? CircleAvatar(
                                    backgroundColor:
                                        const Color(0xFF25183F),
                                    child: Text(
                                      '${entry.key + 1}',
                                      style: const TextStyle(
                                        color: Color(0xFFFFD54A),
                                        fontWeight: FontWeight.w900,
                                      ),
                                    ),
                                  )
                                : ProfileAvatarWithFrame(
                                    diameter: 40,
                                    userId: userId,
                                    backgroundColor:
                                        const Color(0xFF25183F),
                                    placeholderColor:
                                        const Color(0xFFFFD54A),
                                    fallbackProfile: <String, dynamic>{
                                      'profileImageUrl': photo,
                                      'profileAvatarAsset':
                                          (item['profileAvatarAsset'] ?? '')
                                              .toString(),
                                    },
                                  ),
                            title: Text(
                              name,
                              style: const TextStyle(
                                color: Colors.white,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                            trailing: Text(
                              '$coins Coins',
                              style: const TextStyle(
                                color: Color(0xFFFFD54A),
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                          );
                        }),
                    ],
                  ),
                );
              },
            ),
          ),
        ),
      );
    } finally {
      service.close();
    }
  }

  Widget _buildRoomRocketButton() {
    if (!_roomRocketEnabled) return const SizedBox.shrink();
    return Tooltip(
      message: 'صاروخ الغرفة',
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: _showRoomRocketSheet,
          child: Container(
            width: 48,
            height: 48,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: const Color(0xFF25183F).withValues(alpha: .94),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: const Color(0x66FFD54A)),
              boxShadow: const [
                BoxShadow(
                  color: Color(0x33000000),
                  blurRadius: 12,
                  offset: Offset(0, 5),
                ),
              ],
            ),
            child: const Icon(
              Icons.rocket_launch_rounded,
              color: Color(0xFFFFD54A),
              size: 27,
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildSupporterCluster() {
    final top = (_roomInsights?.supporters ?? const <RoomSupporter>[])
        .take(3)
        .toList();
    if (top.isEmpty) return const SizedBox.shrink();

    return InkWell(
      onTap: _showSupportersSheet,
      borderRadius: BorderRadius.circular(999),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: List.generate(top.length, (index) {
          final supporter = top[index];
          return Transform.translate(
            offset: Offset(index * 5.0, 0),
            child: Stack(
              clipBehavior: Clip.none,
              children: [
                supporter.mysteriousMode
                    ? const MysteriousIdentityAvatar(diameter: 28)
                    : ProfileAvatarWithFrame(
                        diameter: 28,
                        userId: supporter.uid,
                        backgroundColor: const Color(0xFF25183F),
                        placeholderColor: Colors.white,
                        fallbackProfile: <String, dynamic>{
                          'profileImageUrl': supporter.profileImageUrl,
                          'activeProfileFrameAssetKey':
                              supporter.activeProfileFrameAssetKey,
                          'activeProfileFrameImageUrl':
                              supporter.activeProfileFrameImageUrl,
                          'activeProfileFrameExpiresAtMs':
                              supporter.activeProfileFrameExpiresAtMs,
                          'activeProfileFramePermanent':
                              supporter.activeProfileFramePermanent,
                        },
                        fallbackIsVisualSnapshot: true,
                        vipLevel: supporter.vipLevel,
                        useVipFallback: true,
                      ),
                Positioned(
                  right: -2,
                  top: -4,
                  child: Container(
                    width: 14,
                    height: 14,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: index == 0
                          ? const Color(0xFFFFD54A)
                          : index == 1
                              ? const Color(0xFFC7D0D9)
                              : const Color(0xFFDE9C73),
                      shape: BoxShape.circle,
                    ),
                    child: Text(
                      (index + 1).toString(),
                      style: const TextStyle(
                        color: Colors.black,
                        fontSize: 7,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          );
        }),
      ),
    );
  }

  Widget _buildRoomInsightsBar() {
    final insights = _roomInsights;
    if (!_showRoomLevel && !_showRoomSupport) {
      return const SizedBox.shrink();
    }
    if (insights == null) {
      return _loadingRoomInsights
          ? const LinearProgressIndicator(
              minHeight: 2,
              color: Color(0xFF8A3DFF),
              backgroundColor: Colors.transparent,
            )
          : const SizedBox.shrink();
    }

    Widget levelBox() => InkWell(
          onTap: _showRoomLevelSheet,
          borderRadius: BorderRadius.circular(12),
          child: Container(
            width: 118,
            padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
            decoration: BoxDecoration(
              color: const Color(0xFF111522).withValues(alpha: .86),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: Colors.white10),
            ),
            child: Row(
              children: [
                Text(
                  'LV.${insights.level}',
                  style: const TextStyle(
                    color: Color(0xFFFFD54A),
                    fontSize: 11,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: LinearProgressIndicator(
                    value: insights.levelProgress,
                    minHeight: 3,
                    borderRadius: BorderRadius.circular(99),
                    color: const Color(0xFF8A3DFF),
                    backgroundColor: Colors.white12,
                  ),
                ),
              ],
            ),
          ),
        );

    Widget rankingBox() => InkWell(
          onTap: _showRoomRankingSheet,
          borderRadius: BorderRadius.circular(999),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
            decoration: BoxDecoration(
              color: const Color(0xFF111522).withValues(alpha: .86),
              borderRadius: BorderRadius.circular(999),
              border: Border.all(color: Colors.white10),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(
                  Icons.emoji_events_rounded,
                  color: Color(0xFFFFD54A),
                  size: 14,
                ),
                const SizedBox(width: 4),
                Text(
                  insights.dailyRank == null
                      ? 'الترتيب اليومي'
                      : 'TOP ${insights.dailyRank} اليومي',
                  style: const TextStyle(
                    color: Colors.white70,
                    fontSize: 9,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ],
            ),
          ),
        );

    return Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        if (_showRoomSupport) rankingBox(),
        const Spacer(),
        if (_showRoomSupport || _showRoomLevel)
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (_showRoomSupport) _buildSupporterCluster(),
              if (_showRoomSupport && _showRoomLevel)
                const SizedBox(height: 6),
              if (_showRoomLevel) levelBox(),
            ],
          ),
      ],
    );
  }

  Widget _buildRoomBottomBar() {
    final roomId = (_roomArguments['roomId'] ?? '').toString();
    final requestCount = _roomSeatState?.micRequests.length ?? 0;

    Widget circleButton({
      required IconData icon,
      required String tooltip,
      required VoidCallback? onPressed,
      Color color = Colors.white,
    }) {
      return SizedBox(
        width: 38,
        height: 38,
        child: IconButton(
          tooltip: tooltip,
          onPressed: onPressed,
          padding: EdgeInsets.zero,
          visualDensity: VisualDensity.compact,
          style: IconButton.styleFrom(
            backgroundColor: Colors.white.withValues(alpha: .06),
          ),
          icon: Icon(icon, color: color, size: 21),
        ),
      );
    }

    return Container(
      padding: const EdgeInsets.fromLTRB(8, 7, 8, 7),
      decoration: BoxDecoration(
        color: const Color(0xFF090B12).withValues(alpha: .98),
        border: const Border(top: BorderSide(color: Colors.white10)),
      ),
      child: Row(
        children: [
          circleButton(
            icon: _voiceMicMuted ? Icons.mic_off_rounded : Icons.mic_rounded,
            tooltip: 'كتم / تشغيل المايك',
            onPressed: _voiceJoining || _voiceError != null
                ? null
                : _toggleVoiceMic,
            color: _voiceMicMuted ? Colors.white54 : const Color(0xFFFFD54A),
          ),
          if (_canManageMic) ...[
            const SizedBox(width: 5),
            Stack(
              clipBehavior: Clip.none,
              children: [
                circleButton(
                  icon: Icons.front_hand_rounded,
                  tooltip: 'طلبات المايك',
                  onPressed: _showMicRequestsSheet,
                  color: const Color(0xFFFFD54A),
                ),
                if (requestCount > 0)
                  Positioned(
                    top: -4,
                    left: -2,
                    child: Container(
                      padding: const EdgeInsets.all(4),
                      decoration: const BoxDecoration(
                        color: Colors.redAccent,
                        shape: BoxShape.circle,
                      ),
                      child: Text(
                        requestCount > 9 ? '9+' : requestCount.toString(),
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 8,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ],
          const SizedBox(width: 6),
          Expanded(
            child: RoomChatComposer(
              roomId: roomId,
              chatEnabled: _roomArguments['chatEnabled'] != false,
              isOwner: _canModerateChat,
            ),
          ),
          const SizedBox(width: 5),
          if (_roomGiftsEnabled) ...[
            circleButton(
              icon: Icons.card_giftcard_rounded,
              tooltip: 'الهدايا',
              onPressed: roomId.isEmpty
                  ? null
                  : () => showRoomGiftSheet(
                        context,
                        roomId: roomId,
                        ownerUid: (_roomArguments['ownerUid'] ??
                                _roomArguments['ownerId'] ??
                                _roomArguments['hostId'] ??
                                '')
                            .toString(),
                        ownerPhotoUrl: _ownerPhotoUrl,
                        participants: _voiceSession.roomParticipants,
                        seats: _roomSeatState?.seats ?? const <VoiceSeat>[],
                        ensurePresence:
                            _voiceSession.ensureRoomPresenceReady,
                      ),
              color: const Color(0xFFFFD54A),
            ),
            const SizedBox(width: 5),
          ],
          circleButton(
            icon: Icons.chat_bubble_rounded,
            tooltip: 'الرسائل',
            onPressed: () => _minimizeVoiceRoom(destinationNavIndex: 3),
            color: const Color(0xFFBFA5FF),
          ),
          const SizedBox(width: 5),
          circleButton(
            icon: Icons.grid_view_rounded,
            tooltip: 'الأدوات',
            onPressed: _showToolsSheet,
          ),
        ],
      ),
    );
  }

  Widget _buildRoomBackground({
    required String rewardImageUrl,
    required String rewardAssetKey,
  }) {
    Widget fallback() => const DecoratedBox(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [
                Color(0xFF24123D),
                Color(0xFF080A10),
                Colors.black,
              ],
            ),
          ),
        );

    if (rewardImageUrl.isNotEmpty) {
      return Image.network(
        rewardImageUrl,
        fit: BoxFit.cover,
        errorBuilder: (_, __, ___) => fallback(),
      );
    }
    if (rewardAssetKey.isNotEmpty) {
      return FutureBuilder<Uri?>(
        future: ShadowAssetRegistry.remoteUrl(rewardAssetKey),
        builder: (context, snapshot) {
          final uri = snapshot.data;
          if (uri == null) return fallback();
          return Image.network(
            uri.toString(),
            fit: BoxFit.cover,
            errorBuilder: (_, __, ___) => fallback(),
          );
        },
      );
    }
    return fallback();
  }

  @override
  Widget build(BuildContext context) {
    final roomId = (_roomArguments['roomId'] ?? '').toString();
    final rewardBackgroundExpiresAtMs =
        (_roomArguments['activeRoomBackgroundExpiresAtMs'] as num?)?.toInt() ??
            0;
    final rawRewardBackgroundImageUrl =
        (_roomArguments['activeRoomBackgroundImageUrl'] ?? '')
            .toString()
            .trim();
    final rawRewardBackgroundAssetKey =
        (_roomArguments['activeRoomBackgroundAssetKey'] ?? '')
            .toString()
            .trim();
    final hasRewardBackground =
        rawRewardBackgroundImageUrl.isNotEmpty ||
        rawRewardBackgroundAssetKey.isNotEmpty;
    final rewardBackgroundValid = hasRewardBackground &&
        (rewardBackgroundExpiresAtMs == 0 ||
            rewardBackgroundExpiresAtMs >
                DateTime.now().millisecondsSinceEpoch);
    final rewardBackgroundImageUrl =
        rewardBackgroundValid ? rawRewardBackgroundImageUrl : '';
    final rewardBackgroundAssetKey =
        rewardBackgroundValid ? rawRewardBackgroundAssetKey : '';
    final roomTitle = (_roomArguments['name'] ??
            _roomArguments['title'] ??
            'غرفة صوتية')
        .toString();
    final roomPublicId = (_roomArguments['publicId'] ?? '—').toString();
    final ownerUid = (_roomArguments['ownerUid'] ??
            _roomArguments['ownerId'] ??
            _roomArguments['hostId'] ??
            '')
        .toString();
    final insights = _roomInsights;

    return PopScope<Object?>(
      canPop: false,
      onPopInvokedWithResult: (didPop, result) {
        if (!didPop) unawaited(_minimizeVoiceRoom());
      },
      child: Directionality(
        textDirection: TextDirection.rtl,
        child: Scaffold(
        backgroundColor: Colors.black,
        resizeToAvoidBottomInset: true,
        body: SafeArea(
          child: Center(
            child: Container(
              constraints: const BoxConstraints(maxWidth: 430),
              child: LayoutBuilder(
                builder: (context, constraints) {
                  final height = constraints.maxHeight;
                  final micTop = min(165.0, height * .21);
                  final micHeight = max(320.0, height * .50);
                  final feedTop = min(height - 145, micTop + micHeight - 6);

                  return Stack(
                    children: [
                      Positioned.fill(
                        child: _buildRoomBackground(
                          rewardImageUrl: rewardBackgroundImageUrl,
                          rewardAssetKey: rewardBackgroundAssetKey,
                        ),
                      ),
                      Positioned.fill(
                        child: DecoratedBox(
                          decoration: BoxDecoration(
                            gradient: LinearGradient(
                              begin: Alignment.topCenter,
                              end: Alignment.bottomCenter,
                              colors: [
                                Colors.black.withValues(alpha: .42),
                                Colors.black.withValues(alpha: .72),
                                Colors.black,
                              ],
                            ),
                          ),
                        ),
                      ),
                      Positioned.fill(
                        child: RoomEffectCoordinatorHost(
                          coordinator: _roomEffectCoordinator,
                        ),
                      ),
                      Positioned(
                        top: 0,
                        left: 0,
                        right: 0,
                        child: Padding(
                          padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
                          child: Column(
                            children: [
                              _buildRoomHeader(
                                roomTitle: roomTitle,
                                roomPublicId: roomPublicId,
                                insights: insights,
                              ),
                              const SizedBox(height: 6),
                              _buildRoomInsightsBar(),
                              const SizedBox(height: 4),
                              _buildMicStatusBanner(),
                            ],
                          ),
                        ),
                      ),
                      Positioned(
                        top: micTop,
                        left: 10,
                        right: 10,
                        height: micHeight,
                        child: SingleChildScrollView(
                          physics: const BouncingScrollPhysics(),
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              _buildVoiceSeats(),
                              const SizedBox(height: 5),
                              _buildRoomAudienceStrip(),
                            ],
                          ),
                        ),
                      ),
                      Positioned.fill(
                        top: feedTop,
                        bottom: 57,
                        child: DraggableScrollableSheet(
                          initialChildSize: .56,
                          minChildSize: .22,
                          maxChildSize: 1,
                          snap: true,
                          snapSizes: const [.22, .56, 1],
                          builder: (context, scrollController) => Container(
                            decoration: BoxDecoration(
                              color: const Color(0xFF090C13)
                                  .withValues(alpha: .94),
                              borderRadius: const BorderRadius.vertical(
                                top: Radius.circular(22),
                              ),
                              border: Border.all(color: Colors.white10),
                            ),
                            child: Stack(
                              children: [
                                Column(
                                  children: [
                                    const SizedBox(height: 7),
                                Container(
                                  width: 42,
                                  height: 4,
                                  decoration: BoxDecoration(
                                    color: Colors.white24,
                                    borderRadius: BorderRadius.circular(99),
                                  ),
                                ),
                                const SizedBox(height: 4),
                                Expanded(
                                  child: const bool.fromEnvironment('E2E_ROOM_TEST')
                                      ? ListView(
                                          controller: scrollController,
                                          padding: const EdgeInsets.fromLTRB(12, 10, 12, 12),
                                          children: const [
                                            Text(
                                              'Shadow دخل إلى الغرفة',
                                              style: TextStyle(color: Colors.white60, fontSize: 11),
                                            ),
                                            SizedBox(height: 10),
                                            Text(
                                              'Ashraf: أهلاً وسهلاً بالجميع',
                                              style: TextStyle(color: Colors.white, fontSize: 11),
                                            ),
                                            SizedBox(height: 10),
                                            Text(
                                              'Shadow أرسل هدية التاج إلى Ashraf — 10,000 كوينز',
                                              style: TextStyle(color: Color(0xFFFFD54A), fontSize: 11),
                                            ),
                                          ],
                                        )
                                      : RoomChatFeed(
                                          roomId: roomId,
                                          roomEffectsEnabled: _roomEffectsEnabled,
                                          effectSoundEnabled: _effectSoundEnabled,
                                          scrollController: scrollController,
                                        ),
                                ),
                                  ],
                                ),
                                Positioned(
                                  left: 12,
                                  top: 22,
                                  child: Column(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      if (_roomAgencyId.isNotEmpty) ...[
                                        _buildAgencyLogoButton(),
                                        const SizedBox(height: 8),
                                      ],
                                      _buildRoomRocketButton(),
                                    ],
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                      Positioned(
                        left: 0,
                        right: 0,
                        bottom: 0,
                        child: _buildRoomBottomBar(),
                      ),
                    ],
                  );
                },
              ),
            ),
          ),
        ),
      ),
    ),
    );
  }
}

class _RoomToolToggle extends StatelessWidget {
  const _RoomToolToggle({
    required this.icon,
    required this.label,
    required this.value,
    required this.onChanged,
  });

  final IconData icon;
  final String label;
  final bool value;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Container(
          width: 58,
          height: 58,
          decoration: const BoxDecoration(
            color: Color(0xFF262626),
            shape: BoxShape.circle,
          ),
          child: Stack(
            children: [
              Center(
                child: Icon(
                  icon,
                  color: const Color(0xFFBBD4FF),
                  size: 30,
                ),
              ),
              Positioned(
                right: -3,
                bottom: -5,
                child: Transform.scale(
                  scale: .65,
                  child: Switch(
                    value: value,
                    onChanged: onChanged,
                    activeThumbColor: Colors.white,
                    activeTrackColor: const Color(0xFF5A20FF),
                  ),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 7),
        Text(
          label,
          textAlign: TextAlign.center,
          maxLines: 2,
          style: const TextStyle(
            color: Colors.white70,
            fontSize: 11,
          ),
        ),
      ],
    );
  }
}
