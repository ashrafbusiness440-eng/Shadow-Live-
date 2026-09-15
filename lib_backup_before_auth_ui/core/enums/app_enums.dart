// Room Types
enum RoomType {
  public,
  private,
  vipOnly,
  event,
  challenge;

  String get displayName {
    switch (this) {
      case RoomType.public:
        return 'Public';
      case RoomType.private:
        return 'Private';
      case RoomType.vipOnly:
        return 'VIP Only';
      case RoomType.event:
        return 'Event';
      case RoomType.challenge:
        return 'Challenge';
    }
  }

  bool get requiresInvitation {
    return this == RoomType.private || this == RoomType.vipOnly;
  }
}

// Room Status
enum RoomStatus {
  active,
  ended,
  paused,
  locked,
  maintenance
}

// User Roles
enum UserRole {
  admin,
  moderator,
  host,
  coHost,
  speaker,
  listener,
  guest;

  bool get canModerate {
    return this == UserRole.admin ||
        this == UserRole.moderator ||
        this == UserRole.host;
  }

  bool get canCreateRoom {
    return this == UserRole.admin ||
        this == UserRole.host ||
        this == UserRole.coHost;
  }

  bool get canSpeak {
    return this == UserRole.admin ||
        this == UserRole.moderator ||
        this == UserRole.host ||
        this == UserRole.coHost ||
        this == UserRole.speaker;
  }
}

// User Status
enum UserStatus {
  online,
  offline,
  away,
  busy,
  inRoom
}

// VIP Levels
enum VipLevel {
  none,
  bronze,
  silver,
  gold,
  platinum,
  diamond;

  int get multiplier {
    switch (this) {
      case VipLevel.none:
        return 1;
      case VipLevel.bronze:
        return 2;
      case VipLevel.silver:
        return 3;
      case VipLevel.gold:
        return 4;
      case VipLevel.platinum:
        return 5;
      case VipLevel.diamond:
        return 6;
    }
  }

  bool get hasSpecialEffects {
    return this != VipLevel.none;
  }

  String get displayName {
    switch (this) {
      case VipLevel.none:
        return 'Regular';
      case VipLevel.bronze:
        return 'Bronze VIP';
      case VipLevel.silver:
        return 'Silver VIP';
      case VipLevel.gold:
        return 'Gold VIP';
      case VipLevel.platinum:
        return 'Platinum VIP';
      case VipLevel.diamond:
        return 'Diamond VIP';
    }
  }
}

// Gift Types
enum GiftType {
  basic,
  premium,
  exclusive,
  limited,
  seasonal;

  int get basePrice {
    switch (this) {
      case GiftType.basic:
        return 10;
      case GiftType.premium:
        return 50;
      case GiftType.exclusive:
        return 100;
      case GiftType.limited:
        return 200;
      case GiftType.seasonal:
        return 150;
    }
  }

  bool get isSpecial {
    return this == GiftType.exclusive || 
           this == GiftType.limited || 
           this == GiftType.seasonal;
  }

  GiftEffect get defaultEffect {
    switch (this) {
      case GiftType.basic:
        return GiftEffect.simple;
      case GiftType.premium:
        return GiftEffect.animated;
      case GiftType.exclusive:
        return GiftEffect.special;
      case GiftType.limited:
        return GiftEffect.custom;
      case GiftType.seasonal:
        return GiftEffect.animated;
    }
  }
}

// Gift Effects
enum GiftEffect {
  none,
  simple,
  animated,
  special,
  custom
}

// Notification Types
enum NotificationType {
  roomInvite,
  newFollower,
  gift,
  achievement,
  system,
  pk;

  String get title {
    switch (this) {
      case NotificationType.roomInvite:
        return 'Room Invitation';
      case NotificationType.newFollower:
        return 'New Follower';
      case NotificationType.gift:
        return 'Gift Received';
      case NotificationType.achievement:
        return 'Achievement Unlocked';
      case NotificationType.system:
        return 'System Notice';
      case NotificationType.pk:
        return 'PK Challenge';
    }
  }

  bool get requiresImmediate {
    return this == NotificationType.roomInvite || 
           this == NotificationType.pk;
  }

  bool get isInteractive {
    return this == NotificationType.roomInvite || 
           this == NotificationType.pk || 
           this == NotificationType.gift;
  }
}

// PK Status
enum PKStatus {
  waiting,
  ongoing,
  completed,
  cancelled,
  draw;

  bool get isActive {
    return this == PKStatus.waiting || this == PKStatus.ongoing;
  }

  bool get isFinished {
    return this == PKStatus.completed || 
           this == PKStatus.cancelled || 
           this == PKStatus.draw;
  }

  String get displayName {
    switch (this) {
      case PKStatus.waiting:
        return 'Waiting';
      case PKStatus.ongoing:
        return 'In Progress';
      case PKStatus.completed:
        return 'Completed';
      case PKStatus.cancelled:
        return 'Cancelled';
      case PKStatus.draw:
        return 'Draw';
    }
  }
}

// Achievement Types
enum AchievementType {
  roomHost,
  gifting,
  socializing,
  streaming,
  special;

  String get displayName {
    switch (this) {
      case AchievementType.roomHost:
        return 'Room Host';
      case AchievementType.gifting:
        return 'Gifting Master';
      case AchievementType.socializing:
        return 'Social Butterfly';
      case AchievementType.streaming:
        return 'Streaming Star';
      case AchievementType.special:
        return 'Special Achievement';
    }
  }

  int get basePoints {
    switch (this) {
      case AchievementType.roomHost:
        return 100;
      case AchievementType.gifting:
        return 150;
      case AchievementType.socializing:
        return 50;
      case AchievementType.streaming:
        return 200;
      case AchievementType.special:
        return 300;
    }
  }

  bool get isRare {
    return this == AchievementType.special || 
           this == AchievementType.streaming;
  }
}

// Payment Status
enum PaymentStatus {
  pending,
  completed,
  failed,
  refunded,
  cancelled
}

// Report Types
enum ReportType {
  inappropriate,
  spam,
  abuse,
  technical,
  other
}

// Theme Mode
enum AppThemeMode {
  light,
  dark,
  system
}

// Language Code
enum AppLanguage {
  english,
  spanish,
  french,
  german,
  chinese,
  japanese,
  korean,
  arabic
}

// Audio Quality
enum AudioQuality {
  low,
  medium,
  high,
  ultra
}

// Connection Status
enum ConnectionStatus {
  connected,
  connecting,
  disconnected,
  reconnecting,
  failed
}

// Sort Order
enum SortOrder {
  ascending,
  descending
}

// Filter Type
enum FilterType {
  all,
  popular,
  following,
  nearby,
  recommended
}

// Time Period
enum TimePeriod {
  today,
  week,
  month,
  year,
  allTime
}

// Device Type
enum DeviceType {
  mobile,
  tablet,
  desktop,
  web
}

// Platform Type
enum PlatformType {
  ios,
  android,
  windows,
  macos,
  linux,
  web
}

// Media Type
enum MediaType {
  image,
  video,
  audio,
  document
}

// Storage Type
enum StorageType {
  local,
  cloud,
  cache
}

// Cache Policy
enum CachePolicy {
  none,
  memory,
  disk,
  both
}

// Error Type
enum ErrorType {
  network,
  server,
  client,
  validation,
  permission,
  authentication,
  unknown
}

// Log Level
enum LogLevel {
  debug,
  info,
  warning,
  error,
  critical
}

// Analytics Event
enum AnalyticsEvent {
  screenView,
  userAction,
  error,
  performance,
  custom
}

// Feature Flag
enum FeatureFlag {
  pkSystem,
  giftSystem,
  vipSystem,
  achievementSystem,
  analyticsSystem
}

// Extension to add functionality to enums
extension RoomTypeExtension on RoomType {
  String get name {
    switch (this) {
      case RoomType.public:
        return 'Public';
      case RoomType.private:
        return 'Private';
      case RoomType.vipOnly:
        return 'VIP Only';
      case RoomType.event:
        return 'Event';
      case RoomType.challenge:
        return 'Challenge';
    }
  }
}

extension UserRoleExtension on UserRole {
  String get name {
    switch (this) {
      case UserRole.admin:
        return 'Admin';
      case UserRole.moderator:
        return 'Moderator';
      case UserRole.host:
        return 'Host';
      case UserRole.coHost:
        return 'Co-Host';
      case UserRole.speaker:
        return 'Speaker';
      case UserRole.listener:
        return 'Listener';
      case UserRole.guest:
        return 'Guest';
    }
  }

  bool get canSpeak {
    return this == UserRole.admin ||
        this == UserRole.moderator ||
        this == UserRole.host ||
        this == UserRole.coHost ||
        this == UserRole.speaker;
  }

  bool get canModerate {
    return this == UserRole.admin ||
        this == UserRole.moderator ||
        this == UserRole.host;
  }
}

extension VipLevelExtension on VipLevel {
  String get name {
    switch (this) {
      case VipLevel.none:
        return 'None';
      case VipLevel.bronze:
        return 'Bronze';
      case VipLevel.silver:
        return 'Silver';
      case VipLevel.gold:
        return 'Gold';
      case VipLevel.platinum:
        return 'Platinum';
      case VipLevel.diamond:
        return 'Diamond';
    }
  }

  int get level {
    switch (this) {
      case VipLevel.none:
        return 0;
      case VipLevel.bronze:
        return 1;
      case VipLevel.silver:
        return 2;
      case VipLevel.gold:
        return 3;
      case VipLevel.platinum:
        return 4;
      case VipLevel.diamond:
        return 5;
    }
  }
}