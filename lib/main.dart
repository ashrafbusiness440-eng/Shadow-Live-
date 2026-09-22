import 'dart:async';
import 'dart:math';
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
import 'widgets/host_section.dart';
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
import 'features/profile/widgets/quick_profile_sheet.dart';
import 'screens/room/create_room_screen.dart';
import 'screens/room/room_list_screen.dart';
import 'screens/settings/settings_screen.dart';
import 'services/navigation_service.dart';
import 'features/voice/services/voice_room_session_controller.dart';
import 'features/room/services/room_action_service.dart';
import 'features/room/services/room_invite_service.dart';
import 'features/room/services/room_insights_service.dart';
import 'features/room/services/room_moderation_service.dart';
import 'features/room/services/room_moderator_service.dart';
import 'features/room/services/room_presence_service.dart';
import 'features/room/widgets/room_chat_panel.dart';
import 'features/room/widgets/room_moderator_manager_sheet.dart';
import 'features/room/widgets/room_music_sheet.dart';
import 'features/room/widgets/room_pk_panel.dart';
import 'features/room/widgets/star_battle_sheet.dart';
import 'features/room/services/room_seat_service.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp(
    options: DefaultFirebaseOptions.currentPlatform,
  );

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
  final VoiceRoomSessionController _voiceSession =
      VoiceRoomSessionController.instance;
  final RoomActionService _roomActions = RoomActionService();
  final RoomInviteService _roomInvites = RoomInviteService();
  final RoomInsightsService _roomInsightsService = RoomInsightsService();
  final RoomModerationService _roomModeration = RoomModerationService();
  final RoomModeratorService _roomModeratorService = RoomModeratorService();
  final RoomPresenceService _roomPresence = RoomPresenceService();
  final RoomSeatService _roomSeatService = RoomSeatService();
  bool _voiceStarted = false;

  @override
  void initState() {
    super.initState();
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
    });
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
  RoomInsights? _roomInsights;
  bool _loadingRoomInsights = false;
  bool _changingRoomFollow = false;
  bool _changingRoomFavorite = false;
  RoomSeatState? _roomSeatState;
  bool _changingSeat = false;
  StreamSubscription<RoomSeatState>? _roomSeatSubscription;
  RoomModeratorState? _roomModeratorState;
  StreamSubscription<RoomModeratorState>? _roomModeratorSubscription;
  bool _roomClosedHandled = false;

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
          'onlineCount': 18,
          'chatEnabled': true,
          'level': 3,
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
          level: 3,
          levelPoints: 4600,
          levelTarget: 7000,
          followerCount: 320,
          followed: true,
          favorited: true,
          dailySupport: 18500,
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
      return;
    }
    final raw = ModalRoute.of(context)?.settings.arguments;
    final args = raw is Map ? Map<String, dynamic>.from(raw) : <String, dynamic>{};
    _roomArguments = args;
    unawaited(_loadOwnerProfile(args));
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
      unawaited(_loadRoomInsights(roomId));
      unawaited(_loadRoomSeatState(roomId));
      unawaited(_watchRoomModerators(roomId));
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
    if (_voiceJoining || _voiceError != null) return;
    final uid = FirebaseAuth.instance.currentUser?.uid ?? '';
    final state = _roomSeatState;
    final roomId = (_roomArguments['roomId'] ?? '').toString();
    final hasSeat =
        state?.seats.any((seat) => seat.uid == uid) == true;
    final canSpeak = state?.isOwner == true || hasSeat;

    if (!canSpeak) {
      if (state == null) return;
      if (!state.micInviteOnly) {
        final emptySeats = state.seats.where((seat) => !seat.occupied).toList();
        if (emptySeats.isEmpty) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('لا يوجد مايك فارغ حالياً.')),
          );
          return;
        }
        await _runSeatAction(
          () => _roomSeatService.takeSeat(
            roomId: roomId,
            seatIndex: emptySeats.first.index,
          ),
        );
        try {
          await _voiceSession.setMicMuted(false);
          if (mounted) setState(() => _voiceMicMuted = false);
        } catch (_) {}
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
            const SnackBar(content: Text('تم إرسال طلب المايك للمشرفين.')),
          );
        }
      }
      return;
    }

    try {
      await _voiceSession.toggleMic();
      final muted = _voiceSession.micMuted;
      if (hasSeat && roomId.isNotEmpty) {
        await _runSeatAction(
          () => _roomSeatService.setSeatMuted(
            roomId: roomId,
            muted: muted,
          ),
        );
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

  Future<void> _watchRoomModerators(String roomId) async {
    if (roomId.isEmpty) return;
    await _roomModeratorSubscription?.cancel();
    _roomModeratorSubscription =
        _roomModeratorService.watch(roomId).listen(
      (state) {
        if (mounted) setState(() => _roomModeratorState = state);
      },
      onError: (_) {},
    );
  }

  bool get _canManageMic =>
      _voiceSession.isOwner ||
      (_roomModeratorState?.has('manageMic') ?? false);

  bool get _canModerateUsers =>
      _voiceSession.isOwner ||
      (_roomModeratorState?.has('moderateUsers') ?? false);

  bool get _canModerateChat =>
      _voiceSession.isOwner ||
      (_roomModeratorState?.has('moderateChat') ?? false);

  bool get _canManageMusic =>
      _voiceSession.isOwner ||
      (_roomModeratorState?.has('manageMusic') ?? false);

  bool get _canManageMusicPolicy =>
      _voiceSession.isOwner ||
      (_roomModeratorState?.has('manageMusicPolicy') ?? false);

  bool get _canManagePk =>
      _voiceSession.isOwner ||
      (_roomModeratorState?.has('managePk') ?? false);

  bool get _canManageIds =>
      _voiceSession.isOwner ||
      (_roomModeratorState?.has('manageIds') ?? false);

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

  Future<void> _loadRoomSeatState(String roomId) async {
    if (roomId.isEmpty) return;
    await _roomSeatSubscription?.cancel();
    _roomSeatSubscription = _roomSeatService.watch(roomId).listen(
      (state) {
        if (!mounted) return;
        setState(() {
          _roomSeatState = state;
          _roomArguments = {
            ..._roomArguments,
            'onlineCount': state.onlineCount,
          };
        });

        final uid = FirebaseAuth.instance.currentUser?.uid ?? '';
        final hasSeat = state.seats.any((seat) => seat.uid == uid);
        if (!state.isOwner &&
            !hasSeat &&
            !_voiceSession.micMuted &&
            _voiceSession.active) {
          unawaited(_voiceSession.setMicMuted(true));
        }

        if (!state.isActive && _voiceSession.active) {
          unawaited(_voiceSession.leave());
        }
      },
      onError: (_) {},
    );

    try {
      final state = await _roomSeatService.load(roomId);
      if (mounted) setState(() => _roomSeatState = state);
    } catch (_) {}
  }

  Future<void> _runSeatAction(
    Future<RoomSeatState> Function() action,
  ) async {
    if (_changingSeat) return;
    setState(() => _changingSeat = true);
    try {
      final state = await action();
      if (mounted) setState(() => _roomSeatState = state);
    } on StateError catch (error) {
      if (!mounted) return;
      final code = error.message.toString();
      final message = code == 'mic_invite_required'
          ? 'لازم صاحب الغرفة يقبل طلب المايك أولاً.'
          : code == 'seat_occupied'
              ? 'هذا المقعد مستخدم حالياً.'
              : 'تعذر تنفيذ العملية حالياً.';
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(message)),
      );
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

    await showQuickProfileSheet(
      context,
      userId: seat.uid,
      adminActions: actions,
    );
  }

  Future<void> _handleSeatTap(VoiceSeat seat) async {
    final roomId = (_roomArguments['roomId'] ?? '').toString();
    final uid = FirebaseAuth.instance.currentUser?.uid ?? '';
    final state = _roomSeatState;
    if (roomId.isEmpty || uid.isEmpty || state == null) return;
    final hasSeat = state.seats.any((current) => current.uid == uid);

    if (!seat.occupied) {
      if (hasSeat) {
        await _runSeatAction(
          () => _roomSeatService.switchSeat(
            roomId: roomId,
            seatIndex: seat.index,
          ),
        );
      } else if (state.isOwner || state.invited(uid) || !state.micInviteOnly) {
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
            const SnackBar(content: Text('تم إرسال طلب المايك للمشرفين.')),
          );
        }
      }
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
              unawaited(
                _runSeatAction(() => _roomSeatService.leaveSeat(roomId)),
              );
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
                              leading: CircleAvatar(
                                backgroundColor:
                                    const Color(0xFF25183F),
                                backgroundImage:
                                    ban.profileImageUrl.isEmpty
                                        ? null
                                        : NetworkImage(
                                            ban.profileImageUrl,
                                          ),
                                child: ban.profileImageUrl.isEmpty
                                    ? const Icon(
                                        Icons.person_rounded,
                                        color: Colors.white54,
                                      )
                                    : null,
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

  Future<void> _showInviteToMicSheet() async {
    final roomId = (_roomArguments['roomId'] ?? '').toString();
    if (roomId.isEmpty || !_canManageMic) return;
    final me = FirebaseAuth.instance.currentUser?.uid ?? '';
    final occupied = (_roomSeatState?.seats ?? const <VoiceSeat>[])
        .where((seat) => seat.uid.isNotEmpty)
        .map((seat) => seat.uid)
        .toSet();

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
                        Icons.mic_external_on_rounded,
                        color: Color(0xFFFFD54A),
                      ),
                      SizedBox(width: 8),
                      Text(
                        'دعوة للمايك',
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
                    child: FutureBuilder<List<RoomPresenceUser>>(
                      future: _roomPresence.load(roomId),
                      builder: (context, snapshot) {
                        if (snapshot.connectionState !=
                            ConnectionState.done) {
                          return const Center(
                            child: CircularProgressIndicator(
                              color: Color(0xFF8A3DFF),
                            ),
                          );
                        }
                        final users = (snapshot.data ?? const [])
                            .where(
                              (user) =>
                                  user.uid != me &&
                                  !occupied.contains(user.uid),
                            )
                            .toList();
                        if (users.isEmpty) {
                          return const Center(
                            child: Text(
                              'لا يوجد مستمعون متاحون للدعوة حالياً',
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
                            final invited =
                                _roomSeatState?.invited(user.uid) == true;
                            return ListTile(
                              contentPadding: EdgeInsets.zero,
                              leading: CircleAvatar(
                                backgroundColor:
                                    const Color(0xFF25183F),
                                backgroundImage:
                                    user.profileImageUrl.isEmpty
                                        ? null
                                        : NetworkImage(
                                            user.profileImageUrl,
                                          ),
                                child: user.profileImageUrl.isEmpty
                                    ? const Icon(
                                        Icons.person_rounded,
                                        color: Colors.white54,
                                      )
                                    : null,
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
                              trailing: FilledButton(
                                onPressed: invited
                                    ? null
                                    : () async {
                                        try {
                                          final state =
                                              await _roomSeatService.inviteToMic(
                                            roomId: roomId,
                                            targetUid: user.uid,
                                          );
                                          if (mounted) {
                                            setState(
                                              () => _roomSeatState = state,
                                            );
                                          }
                                          if (sheetContext.mounted) {
                                            Navigator.pop(sheetContext);
                                          }
                                          if (mounted) {
                                            ScaffoldMessenger.of(context)
                                                .showSnackBar(
                                              SnackBar(
                                                content: Text(
                                                  'تمت دعوة ' +
                                                      user.displayName +
                                                      ' للمايك.',
                                                ),
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
                                                  'تعذر إرسال دعوة المايك حالياً.',
                                                ),
                                              ),
                                            );
                                          }
                                        }
                                      },
                                style: FilledButton.styleFrom(
                                  backgroundColor:
                                      const Color(0xFF6D27D9),
                                ),
                                child: Text(
                                  invited ? 'مدعو' : 'دعوة',
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
            const Expanded(
              child: Text(
                'تمت دعوتك للمايك — اختر مقعداً فارغاً',
                style: TextStyle(
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
                      final emptySeats =
                          state.seats.where((seat) => !seat.occupied).toList();
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

  Widget _buildVoiceSeats() {
    final state = _roomSeatState;
    final seats = state?.seats ??
        List.generate(
          8,
          (index) => VoiceSeat(
            index: index,
            uid: '',
            displayName: '',
            profileImageUrl: '',
            muted: true,
            starBattleCoins: 0,
          ),
        );
    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: seats.length,
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 4,
        mainAxisSpacing: 14,
        crossAxisSpacing: 10,
        childAspectRatio: .78,
      ),
      itemBuilder: (_, index) {
        final seat = seats[index];
        return InkWell(
          onTap: _changingSeat ? null : () => _handleSeatTap(seat),
          borderRadius: BorderRadius.circular(18),
          child: Column(
            children: [
              Stack(
                clipBehavior: Clip.none,
                children: [
                  Container(
                    width: 54,
                    height: 54,
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
                              image: NetworkImage(seat.profileImageUrl),
                              fit: BoxFit.cover,
                            ),
                    ),
                    child: seat.occupied
                        ? (seat.profileImageUrl.isEmpty
                            ? const Icon(
                                Icons.person_rounded,
                                color: Colors.white70,
                              )
                            : null)
                        : const Icon(
                            Icons.add_rounded,
                            color: Colors.white38,
                          ),
                  ),
                  if (seat.occupied)
                    Positioned(
                      right: -2,
                      bottom: -2,
                      child: Container(
                        width: 20,
                        height: 20,
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
                          size: 11,
                          color: Colors.white,
                        ),
                      ),
                    ),
                ],
              ),
              const SizedBox(height: 5),
              Text(
                seat.occupied
                    ? (seat.displayName.isEmpty ? 'متحدث' : seat.displayName)
                    : 'مقعد ' + (seat.index + 1).toString(),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: seat.occupied ? Colors.white70 : Colors.white38,
                  fontSize: 10,
                  fontWeight: FontWeight.w700,
                ),
              ),
              if (seat.occupied && seat.starBattleCoins > 0)
                Text(
                  _formatStarBattleCoins(seat.starBattleCoins) + ' ⭐',
                  maxLines: 1,
                  style: const TextStyle(
                    color: Color(0xFFFFD54A),
                    fontSize: 9,
                    fontWeight: FontWeight.w900,
                  ),
                ),
            ],
          ),
        );
      },
    );
  }

  Future<void> _showSupportersSheet() async {
    final supporters = _roomInsights?.supporters ?? const <RoomSupporter>[];
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
                              return ListTile(
                                contentPadding: EdgeInsets.zero,
                                leading: CircleAvatar(
                                  backgroundColor:
                                      const Color(0xFF25183F),
                                  backgroundImage:
                                      supporter.profileImageUrl.isEmpty
                                          ? null
                                          : NetworkImage(
                                              supporter.profileImageUrl,
                                            ),
                                  child: supporter.profileImageUrl.isEmpty
                                      ? Text(
                                          supporter.rank.toString(),
                                          style: const TextStyle(
                                            color: Color(0xFFFFD54A),
                                            fontWeight: FontWeight.w900,
                                          ),
                                        )
                                      : null,
                                ),
                                title: Text(
                                  supporter.displayName,
                                  style: const TextStyle(
                                    color: Colors.white,
                                    fontWeight: FontWeight.w800,
                                  ),
                                ),
                                subtitle: Text(
                                  'المركز ' + supporter.rank.toString(),
                                  style: const TextStyle(
                                    color: Colors.white54,
                                    fontSize: 11,
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
    final ranking = _roomInsights?.ranking ?? const <RoomRankEntry>[];
    final currentRoomId = (_roomArguments['roomId'] ?? '').toString();
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
                                  leading: CircleAvatar(
                                    radius: 23,
                                    backgroundColor:
                                        const Color(0xFF25183F),
                                    backgroundImage:
                                        friend.photoUrl.trim().isEmpty
                                            ? null
                                            : NetworkImage(friend.photoUrl),
                                    child: friend.photoUrl.trim().isEmpty
                                        ? const Icon(
                                            Icons.person_rounded,
                                            color: Color(0xFFFFD54A),
                                          )
                                        : null,
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
              setSheetState(() {});
            }

            void toggleRoomEffects(bool value) {
              setState(() => _roomEffectsEnabled = value);
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
                          onTap: () => comingSoon('الإكسسوارات'),
                          iconColor: const Color(0xFFCE93D8),
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
    final category =
        (_roomArguments['category'] ?? 'دردشة').toString();
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
    final online =
        (_roomArguments['onlineCount'] ?? 0).toString();
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
                    backgroundImage: _ownerPhotoUrl.trim().isEmpty
                        ? null
                        : NetworkImage(_ownerPhotoUrl),
                    child: _ownerPhotoUrl.trim().isEmpty
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
                          'المقاعد',
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
    if (roomId.isEmpty || !_voiceSession.isOwner) return;

    final nameController = TextEditingController(
      text: (_roomArguments['name'] ??
              _roomArguments['title'] ??
              'غرفتي')
          .toString(),
    );
    final descriptionController = TextEditingController(
      text: (_roomArguments['description'] ?? '').toString(),
    );
    final coverController = TextEditingController(
      text: (_roomArguments['coverImageUrl'] ??
              _roomArguments['imageUrl'] ??
              '')
          .toString(),
    );
    final categoryController = TextEditingController(
      text: (_roomArguments['category'] ?? 'دردشة').toString(),
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
                    TextField(
                      controller: coverController,
                      keyboardType: TextInputType.url,
                      maxLength: 1200,
                      style: const TextStyle(color: Colors.white),
                      decoration: const InputDecoration(
                        labelText: 'غلاف الغرفة — رابط صورة',
                        labelStyle: TextStyle(color: Colors.white60),
                        prefixIcon: Icon(
                          Icons.image_rounded,
                          color: Color(0xFFFFD54A),
                        ),
                      ),
                    ),
                    TextField(
                      controller: categoryController,
                      maxLength: 30,
                      style: const TextStyle(color: Colors.white),
                      decoration: const InputDecoration(
                        labelText: 'التصنيف',
                        labelStyle: TextStyle(color: Colors.white60),
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
                                final coverImageUrl =
                                    coverController.text.trim();
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
                                try {
                                  final updated =
                                      await _roomActions.updateRoomSettings(
                                    roomId: roomId,
                                    name: name,
                                    description: description,
                                    category: category.isEmpty
                                        ? 'دردشة'
                                        : category,
                                    tags: tags,
                                    visibility: visibility,
                                    chatEnabled: chatEnabled,
                                    coverImageUrl: coverImageUrl,
                                    password:
                                        passwordController.text.isEmpty
                                            ? null
                                            : passwordController.text,
                                  );
                                  if (!mounted) return;
                                  setState(() {
                                    _roomArguments = {
                                      ..._roomArguments,
                                      ...updated,
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
                                  if (!sheetContext.mounted) return;
                                  String message =
                                      'تعذر حفظ إعدادات الغرفة حالياً.';
                                  if (error.message ==
                                      'hidden_room_forbidden') {
                                    message =
                                        'لا تملك صلاحية إنشاء غرفة مخفية.';
                                  } else if (error.message ==
                                      'room_password_required') {
                                    message =
                                        'أدخل كلمة مرور للغرفة.';
                                  }
                                  ScaffoldMessenger.of(sheetContext)
                                      .showSnackBar(
                                    SnackBar(content: Text(message)),
                                  );
                                } catch (_) {
                                  if (sheetContext.mounted) {
                                    ScaffoldMessenger.of(sheetContext)
                                        .showSnackBar(
                                      const SnackBar(
                                        content: Text(
                                          'تعذر حفظ إعدادات الغرفة حالياً.',
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
    coverController.dispose();
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
                        'تغيير Room ID',
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
                    maxLength: 6,
                    style: const TextStyle(color: Colors.white),
                    decoration: const InputDecoration(
                      labelText: 'Room ID جديد — 6 أرقام',
                      labelStyle: TextStyle(color: Colors.white60),
                    ),
                  ),
                  const Text(
                    'بعد التغيير يبقى الـID القديم محجوزاً ولا يُعاد استخدامه.',
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
                              if (requested.length != 6 || !numeric) {
                                ScaffoldMessenger.of(sheetContext).showSnackBar(
                                  const SnackBar(
                                    content: Text(
                                      'أدخل Room ID صحيح من 6 أرقام.',
                                    ),
                                  ),
                                );
                                return;
                              }
                              if (requested == current) {
                                ScaffoldMessenger.of(sheetContext).showSnackBar(
                                  const SnackBar(
                                    content: Text('هذا هو الـID الحالي للغرفة.'),
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
                                        'تم تغيير Room ID وحجز الـID القديم.',
                                      ),
                                    ),
                                  );
                                }
                              } on StateError catch (error) {
                                if (!sheetContext.mounted) return;
                                final message =
                                    error.message == 'public_id_taken'
                                        ? 'هذا الـID مستخدم أو محجوز.'
                                        : error.message == 'forbidden'
                                            ? 'لا تملك صلاحية تغيير Room ID.'
                                            : 'تعذر تغيير Room ID حالياً.';
                                ScaffoldMessenger.of(sheetContext).showSnackBar(
                                  SnackBar(content: Text(message)),
                                );
                              } catch (_) {
                                if (sheetContext.mounted) {
                                  ScaffoldMessenger.of(sheetContext)
                                      .showSnackBar(
                                    const SnackBar(
                                      content: Text(
                                        'تعذر تغيير Room ID حالياً.',
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
    final owner = _voiceSession.isOwner;
    var ghostMode = false;
    try {
      ghostMode = await _roomActions.loadGhostMode();
    } catch (_) {}
    if (!mounted) return;
    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: const Color(0xFF111522),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (sheetContext) => SafeArea(
        child: Directionality(
          textDirection: TextDirection.rtl,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(18, 14, 18, 20),
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
                if (_canManageMic)
                  ListTile(
                    leading: Icon(
                      (_roomSeatState?.micInviteOnly ?? false)
                          ? Icons.lock_rounded
                          : Icons.mic_external_on_rounded,
                      color: const Color(0xFFFFD54A),
                    ),
                    title: const Text(
                      'الصعود للمايك',
                      style: TextStyle(color: Colors.white),
                    ),
                    subtitle: Text(
                      (_roomSeatState?.micInviteOnly ?? false)
                          ? 'بدعوة أو موافقة المشرفين فقط'
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
                      final next = !(_roomSeatState?.micInviteOnly ?? false);
                      Navigator.pop(sheetContext);
                      await _runSeatAction(
                        () => _roomSeatService.setMicInviteOnly(
                          roomId: roomId,
                          enabled: next,
                        ),
                      );
                    },
                  ),
                if (_canModerateChat)
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
                      final next = !(_roomArguments['chatEnabled'] != false);
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
                if (owner)
                  ListTile(
                    leading: const Icon(
                      Icons.tune_rounded,
                      color: Color(0xFFBFA5FF),
                    ),
                    title: const Text(
                      'إعدادات الغرفة',
                      style: TextStyle(color: Colors.white),
                    ),
                    onTap: () {
                      Navigator.pop(sheetContext);
                      _showRoomSettingsSheet();
                    },
                  ),
                if (_canManageIds)
                  ListTile(
                    leading: const Icon(
                      Icons.tag_rounded,
                      color: Color(0xFFFFD54A),
                    ),
                    title: const Text(
                      'تغيير Room ID',
                      style: TextStyle(color: Colors.white),
                    ),
                    onTap: () {
                      Navigator.pop(sheetContext);
                      _showChangeRoomIdSheet();
                    },
                  ),
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
                    'Ghost Mode',
                    style: TextStyle(color: Colors.white),
                  ),
                  subtitle: Text(
                    ghostMode
                        ? 'مفعّل — لن يظهر إشعار دخولك للغرفة.'
                        : 'متوقف — يظهر إشعار دخولك بشكل طبيعي.',
                    style: const TextStyle(
                      color: Colors.white54,
                      fontSize: 10,
                    ),
                  ),
                  trailing: Switch(
                    value: ghostMode,
                    onChanged: null,
                  ),
                  onTap: () async {
                    try {
                      final next = await _roomActions.setGhostMode(!ghostMode);
                      if (sheetContext.mounted) {
                        Navigator.pop(sheetContext);
                      }
                      if (mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(
                            content: Text(
                              next
                                  ? 'تم تفعيل Ghost Mode.'
                                  : 'تم إيقاف Ghost Mode.',
                            ),
                          ),
                        );
                      }
                    } catch (_) {
                      if (mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                            content: Text(
                              'تعذر تحديث Ghost Mode حالياً.',
                            ),
                          ),
                        );
                      }
                    }
                  },
                ),
                ListTile(
                  leading: const Icon(
                    Icons.picture_in_picture_alt_rounded,
                    color: Color(0xFFFFD54A),
                  ),
                  title: const Text(
                    'تصغير الغرفة',
                    style: TextStyle(color: Colors.white),
                  ),
                  onTap: () {
                    Navigator.pop(sheetContext);
                    _minimizeVoiceRoom();
                  },
                ),
                ListTile(
                  leading: const Icon(
                    Icons.logout_rounded,
                    color: Colors.orangeAccent,
                  ),
                  title: const Text(
                    'مغادرة الغرفة',
                    style: TextStyle(color: Colors.white),
                  ),
                  onTap: () {
                    Navigator.pop(sheetContext);
                    _leaveVoiceRoom();
                  },
                ),
                if (personal && owner)
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
                    onTap: () {
                      Navigator.pop(sheetContext);
                      _closePersonalRoom();
                    },
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  @override
  void dispose() {
    unawaited(_roomModeratorSubscription?.cancel());
    _voiceSession.removeListener(_syncVoiceSession);
    _roomActions.close();
    _roomInvites.close();
    _roomInsightsService.close();
    _roomModeration.close();
    _roomModeratorService.close();
    _roomPresence.close();
    _roomSeatService.close();
    super.dispose();
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
                CircleAvatar(
                  radius: 14,
                  backgroundColor: const Color(0xFF25183F),
                  backgroundImage: supporter.profileImageUrl.isEmpty
                      ? null
                      : NetworkImage(supporter.profileImageUrl),
                  child: supporter.profileImageUrl.isEmpty
                      ? Text(
                          supporter.displayName.isEmpty
                              ? '?'
                              : supporter.displayName.substring(0, 1),
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 9,
                            fontWeight: FontWeight.w900,
                          ),
                        )
                      : null,
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
    if (insights == null) {
      return _loadingRoomInsights
          ? const LinearProgressIndicator(
              minHeight: 2,
              color: Color(0xFF8A3DFF),
              backgroundColor: Colors.transparent,
            )
          : const SizedBox.shrink();
    }

    return Row(
      children: [
        InkWell(
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
        ),
        const Spacer(),
        Container(
          constraints: const BoxConstraints(maxWidth: 118),
          padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
          decoration: BoxDecoration(
            color: const Color(0xFF111522).withValues(alpha: .86),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: Colors.white10),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
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
              Flexible(
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
          circleButton(
            icon: Icons.card_giftcard_rounded,
            tooltip: 'الهدايا',
            onPressed: () {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(
                  content: Text(
                    'اختيار الهدايا سيستخدم نظام اقتصاد Shadow Live المعتمد.',
                  ),
                ),
              );
            },
            color: const Color(0xFFFFD54A),
          ),
          const SizedBox(width: 5),
          circleButton(
            icon: Icons.chat_bubble_rounded,
            tooltip: 'الرسائل',
            onPressed: () => _minimizeVoiceRoom(destinationNavIndex: 4),
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

  @override
  Widget build(BuildContext context) {
    final roomId = (_roomArguments['roomId'] ?? '').toString();
    final coverImageUrl = (_roomArguments['coverImageUrl'] ??
            _roomArguments['imageUrl'] ??
            '')
        .toString()
        .trim();
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

    return Directionality(
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
                  final micTop = min(205.0, height * .26);
                  final micHeight = max(300.0, height * .46);
                  final feedTop = min(height - 145, micTop + micHeight - 6);

                  return Stack(
                    children: [
                      Positioned.fill(
                        child: coverImageUrl.isEmpty
                            ? const DecoratedBox(
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
                              )
                            : Image.network(
                                coverImageUrl,
                                fit: BoxFit.cover,
                                errorBuilder: (_, __, ___) =>
                                    const ColoredBox(color: Colors.black),
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
                      Positioned(
                        top: 0,
                        left: 0,
                        right: 0,
                        child: Padding(
                          padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
                          child: Column(
                            children: [
                              Row(
                                children: [
                                  GestureDetector(
                                    onTap: _showRoomInfoSheet,
                                    child: CircleAvatar(
                                      radius: 22,
                                      backgroundColor: const Color(0xFF171D2B),
                                      backgroundImage: _ownerPhotoUrl.isEmpty
                                          ? null
                                          : NetworkImage(_ownerPhotoUrl),
                                      child: _ownerPhotoUrl.isEmpty
                                          ? const Icon(
                                              Icons.person_rounded,
                                              color: Colors.white54,
                                            )
                                          : null,
                                    ),
                                  ),
                                  const SizedBox(width: 8),
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
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
                                            const SizedBox(width: 5),
                                            InkWell(
                                              onTap: _changingRoomFollow ||
                                                      insights == null
                                                  ? null
                                                  : _toggleRoomFollow,
                                              child: Icon(
                                                insights?.followed == true
                                                    ? Icons.favorite_rounded
                                                    : Icons.favorite_border_rounded,
                                                size: 18,
                                                color: const Color(0xFFBFA5FF),
                                              ),
                                            ),
                                            const SizedBox(width: 5),
                                            InkWell(
                                              onTap: _changingRoomFavorite ||
                                                      insights == null
                                                  ? null
                                                  : _toggleRoomFavorite,
                                              child: Icon(
                                                insights?.favorited == true
                                                    ? Icons.star_rounded
                                                    : Icons.star_border_rounded,
                                                size: 18,
                                                color: const Color(0xFFFFD54A),
                                              ),
                                            ),
                                          ],
                                        ),
                                        const SizedBox(height: 2),
                                        Text(
                                          '# ID: $roomPublicId',
                                          textDirection: TextDirection.ltr,
                                          style: const TextStyle(
                                            color: Colors.white54,
                                            fontSize: 10,
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                                  _buildSupporterCluster(),
                                  const SizedBox(width: 4),
                                  IconButton(
                                    visualDensity: VisualDensity.compact,
                                    onPressed: _showShareRoomSheet,
                                    icon: const Icon(
                                      Icons.share_rounded,
                                      size: 20,
                                    ),
                                  ),
                                  Container(
                                    padding: const EdgeInsets.symmetric(
                                      horizontal: 8,
                                      vertical: 5,
                                    ),
                                    decoration: BoxDecoration(
                                      color: Colors.black.withValues(alpha: .45),
                                      borderRadius: BorderRadius.circular(999),
                                    ),
                                    child: Text(
                                      (_roomArguments['onlineCount'] ?? 0)
                                          .toString(),
                                      style: const TextStyle(
                                        color: Colors.white,
                                        fontSize: 10,
                                        fontWeight: FontWeight.w800,
                                      ),
                                    ),
                                  ),
                                  IconButton(
                                    visualDensity: VisualDensity.compact,
                                    onPressed: _showRoomMenu,
                                    icon: const Icon(
                                      Icons.more_horiz_rounded,
                                      size: 22,
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 6),
                              _buildRoomInsightsBar(),
                              const SizedBox(height: 7),
                              InkWell(
                                onTap: ownerUid ==
                                        (FirebaseAuth.instance.currentUser?.uid ??
                                            '')
                                    ? () => NavigationService.navigateTo(
                                          AppRoutes.profile,
                                        )
                                    : () {
                                        if (ownerUid.isNotEmpty) {
                                          showQuickProfileSheet(
                                            context,
                                            userId: ownerUid,
                                          );
                                        }
                                      },
                                borderRadius: BorderRadius.circular(999),
                                child: Container(
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 9,
                                    vertical: 5,
                                  ),
                                  decoration: BoxDecoration(
                                    color: const Color(0xFF6D27D9)
                                        .withValues(alpha: .42),
                                    borderRadius: BorderRadius.circular(999),
                                    border: Border.all(
                                      color: const Color(0xFFFFD54A)
                                          .withValues(alpha: .35),
                                    ),
                                  ),
                                  child: Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      const Icon(
                                        Icons.workspace_premium_rounded,
                                        size: 13,
                                        color: Color(0xFFFFD54A),
                                      ),
                                      const SizedBox(width: 5),
                                      Text(
                                        _ownerDisplayName,
                                        style: const TextStyle(
                                          color: Colors.white,
                                          fontSize: 10,
                                          fontWeight: FontWeight.w800,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
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
                          child: _buildVoiceSeats(),
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
                            child: Column(
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
