import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import '../constants/app_constants.dart';
import '../enums/app_enums.dart';
import '../utils/app_logger.dart';
import 'firebase_service.dart';
import 'storage_service.dart';

class NotificationService {
  static final NotificationService _instance = NotificationService._internal();
  factory NotificationService() => _instance;
  NotificationService._internal();

  late final FirebaseMessaging _messaging;
  late final FlutterLocalNotificationsPlugin _localNotifications;
  late final StorageService _storage;
  late final FirebaseService _firebase;

  // Initialize notification services
  Future<void> initialize() async {
    try {
      _messaging = FirebaseMessaging.instance;
      _localNotifications = FlutterLocalNotificationsPlugin();
      _storage = StorageService();
      _firebase = FirebaseService();

      // Request permission for iOS
      await _messaging.requestPermission(
        alert: true,
        badge: true,
        sound: true,
      );

      // Initialize local notifications
      const initializationSettingsAndroid =
          AndroidInitializationSettings('@mipmap/ic_launcher');
      const initializationSettingsIOS = DarwinInitializationSettings(
        requestAlertPermission: true,
        requestBadgePermission: true,
        requestSoundPermission: true,
      );
      const initializationSettings = InitializationSettings(
        android: initializationSettingsAndroid,
        iOS: initializationSettingsIOS,
      );
      await _localNotifications.initialize(initializationSettings);

      // Get FCM token
      final token = await _messaging.getToken();
      if (token != null) {
        await _storage.setString('fcm_token', token);
        AppLogger.i('FCM Token: $token', tag: 'Notification');
      }

      // Handle token refresh
      _messaging.onTokenRefresh.listen((newToken) async {
        await _storage.setString('fcm_token', newToken);
        AppLogger.i('FCM Token refreshed: $newToken', tag: 'Notification');
      });

      AppLogger.i('Notification service initialized', tag: 'Notification');
    } catch (e) {
      AppLogger.e(
        'Notification service initialization error',
        tag: 'Notification',
        error: e,
      );
    }
  }

  // Configure notification handlers
  void configureHandlers({
    void Function(RemoteMessage)? onMessage,
    void Function(RemoteMessage)? onMessageOpenedApp,
    void Function(NotificationType, Map<String, dynamic>)? onNotificationTap,
  }) {
    // Handle foreground messages
    FirebaseMessaging.onMessage.listen((RemoteMessage message) {
      AppLogger.d(
        'Received foreground message: ${message.messageId}',
        tag: 'Notification',
      );
      onMessage?.call(message);
      _showLocalNotification(message);
    });

    // Handle background/terminated messages
    FirebaseMessaging.onMessageOpenedApp.listen((RemoteMessage message) {
      AppLogger.d(
        'Opened app from background message: ${message.messageId}',
        tag: 'Notification',
      );
      onMessageOpenedApp?.call(message);
      _handleNotificationTap(message, onNotificationTap);
    });

    // Handle local notification tap
    _localNotifications.getNotificationAppLaunchDetails().then((details) {
      if (details?.didNotificationLaunchApp ?? false) {
        final payload = details?.notificationResponse?.payload;
        if (payload != null) {
          final data = _parsePayload(payload);
          _handleNotificationTap(
            RemoteMessage(data: data),
            onNotificationTap,
          );
        }
      }
    });
  }

  // Show local notification
  Future<void> _showLocalNotification(RemoteMessage message) async {
    try {
      final androidDetails = AndroidNotificationDetails(
        AppConstants.notificationChannelId,
        AppConstants.notificationChannelName,
        channelDescription: AppConstants.notificationChannelDescription,
        importance: Importance.max,
        priority: Priority.high,
        showWhen: true,
      );

      final iosDetails = const DarwinNotificationDetails(
        presentAlert: true,
        presentBadge: true,
        presentSound: true,
      );

      final details = NotificationDetails(
        android: androidDetails,
        iOS: iosDetails,
      );

      await _localNotifications.show(
        message.hashCode,
        message.notification?.title,
        message.notification?.body,
        details,
        payload: message.data.toString(),
      );
    } catch (e) {
      AppLogger.e(
        'Show local notification error',
        tag: 'Notification',
        error: e,
      );
    }
  }

  // Handle notification tap
  void _handleNotificationTap(
    RemoteMessage message,
    void Function(NotificationType, Map<String, dynamic>)? onTap,
  ) {
    try {
      final type = _getNotificationType(message.data['type']);
      onTap?.call(type, message.data);
    } catch (e) {
      AppLogger.e(
        'Handle notification tap error',
        tag: 'Notification',
        error: e,
      );
    }
  }

  // Subscribe to topic
  Future<void> subscribeToTopic(String topic) async {
    try {
      await _messaging.subscribeToTopic(topic);
      AppLogger.i('Subscribed to topic: $topic', tag: 'Notification');
    } catch (e) {
      AppLogger.e(
        'Subscribe to topic error',
        tag: 'Notification',
        error: e,
      );
    }
  }

  // Unsubscribe from topic
  Future<void> unsubscribeFromTopic(String topic) async {
    try {
      await _messaging.unsubscribeFromTopic(topic);
      AppLogger.i('Unsubscribed from topic: $topic', tag: 'Notification');
    } catch (e) {
      AppLogger.e(
        'Unsubscribe from topic error',
        tag: 'Notification',
        error: e,
      );
    }
  }

  // Send notification to user
  Future<void> sendNotificationToUser(
    String userId,
    String title,
    String body,
    NotificationType type, {
    Map<String, dynamic>? data,
  }) async {
    try {
      final notificationData = {
        'title': title,
        'body': body,
        'type': type.toString(),
        'timestamp': DateTime.now().toIso8601String(),
        ...?data,
      };

      await _firebase.sendNotification(userId, notificationData);
      AppLogger.i(
        'Notification sent to user: $userId',
        tag: 'Notification',
      );
    } catch (e) {
      AppLogger.e(
        'Send notification error',
        tag: 'Notification',
        error: e,
      );
    }
  }

  // Get notification settings
  Future<Map<String, dynamic>> getNotificationSettings() async {
    try {
      final settings = await _messaging.getNotificationSettings();
      return {
        'authorizationStatus': settings.authorizationStatus.index,
        'alertSetting': settings.alert.index,
        'badgeSetting': settings.badge.index,
        'soundSetting': settings.sound.index,
      };
    } catch (e) {
      AppLogger.e(
        'Get notification settings error',
        tag: 'Notification',
        error: e,
      );
      return {};
    }
  }

  // Parse notification payload
  Map<String, dynamic> _parsePayload(String payload) {
    try {
      return Map<String, dynamic>.from(
        Map<String, dynamic>.from(
          payload
              .replaceAll('{', '')
              .replaceAll('}', '')
              .split(', ')
              .map((e) {
            final parts = e.split(': ');
            return MapEntry(parts[0], parts[1]);
          })
              .toMap(),
        ),
      );
    } catch (e) {
      AppLogger.e(
        'Parse payload error',
        tag: 'Notification',
        error: e,
      );
      return {};
    }
  }

  // Get notification type from string
  NotificationType _getNotificationType(String? type) {
    switch (type) {
      case 'NotificationType.gift':
        return NotificationType.gift;
      case 'NotificationType.follow':
        return NotificationType.follow;
      case 'NotificationType.room':
        return NotificationType.room;
      case 'NotificationType.achievement':
        return NotificationType.achievement;
      case 'NotificationType.system':
        return NotificationType.system;
      default:
        return NotificationType.system;
    }
  }
}