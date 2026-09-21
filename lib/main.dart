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
import 'screens/room/create_room_screen.dart';
import 'screens/room/room_list_screen.dart';
import 'screens/settings/settings_screen.dart';
import 'services/navigation_service.dart';
import 'features/voice/services/voice_room_session_controller.dart';
import 'features/room/services/room_action_service.dart';
import 'features/room/services/room_invite_service.dart';
import 'features/room/services/room_insights_service.dart';
import 'features/room/services/room_seat_service.dart';

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
  final VoiceRoomSessionController _voiceSession =
      VoiceRoomSessionController.instance;
  final RoomActionService _roomActions = RoomActionService();
  final RoomInviteService _roomInvites = RoomInviteService();
  final RoomInsightsService _roomInsightsService = RoomInsightsService();
  final RoomSeatService _roomSeatService = RoomSeatService();
  bool _voiceStarted = false;

  @override
  void initState() {
    super.initState();
    _voiceSession.addListener(_syncVoiceSession);
  }

  void _syncVoiceSession() {
    if (!mounted) return;
    setState(() {
      _voiceJoining = _voiceSession.joining;
      _voiceMicMuted = _voiceSession.micMuted;
      _voiceError = _voiceSession.error;
    });
  }

  bool _voiceJoining = true;
  bool _voiceMicMuted = true;
  String? _voiceError;
  Map<String, dynamic> _roomArguments = <String, dynamic>{};
  String _ownerDisplayName = 'صاحب الغرفة';
  String _ownerPhotoUrl = '';
  bool _roomSoundEnabled = true;
  bool _effectSoundEnabled = true;
  bool _roomEffectsEnabled = true;
  RoomInsights? _roomInsights;
  bool _loadingRoomInsights = false;
  bool _changingRoomFollow = false;
  RoomSeatState? _roomSeatState;
  bool _changingSeat = false;
  StreamSubscription<RoomSeatState>? _roomSeatSubscription;

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
      unawaited(_loadRoomInsights(roomId));
      unawaited(_loadRoomSeatState(roomId));
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
    final uid = FirebaseAuth.instance.currentUser?.uid ?? '';
    final state = _roomSeatState;
    final roomId = (_roomArguments['roomId'] ?? '').toString();
    final hasSeat =
        state?.seats.any((seat) => seat.uid == uid) == true;
    final canSpeak = state?.isOwner == true || hasSeat;

    if (!canSpeak) {
      if (state?.requested(uid) == true) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('طلب المايك ما زال قيد الانتظار.')),
        );
      } else {
        await _runSeatAction(() => _roomSeatService.requestMic(roomId));
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('تم إرسال طلب المايك لصاحب الغرفة.')),
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

  Future<void> _loadRoomSeatState(String roomId) async {
    if (roomId.isEmpty) return;
    await _roomSeatSubscription?.cancel();
    _roomSeatSubscription = _roomSeatService.watch(roomId).listen(
      (state) {
        if (!mounted) return;
        setState(() => _roomSeatState = state);

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

  Future<void> _handleSeatTap(VoiceSeat seat) async {
    final roomId = (_roomArguments['roomId'] ?? '').toString();
    final uid = FirebaseAuth.instance.currentUser?.uid ?? '';
    final state = _roomSeatState;
    if (roomId.isEmpty || uid.isEmpty || state == null) return;

    if (!seat.occupied) {
      if (state.isOwner || state.invited(uid)) {
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
            const SnackBar(content: Text('تم إرسال طلب المايك لصاحب الغرفة.')),
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

    if (state.isOwner) {
      await showModalBottomSheet<void>(
        context: context,
        backgroundColor: const Color(0xFF111522),
        builder: (sheetContext) => SafeArea(
          child: ListTile(
            leading: const Icon(Icons.person_remove_rounded, color: Colors.redAccent),
            title: Text(
              'إنزال ' + (seat.displayName.isEmpty ? 'المستخدم' : seat.displayName) + ' من المايك',
              style: const TextStyle(color: Colors.white),
            ),
            onTap: () {
              Navigator.pop(sheetContext);
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
        ),
      );
    }
  }

  Future<void> _showMicRequestsSheet() async {
    final state = _roomSeatState;
    if (state == null || !state.isOwner) return;
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
                      title: Text(
                        uid.length > 10 ? uid.substring(0, 10) + '…' : uid,
                        style: const TextStyle(color: Colors.white),
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
                        ? const Icon(Icons.person_rounded, color: Colors.white70)
                        : null)
                    : const Icon(Icons.add_rounded, color: Colors.white38),
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
                                  trailing: Text(
                                    entry.dailySupport.toString(),
                                    style: const TextStyle(
                                      color: Color(0xFFFFD54A),
                                      fontWeight: FontWeight.w900,
                                    ),
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
                                                final text =
                                                    error.message == 'blocked'
                                                        ? 'لا يمكن إرسال الدعوة بسبب الحظر.'
                                                        : 'تعذر إرسال الدعوة حالياً.';
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
              child: Padding(
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
                          onTap: () => comingSoon('الأغاني'),
                          iconColor: const Color(0xFFF48FB1),
                        ),
                        tool(
                          icon: Icons.autorenew_rounded,
                          label: 'عجلة الحظ',
                          onTap: () => comingSoon('عجلة الحظ'),
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
            );
          },
        ),
      ),
    );
  }

  Future<void> _showRoomMenu() async {
    final personal = (_roomArguments['roomType'] ?? '').toString() == 'personal';
    final owner = _voiceSession.isOwner;
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
    _voiceSession.removeListener(_syncVoiceSession);
    _roomActions.close();
    _roomInvites.close();
    _roomInsightsService.close();
    _roomSeatService.close();
    super.dispose();
  }

  Widget _buildRoomSupportBox() {
    final insights = _roomInsights;
    final support = insights?.dailySupport ?? 0;
    final followers = insights?.followerCount ?? 0;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: const Color(0xFF101522),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: const Color(0xFF8A3DFF).withValues(alpha: .24),
        ),
      ),
      child: Row(
        children: [
          Container(
            width: 42,
            height: 42,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: const Color(0xFFFFD54A).withValues(alpha: .12),
            ),
            child: const Icon(
              Icons.savings_rounded,
              color: Color(0xFFFFD54A),
            ),
          ),
          const SizedBox(width: 11),
          const Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'صندوق الغرفة',
                  style: TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w900,
                    fontSize: 13,
                  ),
                ),
                SizedBox(height: 3),
                Text(
                  'الدعم والمتابعة الخاصة بهذه الغرفة',
                  style: TextStyle(
                    color: Colors.white54,
                    fontSize: 10,
                  ),
                ),
              ],
            ),
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                support.toString(),
                style: const TextStyle(
                  color: Color(0xFFFFD54A),
                  fontWeight: FontWeight.w900,
                  fontSize: 14,
                ),
              ),
              Text(
                followers.toString() + ' متابع',
                style: const TextStyle(
                  color: Colors.white54,
                  fontSize: 9,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildRoomInsightsBar() {
    final insights = _roomInsights;
    if (insights == null) {
      return _loadingRoomInsights
          ? const Padding(
              padding: EdgeInsets.only(top: 10),
              child: LinearProgressIndicator(
                minHeight: 2,
                color: Color(0xFF8A3DFF),
                backgroundColor: Colors.transparent,
              ),
            )
          : const SizedBox.shrink();
    }

    final top = insights.supporters.take(3).toList();
    return Column(
      children: [
        Row(
          children: [
            Expanded(
              child: Container(
                padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
                decoration: BoxDecoration(
                  color: const Color(0xFF111522).withValues(alpha: .88),
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: Colors.white12),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'LV.' + insights.level.toString(),
                      style: const TextStyle(
                        color: Color(0xFFFFD54A),
                        fontWeight: FontWeight.w900,
                        fontSize: 15,
                      ),
                    ),
                    const SizedBox(height: 4),
                    LinearProgressIndicator(
                      value: insights.levelProgress,
                      minHeight: 4,
                      borderRadius: BorderRadius.circular(99),
                      color: const Color(0xFF8A3DFF),
                      backgroundColor: Colors.white12,
                    ),
                    const SizedBox(height: 4),
                    Text(
                      insights.levelPoints.toString() +
                          '/' +
                          insights.levelTarget.toString(),
                      style: const TextStyle(
                        color: Colors.white54,
                        fontSize: 9,
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(width: 9),
            InkWell(
              onTap: _showSupportersSheet,
              borderRadius: BorderRadius.circular(18),
              child: Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 8,
                  vertical: 7,
                ),
                decoration: BoxDecoration(
                  color: const Color(0xFF111522).withValues(alpha: .88),
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: Colors.white12),
                ),
                child: Row(
                  children: List.generate(3, (index) {
                    final supporter =
                        index < top.length ? top[index] : null;
                    return Padding(
                      padding: EdgeInsetsDirectional.only(
                        start: index == 0 ? 0 : 4,
                      ),
                      child: Stack(
                        clipBehavior: Clip.none,
                        children: [
                          CircleAvatar(
                            radius: 16,
                            backgroundColor: const Color(0xFF25183F),
                            backgroundImage: supporter == null ||
                                    supporter.profileImageUrl.isEmpty
                                ? null
                                : NetworkImage(
                                    supporter.profileImageUrl,
                                  ),
                            child: supporter == null
                                ? const Icon(
                                    Icons.person_outline_rounded,
                                    color: Colors.white24,
                                    size: 17,
                                  )
                                : supporter.profileImageUrl.isEmpty
                                    ? Text(
                                        supporter.displayName.isEmpty
                                            ? '?'
                                            : supporter.displayName.substring(0, 1),
                                        style: const TextStyle(
                                          color: Colors.white,
                                          fontSize: 11,
                                          fontWeight: FontWeight.w900,
                                        ),
                                      )
                                    : null,
                          ),
                          Positioned(
                            right: -2,
                            top: -5,
                            child: Container(
                              width: 15,
                              height: 15,
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
                                  fontSize: 8,
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
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(
              child: InkWell(
                onTap: _showRoomRankingSheet,
                borderRadius: BorderRadius.circular(999),
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 8,
                  ),
                  decoration: BoxDecoration(
                    color: const Color(0xFF111522).withValues(alpha: .88),
                    borderRadius: BorderRadius.circular(999),
                    border: Border.all(color: Colors.white12),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Icon(
                        Icons.emoji_events_rounded,
                        color: Color(0xFFFFD54A),
                        size: 17,
                      ),
                      const SizedBox(width: 6),
                      Text(
                        insights.dailyRank == null
                            ? 'الترتيب اليومي'
                            : 'TOP ' +
                                insights.dailyRank.toString() +
                                ' اليومي',
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 11,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
            const SizedBox(width: 8),
            FilledButton.icon(
              onPressed:
                  _changingRoomFollow ? null : _toggleRoomFollow,
              style: FilledButton.styleFrom(
                backgroundColor: insights.followed
                    ? const Color(0xFF202534)
                    : const Color(0xFF5A20FF),
                foregroundColor: Colors.white,
                visualDensity: VisualDensity.compact,
              ),
              icon: _changingRoomFollow
                  ? const SizedBox(
                      width: 13,
                      height: 13,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : Icon(
                      insights.followed
                          ? Icons.favorite_rounded
                          : Icons.favorite_border_rounded,
                      size: 16,
                    ),
              label: Text(
                insights.followed
                    ? 'متابَع'
                    : 'متابعة',
                style: const TextStyle(
                  fontSize: 10,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
          ],
        ),
      ],
    );
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
                      const SizedBox(height: 178),
                      HostSection(
                        name: _ownerDisplayName,
                        imageUrl: _ownerPhotoUrl,
                        onTap: (_roomArguments['ownerUid'] ??
                                    _roomArguments['ownerId'] ??
                                    _roomArguments['hostId'])
                                .toString() ==
                            (FirebaseAuth.instance.currentUser?.uid ?? '')
                            ? () => NavigationService.navigateTo(
                                  AppRoutes.profile,
                                )
                            : null,
                      ),
                      const SizedBox(height: 18),
                      _buildRoomSupportBox(),
                      const SizedBox(height: 18),
                      _buildMicStatusBanner(),
                      _buildVoiceSeats(),
                      if (_roomSeatState?.isOwner == true) ...[
                        const SizedBox(height: 8),
                        Align(
                          alignment: AlignmentDirectional.centerStart,
                          child: TextButton.icon(
                            onPressed: _showMicRequestsSheet,
                            icon: const Icon(
                              Icons.mic_external_on_rounded,
                            ),
                            label: Text(
                              'طلبات المايك (' +
                                  (_roomSeatState?.micRequests.length ?? 0)
                                      .toString() +
                                  ')',
                            ),
                          ),
                        ),
                      ],
                      const SizedBox(height: 190),
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
                              CircleAvatar(
                                radius: 20,
                                backgroundColor: const Color(0xFF171D2B),
                                backgroundImage: _ownerPhotoUrl.trim().isEmpty
                                    ? null
                                    : NetworkImage(_ownerPhotoUrl),
                                child: _ownerPhotoUrl.trim().isEmpty
                                    ? const Icon(
                                        Icons.person_rounded,
                                        color: Colors.white54,
                                      )
                                    : null,
                              ),
                              const SizedBox(width: 8),
                              Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text((_roomArguments['name'] ?? _roomArguments['title'] ?? 'غرفة صوتية').toString(), maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.bold)),
                                  Row(children: [Icon(Icons.tag_rounded, color: Colors.yellow[400], size: 16), Text('ID: ' + (_roomArguments['publicId'] ?? '—').toString(), style: const TextStyle(color: Colors.grey, fontSize: 12))]),
                                ],
                              ),
                            ],
                          ),
                          Row(
                            children: [
                              IconButton(
                                icon: const Icon(Icons.share_rounded),
                                onPressed: _showShareRoomSheet,
                                tooltip: 'مشاركة الغرفة',
                              ),
                              Container(padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6), decoration: BoxDecoration(color: Colors.black.withValues(alpha: 0.5), borderRadius: BorderRadius.circular(20)), child: Text((_roomArguments['onlineCount'] ?? 0).toString())),
                              IconButton(
                                icon: const Icon(Icons.more_horiz_rounded),
                                onPressed: _showRoomMenu,
                                tooltip: 'خيارات الغرفة',
                              ),
                            ],
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),
                      _buildRoomInsightsBar(),
                    ],
                  ),
                ),
              ),
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
                      Row(
                        children: [
                          IconButton(
                            onPressed: () {},
                            tooltip: 'الهدايا',
                            icon: Icon(
                              Icons.card_giftcard_rounded,
                              color: Colors.yellow[400],
                            ),
                          ),
                          const SizedBox(width: 4),
                          IconButton(
                            onPressed: _showToolsSheet,
                            tooltip: 'الأدوات',
                            icon: const Icon(Icons.grid_view_rounded),
                          ),
                        ],
                      ),
                      Row(
                        children: [
                          GestureDetector(
                            onTap: _leaveVoiceRoom,
                            child: Container(
                              padding: const EdgeInsets.all(8),
                              decoration: BoxDecoration(
                                color: Colors.red[600],
                                shape: BoxShape.circle,
                              ),
                              child: const Icon(Icons.call_end),
                            ),
                          ),
                          const SizedBox(width: 12),
                          GestureDetector(
                            onTap: () => _minimizeVoiceRoom(
                              destinationNavIndex: 4,
                            ),
                            child: Container(
                              padding: const EdgeInsets.all(8),
                              decoration: BoxDecoration(
                                color: const Color(0xFF6D27D9),
                                shape: BoxShape.circle,
                              ),
                              child: const Icon(
                                Icons.chat_bubble_rounded,
                                color: Colors.white,
                              ),
                            ),
                          ),
                          const SizedBox(width: 12),
                          GestureDetector(
                            onTap: _voiceJoining || _voiceError != null
                                ? null
                                : _toggleVoiceMic,
                            child: Container(
                              padding: const EdgeInsets.all(8),
                              decoration: BoxDecoration(
                                color: _voiceError != null
                                    ? Colors.red[900]
                                    : Colors.grey[800],
                                shape: BoxShape.circle,
                              ),
                              child: Icon(
                                _voiceMicMuted ? Icons.mic_off : Icons.mic,
                              ),
                            ),
                          ),
                        ],
                      ),
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
