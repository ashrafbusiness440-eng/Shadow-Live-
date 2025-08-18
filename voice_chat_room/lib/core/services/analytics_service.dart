import 'package:firebase_analytics/firebase_analytics.dart';
import '../enums/app_enums.dart';
import '../utils/app_logger.dart';
import '../utils/app_utils.dart';

class AnalyticsService {
  static final AnalyticsService _instance = AnalyticsService._internal();
  factory AnalyticsService() => _instance;
  AnalyticsService._internal();

  late final FirebaseAnalytics _analytics;
  bool _initialized = false;

  // Initialize analytics
  Future<void> initialize() async {
    if (_initialized) return;

    try {
      _analytics = FirebaseAnalytics.instance;
      await _analytics.setAnalyticsCollectionEnabled(true);
      _initialized = true;
      AppLogger.i('Analytics initialized successfully', tag: 'Analytics');
    } catch (e, stackTrace) {
      AppLogger.e(
        'Failed to initialize analytics',
        tag: 'Analytics',
        error: e,
        stackTrace: stackTrace,
      );
    }
  }

  // Log screen view
  Future<void> logScreenView({
    required String screenName,
    String? screenClass,
  }) async {
    try {
      await _analytics.logScreenView(
        screenName: screenName,
        screenClass: screenClass,
      );
      AppLogger.d('Screen view logged: $screenName', tag: 'Analytics');
    } catch (e) {
      AppLogger.e('Failed to log screen view', tag: 'Analytics', error: e);
    }
  }

  // Log user login
  Future<void> logLogin({
    required String method,
  }) async {
    try {
      await _analytics.logLogin(loginMethod: method);
      AppLogger.d('Login logged: $method', tag: 'Analytics');
    } catch (e) {
      AppLogger.e('Failed to log login', tag: 'Analytics', error: e);
    }
  }

  // Log user signup
  Future<void> logSignUp({
    required String method,
  }) async {
    try {
      await _analytics.logSignUp(signUpMethod: method);
      AppLogger.d('Sign up logged: $method', tag: 'Analytics');
    } catch (e) {
      AppLogger.e('Failed to log sign up', tag: 'Analytics', error: e);
    }
  }

  // Log room creation
  Future<void> logRoomCreation({
    required String roomId,
    required String roomName,
    required String roomType,
  }) async {
    try {
      await _analytics.logEvent(
        name: 'room_creation',
        parameters: {
          'room_id': roomId,
          'room_name': roomName,
          'room_type': roomType,
          'timestamp': DateTime.now().toIso8601String(),
        },
      );
      AppLogger.d('Room creation logged: $roomName', tag: 'Analytics');
    } catch (e) {
      AppLogger.e('Failed to log room creation', tag: 'Analytics', error: e);
    }
  }

  // Log room join
  Future<void> logRoomJoin({
    required String roomId,
    required String roomName,
    required String userRole,
  }) async {
    try {
      await _analytics.logEvent(
        name: 'room_join',
        parameters: {
          'room_id': roomId,
          'room_name': roomName,
          'user_role': userRole,
          'timestamp': DateTime.now().toIso8601String(),
        },
      );
      AppLogger.d('Room join logged: $roomName', tag: 'Analytics');
    } catch (e) {
      AppLogger.e('Failed to log room join', tag: 'Analytics', error: e);
    }
  }

  // Log gift sending
  Future<void> logGiftSend({
    required String giftId,
    required String giftName,
    required int giftAmount,
    required String recipientId,
  }) async {
    try {
      await _analytics.logEvent(
        name: 'gift_send',
        parameters: {
          'gift_id': giftId,
          'gift_name': giftName,
          'gift_amount': giftAmount,
          'recipient_id': recipientId,
          'timestamp': DateTime.now().toIso8601String(),
        },
      );
      AppLogger.d('Gift send logged: $giftName', tag: 'Analytics');
    } catch (e) {
      AppLogger.e('Failed to log gift send', tag: 'Analytics', error: e);
    }
  }

  // Log VIP purchase
  Future<void> logVipPurchase({
    required String vipLevel,
    required double amount,
    required String currency,
  }) async {
    try {
      await _analytics.logEvent(
        name: 'vip_purchase',
        parameters: {
          'vip_level': vipLevel,
          'amount': amount,
          'currency': currency,
          'timestamp': DateTime.now().toIso8601String(),
        },
      );
      AppLogger.d('VIP purchase logged: $vipLevel', tag: 'Analytics');
    } catch (e) {
      AppLogger.e('Failed to log VIP purchase', tag: 'Analytics', error: e);
    }
  }

  // Log achievement unlock
  Future<void> logAchievementUnlock({
    required String achievementId,
    required String achievementName,
  }) async {
    try {
      await _analytics.logEvent(
        name: 'achievement_unlock',
        parameters: {
          'achievement_id': achievementId,
          'achievement_name': achievementName,
          'timestamp': DateTime.now().toIso8601String(),
        },
      );
      AppLogger.d('Achievement unlock logged: $achievementName', tag: 'Analytics');
    } catch (e) {
      AppLogger.e('Failed to log achievement unlock', tag: 'Analytics', error: e);
    }
  }

  // Log PK battle
  Future<void> logPKBattle({
    required String pkId,
    required String host1Id,
    required String host2Id,
    required String winnerId,
    required int duration,
  }) async {
    try {
      await _analytics.logEvent(
        name: 'pk_battle',
        parameters: {
          'pk_id': pkId,
          'host1_id': host1Id,
          'host2_id': host2Id,
          'winner_id': winnerId,
          'duration': duration,
          'timestamp': DateTime.now().toIso8601String(),
        },
      );
      AppLogger.d('PK battle logged: $pkId', tag: 'Analytics');
    } catch (e) {
      AppLogger.e('Failed to log PK battle', tag: 'Analytics', error: e);
    }
  }

  // Log error
  Future<void> logError({
    required String errorCode,
    required String errorMessage,
    String? stackTrace,
  }) async {
    try {
      await _analytics.logEvent(
        name: 'app_error',
        parameters: {
          'error_code': errorCode,
          'error_message': errorMessage,
          'stack_trace': stackTrace,
          'timestamp': DateTime.now().toIso8601String(),
        },
      );
      AppLogger.d('Error logged: $errorCode', tag: 'Analytics');
    } catch (e) {
      AppLogger.e('Failed to log error', tag: 'Analytics', error: e);
    }
  }

  // Log performance metric
  Future<void> logPerformance({
    required String metricName,
    required int valueMs,
  }) async {
    try {
      await _analytics.logEvent(
        name: 'performance_metric',
        parameters: {
          'metric_name': metricName,
          'value_ms': valueMs,
          'timestamp': DateTime.now().toIso8601String(),
        },
      );
      AppLogger.d('Performance logged: $metricName', tag: 'Analytics');
    } catch (e) {
      AppLogger.e('Failed to log performance', tag: 'Analytics', error: e);
    }
  }

  // Set user properties
  Future<void> setUserProperties({
    required String userId,
    String? userRole,
    String? vipLevel,
    int? roomCount,
    int? followersCount,
    int? giftCount,
  }) async {
    try {
      await _analytics.setUserId(id: userId);

      if (userRole != null) {
        await _analytics.setUserProperty(name: 'user_role', value: userRole);
      }

      if (vipLevel != null) {
        await _analytics.setUserProperty(name: 'vip_level', value: vipLevel);
      }

      if (roomCount != null) {
        await _analytics.setUserProperty(
          name: 'room_count',
          value: roomCount.toString(),
        );
      }

      if (followersCount != null) {
        await _analytics.setUserProperty(
          name: 'followers_count',
          value: followersCount.toString(),
        );
      }

      if (giftCount != null) {
        await _analytics.setUserProperty(
          name: 'gift_count',
          value: giftCount.toString(),
        );
      }

      AppLogger.d('User properties set for: $userId', tag: 'Analytics');
    } catch (e) {
      AppLogger.e('Failed to set user properties', tag: 'Analytics', error: e);
    }
  }

  // Reset analytics data
  Future<void> resetAnalyticsData() async {
    try {
      await _analytics.resetAnalyticsData();
      AppLogger.d('Analytics data reset', tag: 'Analytics');
    } catch (e) {
      AppLogger.e('Failed to reset analytics data', tag: 'Analytics', error: e);
    }
  }
}