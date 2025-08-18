import 'dart:io';
import 'dart:math';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../constants/app_strings.dart';
import '../enums/app_enums.dart';

class AppUtils {
  // Date and Time Formatting
  static String formatDate(DateTime date) {
    return DateFormat('MMM dd, yyyy').format(date);
  }

  static String formatTime(DateTime time) {
    return DateFormat('HH:mm').format(time);
  }

  static String formatDateTime(DateTime dateTime) {
    return DateFormat('MMM dd, yyyy HH:mm').format(dateTime);
  }

  static String getRelativeTime(DateTime dateTime) {
    final now = DateTime.now();
    final difference = now.difference(dateTime);

    if (difference.inDays > 7) {
      return formatDate(dateTime);
    } else if (difference.inDays > 0) {
      return '${difference.inDays}d ago';
    } else if (difference.inHours > 0) {
      return '${difference.inHours}h ago';
    } else if (difference.inMinutes > 0) {
      return '${difference.inMinutes}m ago';
    } else {
      return 'Just now';
    }
  }

  // Number Formatting
  static String formatNumber(int number) {
    if (number >= 1000000) {
      return '${(number / 1000000).toStringAsFixed(1)}M';
    } else if (number >= 1000) {
      return '${(number / 1000).toStringAsFixed(1)}K';
    }
    return number.toString();
  }

  static String formatCurrency(double amount) {
    return NumberFormat.currency(symbol: '\$').format(amount);
  }

  // String Utilities
  static String capitalize(String text) {
    if (text.isEmpty) return text;
    return text[0].toUpperCase() + text.substring(1);
  }

  static String truncateText(String text, int maxLength) {
    if (text.length <= maxLength) return text;
    return '${text.substring(0, maxLength)}...';
  }

  static String generateRandomString(int length) {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    final random = Random();
    return String.fromCharCodes(
      Iterable.generate(
        length,
        (_) => chars.codeUnitAt(random.nextInt(chars.length)),
      ),
    );
  }

  // Validation
  static bool isValidEmail(String email) {
    return RegExp(r'^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}\$').hasMatch(email);
  }

  static bool isValidPassword(String password) {
    return password.length >= 8 &&
        RegExp(r'^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8,}\$').hasMatch(password);
  }

  static bool isValidUsername(String username) {
    return username.length >= 3 &&
        RegExp(r'^[a-zA-Z0-9_]{3,20}\$').hasMatch(username);
  }

  // File Utilities
  static String getFileExtension(String fileName) {
    return fileName.split('.').last.toLowerCase();
  }

  static bool isImageFile(String fileName) {
    final extension = getFileExtension(fileName);
    return ['jpg', 'jpeg', 'png', 'gif'].contains(extension);
  }

  static String formatFileSize(int bytes) {
    if (bytes <= 0) return '0 B';
    const suffixes = ['B', 'KB', 'MB', 'GB', 'TB'];
    var i = (log(bytes) / log(1024)).floor();
    return '${(bytes / pow(1024, i)).toStringAsFixed(1)} ${suffixes[i]}';
  }

  // Color Utilities
  static Color darken(Color color, [double amount = .1]) {
    assert(amount >= 0 && amount <= 1);

    final hsl = HSLColor.fromColor(color);
    final hslDark = hsl.withLightness((hsl.lightness - amount).clamp(0.0, 1.0));

    return hslDark.toColor();
  }

  static Color lighten(Color color, [double amount = .1]) {
    assert(amount >= 0 && amount <= 1);

    final hsl = HSLColor.fromColor(color);
    final hslLight = hsl.withLightness((hsl.lightness + amount).clamp(0.0, 1.0));

    return hslLight.toColor();
  }

  // Device Info
  static bool get isIOS => Platform.isIOS;
  static bool get isAndroid => Platform.isAndroid;
  static bool get isWeb => Platform.isWindows || Platform.isLinux || Platform.isMacOS;

  // Screen Utilities
  static bool isPortrait(BuildContext context) {
    return MediaQuery.of(context).orientation == Orientation.portrait;
  }

  static bool isTablet(BuildContext context) {
    final shortestSide = MediaQuery.of(context).size.shortestSide;
    return shortestSide > 600;
  }

  // Error Handling
  static String getErrorMessage(dynamic error) {
    if (error is String) return error;
    if (error is Exception) return error.toString().replaceAll('Exception:', '');
    return AppStrings.unknownError;
  }

  // Analytics Helper
  static Map<String, dynamic> getEventProperties({
    required String eventName,
    required Map<String, dynamic> properties,
  }) {
    return {
      'event_name': eventName,
      'timestamp': DateTime.now().toIso8601String(),
      'platform': isIOS ? 'ios' : (isAndroid ? 'android' : 'web'),
      ...properties,
    };
  }

  // Room Utilities
  static String getRoomId() {
    return 'room_${DateTime.now().millisecondsSinceEpoch}_${generateRandomString(6)}';
  }

  static String formatDuration(Duration duration) {
    String twoDigits(int n) => n.toString().padLeft(2, '0');
    final hours = twoDigits(duration.inHours);
    final minutes = twoDigits(duration.inMinutes.remainder(60));
    final seconds = twoDigits(duration.inSeconds.remainder(60));
    return duration.inHours > 0 ? '$hours:$minutes:$seconds' : '$minutes:$seconds';
  }

  // Gift Utilities
  static String formatGiftAmount(int amount) {
    return NumberFormat.compact().format(amount);
  }

  static Color getGiftTypeColor(GiftType type) {
    switch (type) {
      case GiftType.basic:
        return Colors.blue;
      case GiftType.premium:
        return Colors.purple;
      case GiftType.exclusive:
        return Colors.orange;
      case GiftType.limited:
        return Colors.red;
      case GiftType.seasonal:
        return Colors.green;
    }
  }

  // VIP Utilities
  static String getVipBadgeAsset(VipLevel level) {
    switch (level) {
      case VipLevel.none:
        return '';
      case VipLevel.bronze:
        return 'assets/images/vip/bronze_badge.svg';
      case VipLevel.silver:
        return 'assets/images/vip/silver_badge.svg';
      case VipLevel.gold:
        return 'assets/images/vip/gold_badge.svg';
      case VipLevel.platinum:
        return 'assets/images/vip/platinum_badge.svg';
      case VipLevel.diamond:
        return 'assets/images/vip/diamond_badge.svg';
    }
  }

  static Color getVipLevelColor(VipLevel level) {
    switch (level) {
      case VipLevel.none:
        return Colors.grey;
      case VipLevel.bronze:
        return Colors.brown;
      case VipLevel.silver:
        return Colors.grey[400]!;
      case VipLevel.gold:
        return Colors.amber;
      case VipLevel.platinum:
        return Colors.blueGrey;
      case VipLevel.diamond:
        return Colors.lightBlue;
    }
  }

  // Achievement Utilities
  static String getAchievementIcon(AchievementType type) {
    switch (type) {
      case AchievementType.roomHost:
        return 'assets/icons/achievements/host.svg';
      case AchievementType.gifting:
        return 'assets/icons/achievements/gift.svg';
      case AchievementType.socializing:
        return 'assets/icons/achievements/social.svg';
      case AchievementType.streaming:
        return 'assets/icons/achievements/stream.svg';
      case AchievementType.special:
        return 'assets/icons/achievements/special.svg';
    }
  }

  // PK System Utilities
  static Color getPKStatusColor(PKStatus status) {
    switch (status) {
      case PKStatus.waiting:
        return Colors.orange;
      case PKStatus.ongoing:
        return Colors.green;
      case PKStatus.completed:
        return Colors.blue;
      case PKStatus.cancelled:
        return Colors.red;
      case PKStatus.draw:
        return Colors.purple;
    }
  }

  // Notification Utilities
  static String getNotificationIcon(NotificationType type) {
    switch (type) {
      case NotificationType.roomInvite:
        return 'assets/icons/notifications/invite.svg';
      case NotificationType.newFollower:
        return 'assets/icons/notifications/follower.svg';
      case NotificationType.gift:
        return 'assets/icons/notifications/gift.svg';
      case NotificationType.achievement:
        return 'assets/icons/notifications/achievement.svg';
      case NotificationType.system:
        return 'assets/icons/notifications/system.svg';
      case NotificationType.pk:
        return 'assets/icons/notifications/pk.svg';
    }
  }
}