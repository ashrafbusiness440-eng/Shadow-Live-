class AppConstants {
  // App Information
  static const String appName = 'Voice Chat Room';
  static const String appVersion = '1.0.0';
  static const String appBuildNumber = '1';
  static const String appPackageName = 'com.example.voice_chat_room';

  // API Endpoints and Keys
  static const String agoraAppId = 'YOUR_AGORA_APP_ID';
  static const String firebaseProjectId = 'YOUR_FIREBASE_PROJECT_ID';
  static const String androidAppId = 'YOUR_ANDROID_APP_ID';
  static const String iosAppId = 'YOUR_IOS_APP_ID';

  // Storage Keys
  static const String authTokenKey = 'auth_token';
  static const String userIdKey = 'user_id';
  static const String userDataKey = 'user_data';
  static const String themeKey = 'theme_mode';
  static const String languageKey = 'language_code';
  static const String onboardingKey = 'has_completed_onboarding';
  static const String notificationKey = 'notification_settings';

  // Timeouts and Limits
  static const int connectionTimeout = 30000; // milliseconds
  static const int maxRetryAttempts = 3;
  static const int maxRoomParticipants = 20;
  static const int maxMessageLength = 500;
  static const int maxUsernameLength = 30;
  static const int minPasswordLength = 8;
  static const int maxFileSize = 10 * 1024 * 1024; // 10MB

  // Cache Configuration
  static const int cacheDuration = 7 * 24 * 60 * 60; // 7 days in seconds
  static const int maxCacheSize = 100 * 1024 * 1024; // 100MB
  static const String cacheDirectory = 'app_cache';

  // Room Settings
  static const int defaultRoomCapacity = 8;
  static const int minRoomNameLength = 3;
  static const int maxRoomNameLength = 50;
  static const int maxRoomDescription = 200;
  static const int roomRefreshInterval = 5000; // milliseconds

  // Gift System
  static const int minGiftAmount = 1;
  static const int maxGiftAmount = 99999;
  static const double giftCommissionRate = 0.1; // 10%
  static const int giftHistoryLimit = 100;

  // VIP System
  static const int maxVipLevel = 10;
  static const List<int> vipUpgradePoints = [100, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000];
  static const List<String> vipBenefits = [
    'Custom entrance effects',
    'Special badges',
    'Gift effects',
    'Room capacity boost',
    'Profile customization'
  ];

  // User Profile
  static const int maxBioLength = 150;
  static const List<String> allowedAvatarTypes = ['jpg', 'jpeg', 'png'];
  static const int maxAvatarSize = 5 * 1024 * 1024; // 5MB
  static const int maxFollowers = 10000;
  static const int maxFollowing = 1000;

  // Notification Settings
  static const int maxNotificationHistory = 50;
  static const int notificationRefreshInterval = 60000; // milliseconds
  static const List<String> notificationTypes = [
    'room_invitation',
    'follower',
    'gift',
    'system',
    'achievement'
  ];

  // PK System
  static const int pkDuration = 300; // seconds
  static const int pkCooldown = 600; // seconds
  static const int minPkParticipants = 2;
  static const int maxPkParticipants = 2;
  static const int pkPointsPerGift = 10;

  // Achievement System
  static const int maxAchievements = 50;
  static const int maxBadges = 20;
  static const int achievementRefreshInterval = 300000; // milliseconds

  // Error Messages
  static const String networkError = 'Network connection error. Please try again.';
  static const String serverError = 'Server error. Please try again later.';
  static const String authError = 'Authentication failed. Please check your credentials.';
  static const String permissionError = 'Permission denied. Please check your settings.';
  static const String roomError = 'Unable to join room. Please try again.';
  static const String micError = 'Microphone access denied. Please check your settings.';
  static const String paymentError = 'Payment failed. Please try again.';

  // Success Messages
  static const String loginSuccess = 'Successfully logged in!';
  static const String registerSuccess = 'Registration successful!';
  static const String profileUpdateSuccess = 'Profile updated successfully!';
  static const String roomCreateSuccess = 'Room created successfully!';
  static const String giftSendSuccess = 'Gift sent successfully!';
  static const String followSuccess = 'Successfully followed user!';

  // Asset Paths
  static const String defaultAvatarPath = 'assets/images/default_avatar.png';
  static const String logoPath = 'assets/images/logo.png';
  static const String defaultRoomBackground = 'assets/images/default_room_bg.png';
  static const String loadingAnimation = 'assets/animations/loading.json';

  // Feature Flags
  static const bool enablePkSystem = true;
  static const bool enableGiftSystem = true;
  static const bool enableVipSystem = true;
  static const bool enableAchievements = true;
  static const bool enableAnalytics = true;
  static const bool enablePushNotifications = true;
  static const bool enableChatFilter = true;
  static const bool enableUserReporting = true;
}