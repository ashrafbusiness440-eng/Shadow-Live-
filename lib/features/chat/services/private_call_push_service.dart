import 'dart:async';
import 'dart:convert';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:http/http.dart' as http;

import '../../../services/navigation_service.dart';
import '../../../firebase_options.dart';
import '../../voice/services/voice_room_session_controller.dart';
import '../widgets/private_call_incoming_dialog.dart';
import 'private_call_signaling_client.dart';

/// One app-lifetime Android FCM coordinator; no per-message, per-chat or
/// per-avatar listeners. Not activated for browser/PWA without its VAPID and
/// service-worker setup. Server call + push rollout gates stay OFF.
class PrivateCallPushService {
  PrivateCallPushService._();
  static final instance = PrivateCallPushService._();

  static const _apiBase = String.fromEnvironment(
    'SHADOW_CLOUDFLARE_API_BASE_URL',
    defaultValue: 'https://shadow-live.ashraf-business-440.workers.dev/api',
  );
  static final _callIdPattern = RegExp(r'^[a-f0-9]{32}$');

  bool _started = false;
  String? _currentUid;
  String? _enabledUid;
  String? _displayedCallId;
  String? _pendingTapCallId;
  Future<void> _accountQueue = Future<void>.value();
  StreamSubscription<User?>? _authSub;
  StreamSubscription<String>? _tokenSub;
  StreamSubscription<RemoteMessage>? _foregroundSub;
  StreamSubscription<RemoteMessage>? _tapSub;

  bool get supported =>
      !kIsWeb &&
      defaultTargetPlatform == TargetPlatform.android &&
      // Firebase Messaging needs a real Firebase Android app registration.
      // The repository currently contains a web appId for Android; keep
      // the consent/registration UI OFF until a valid Android appId is set.
      DefaultFirebaseOptions.android.appId.contains(':android:');
  bool get enabledForCurrentUser =>
      _enabledUid != null &&
      FirebaseAuth.instance.currentUser?.uid == _enabledUid;

  FirebaseMessaging get _messaging => FirebaseMessaging.instance;

  Future<void> start() async {
    if (_started || !supported) return;
    _started = true;
    // FCM's background notification refers to this exact channel ID.
    try {
      final local = FlutterLocalNotificationsPlugin();
      await local.initialize(
        settings: const InitializationSettings(
          android: AndroidInitializationSettings('@mipmap/ic_launcher'),
        ),
      );
      await local.resolvePlatformSpecificImplementation<
          AndroidFlutterLocalNotificationsPlugin>()?.createNotificationChannel(
        const AndroidNotificationChannel(
          'shadow_private_calls', 'المكالمات الصوتية الخاصة',
          description: 'تنبيهات المكالمات الواردة في شادول لايف',
          importance: Importance.high,
          playSound: true,
        ),
      );
    } catch (_) {
      // Do not request permission or break app startup. Settings provides an
      // explicit retry; native OS delivery remains subject to device setup.
    }

    _authSub = FirebaseAuth.instance.authStateChanges().listen((user) {
      _accountQueue = _accountQueue.then((_) => _syncAccount(user))
          .catchError((Object _) {});
    });
    _tokenSub = _messaging.onTokenRefresh.listen((token) {
      final uid = _enabledUid;
      if (uid != null && FirebaseAuth.instance.currentUser?.uid == uid) {
        unawaited(_register(uid, token).catchError((Object _) {}));
      }
    });
    _foregroundSub = FirebaseMessaging.onMessage.listen((message) {
      unawaited(_handleMessage(message, foreground: true));
    });
    _tapSub = FirebaseMessaging.onMessageOpenedApp.listen((message) {
      unawaited(_handleMessage(message, foreground: false));
    });
    final first = await _messaging.getInitialMessage();
    if (first != null) {
      final id = first.data['callId']?.toString();
      if (first.data['type'] == 'private_call_incoming' &&
          id != null && _callIdPattern.hasMatch(id)) {
        _pendingTapCallId = id;
        final user = FirebaseAuth.instance.currentUser;
        if (user != null) unawaited(_presentPendingTap(user.uid));
      }
    }
  }

  Future<void> _syncAccount(User? user) async {
    final uid = user?.isAnonymous == false ? user?.uid : null;
    if (_currentUid != null && _currentUid != uid) {
      _enabledUid = null;
      // Retire the installation token on logout/account switch. Any old
      // registration is also suppressed server-side by explicit opt-in and
      // ownership re-assignment when the next account registers.
      try { await _messaging.deleteToken(); } catch (_) {}
    }
    _currentUid = uid;
    _enabledUid = null;
    if (uid == null || FirebaseAuth.instance.currentUser?.uid != uid) return;
    try {
      final doc = await FirebaseFirestore.instance
          .collection('users').doc(uid).get()
          .timeout(const Duration(seconds: 12));
      if (FirebaseAuth.instance.currentUser?.uid != uid ||
          doc.data()?['privateCallPushOptIn'] != true) return;
      final status = await _messaging.getNotificationSettings();
      if (status.authorizationStatus != AuthorizationStatus.authorized &&
          status.authorizationStatus != AuthorizationStatus.provisional) {
        return;
      }
      final token = await _messaging.getToken();
      if (token == null || FirebaseAuth.instance.currentUser?.uid != uid) return;
      await _register(uid, token);
      if (FirebaseAuth.instance.currentUser?.uid == uid) _enabledUid = uid;
      if (_pendingTapCallId != null) await _presentPendingTap(uid);
    } catch (_) {
      // Startup remains functional even when notification services fail.
    }
  }

  Future<void> _register(String uid, String token, {
    String action = 'register',
  }) async {
    final user = FirebaseAuth.instance.currentUser;
    if (user?.uid != uid || user?.isAnonymous != false) {
      throw StateError('account_changed');
    }
    final idToken = await user!.getIdToken();
    if (FirebaseAuth.instance.currentUser?.uid != uid ||
        idToken == null || idToken.isEmpty) {
      throw StateError('account_changed');
    }
    final response = await http.post(
      Uri.parse('$_apiBase/private-call-push-devices'),
      headers: {
        'authorization': 'Bearer $idToken',
        'content-type': 'application/json',
      },
      body: jsonEncode({
        'action': action, 'token': token, 'platform': 'android',
      }),
    ).timeout(const Duration(seconds: 12));
    if (FirebaseAuth.instance.currentUser?.uid != uid) {
      throw StateError('account_changed');
    }
    final data = jsonDecode(response.body);
    if (response.statusCode != 200 || data is! Map ||
        data['ok'] != true) {
      throw StateError('push_registration_failed');
    }
  }

  /// Permission prompt only after an explicit tap in user settings.
  Future<void> enableForCurrentUser() async {
    if (!supported) throw StateError('platform_not_configured');
    final user = FirebaseAuth.instance.currentUser;
    if (user == null || user.isAnonymous) {
      throw StateError('registered_account_required');
    }
    final uid = user.uid;
    final permission = await _messaging.requestPermission(
      alert: true, badge: true, sound: true,
    );
    if (permission.authorizationStatus != AuthorizationStatus.authorized &&
        permission.authorizationStatus != AuthorizationStatus.provisional) {
      throw StateError('push_permission_denied');
    }
    final token = await _messaging.getToken();
    if (token == null || token.isEmpty) {
      throw StateError('push_token_unavailable');
    }
    await _register(uid, token);
    if (FirebaseAuth.instance.currentUser?.uid != uid) {
      throw StateError('account_changed');
    }
    try {
      await FirebaseFirestore.instance.collection('users').doc(uid)
          .update({'privateCallPushOptIn': true})
          .timeout(const Duration(seconds: 12));
    } catch (_) {
      await _register(uid, token, action: 'unregister').catchError((Object _) {});
      rethrow;
    }
    if (FirebaseAuth.instance.currentUser?.uid == uid) _enabledUid = uid;
  }

  Future<void> disableForCurrentUser() async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null || user.isAnonymous) {
      throw StateError('registered_account_required');
    }
    final uid = user.uid;
    // First revoke the *authoritative* server opt-in so a failed cleanup can
    // never leave the account receiving pushes.
    await FirebaseFirestore.instance.collection('users').doc(uid)
        .update({'privateCallPushOptIn': false})
        .timeout(const Duration(seconds: 12));
    _enabledUid = null;
    try {
      final token = await _messaging.getToken();
      if (token != null && FirebaseAuth.instance.currentUser?.uid == uid) {
        await _register(uid, token, action: 'unregister');
      }
    } catch (_) {
      // Server opt-in has already been turned OFF.
    }
  }

  Future<void> _presentPendingTap(String uid) async {
    final id = _pendingTapCallId;
    if (id == null || !enabledForCurrentUser ||
        FirebaseAuth.instance.currentUser?.uid != uid) {
      return;
    }
    _pendingTapCallId = null;
    await _presentCall(uid, id, foreground: false);
  }

  Future<void> _handleMessage(
    RemoteMessage message, {required bool foreground}
  ) async {
    final id = message.data['callId']?.toString();
    if (message.data['type'] != 'private_call_incoming' ||
        id == null || !_callIdPattern.hasMatch(id)) {
      return;
    }
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null || !enabledForCurrentUser) {
      if (!foreground) _pendingTapCallId = id;
      return;
    }
    await _presentCall(uid, id, foreground: foreground);
  }

  Future<void> _presentCall(
    String uid, String callId, {required bool foreground}
  ) async {
    if (_displayedCallId != null ||
        FirebaseAuth.instance.currentUser?.uid != uid ||
        !enabledForCurrentUser) {
      return;
    }
    // A push is only a pointer. Before displaying the caller UI, re-check
    // the Worker authority; never allow push payloads to grant room access.
    final signaling = PrivateCallSignalingClient();
    try {
      final state = await signaling.get(actorUid: uid, callId: callId);
      if (state.status != 'ringing' ||
          FirebaseAuth.instance.currentUser?.uid != uid) {
        if (!foreground) _openNotificationInbox(uid);
        return;
      }
    } catch (_) {
      if (!foreground) _openNotificationInbox(uid);
      return;
    } finally {
      signaling.dispose();
    }
    if (VoiceRoomSessionController.instance.privateCallMediaActive) return;
    final nav = NavigationService.navigatorKey.currentState;
    if (nav == null || !nav.mounted ||
        FirebaseAuth.instance.currentUser?.uid != uid) return;
    _displayedCallId = callId;
    try {
      await showDialog<void>(
        context: nav.context,
        barrierDismissible: false,
        builder: (_) => PrivateCallIncomingDialog(
          accountUid: uid,
          callId: callId,
          callerName: 'المتصل',
        ),
      );
    } finally {
      _displayedCallId = null;
    }
  }

  void _openNotificationInbox(String uid) {
    if (FirebaseAuth.instance.currentUser?.uid != uid) return;
    final nav = NavigationService.navigatorKey.currentState;
    if (nav != null) nav.pushNamed(AppRoutes.notifications);
  }

  Future<void> dispose() async {
    await _authSub?.cancel();
    await _tokenSub?.cancel();
    await _foregroundSub?.cancel();
    await _tapSub?.cancel();
    _started = false;
  }
}
