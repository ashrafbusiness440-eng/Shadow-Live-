import 'package:flutter/material.dart';
import '../constants/app_dimensions.dart';
import '../enums/app_enums.dart';
import '../utils/app_logger.dart';
import 'storage_service.dart';

class ThemeService {
  static final ThemeService _instance = ThemeService._internal();
  factory ThemeService() => _instance;
  ThemeService._internal();

  late final StorageService _storage;
  late ThemeMode _themeMode;
  final _themeModeController = ValueNotifier<ThemeMode>(ThemeMode.system);

  // Initialize theme service
  Future<void> initialize() async {
    try {
      _storage = StorageService();
      final savedTheme = _storage.getString('theme_mode');
      _themeMode = _getThemeModeFromString(savedTheme);
      _themeModeController.value = _themeMode;
      AppLogger.i('Theme service initialized', tag: 'Theme');
    } catch (e) {
      AppLogger.e('Theme service initialization error', tag: 'Theme', error: e);
      _themeMode = ThemeMode.system;
      _themeModeController.value = _themeMode;
    }
  }

  // Get current theme mode
  ThemeMode get themeMode => _themeMode;

  // Get theme mode stream
  ValueNotifier<ThemeMode> get themeModeNotifier => _themeModeController;

  // Set theme mode
  Future<void> setThemeMode(ThemeMode mode) async {
    try {
      _themeMode = mode;
      _themeModeController.value = mode;
      await _storage.setString('theme_mode', mode.toString());
      AppLogger.i('Theme mode set to: $mode', tag: 'Theme');
    } catch (e) {
      AppLogger.e('Set theme mode error', tag: 'Theme', error: e);
    }
  }

  // Get light theme
  ThemeData getLightTheme() {
    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.light,
      primaryColor: Colors.blue,
      scaffoldBackgroundColor: Colors.white,
      appBarTheme: const AppBarTheme(
        elevation: AppDimensions.appBarElevation,
        backgroundColor: Colors.white,
        foregroundColor: Colors.black,
        centerTitle: true,
      ),
      cardTheme: CardTheme(
        elevation: AppDimensions.cardElevation,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppDimensions.cardBorderRadius),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppDimensions.inputBorderRadius),
        ),
        contentPadding: const EdgeInsets.symmetric(
          horizontal: AppDimensions.inputHorizontalPadding,
          vertical: AppDimensions.inputVerticalPadding,
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          elevation: AppDimensions.buttonElevation,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppDimensions.buttonBorderRadius),
          ),
          padding: const EdgeInsets.symmetric(
            horizontal: AppDimensions.buttonHorizontalPadding,
            vertical: AppDimensions.buttonVerticalPadding,
          ),
        ),
      ),
      textTheme: const TextTheme(
        displayLarge: TextStyle(
          fontSize: AppDimensions.displayLargeFontSize,
          fontWeight: FontWeight.bold,
        ),
        displayMedium: TextStyle(
          fontSize: AppDimensions.displayMediumFontSize,
          fontWeight: FontWeight.bold,
        ),
        displaySmall: TextStyle(
          fontSize: AppDimensions.displaySmallFontSize,
          fontWeight: FontWeight.bold,
        ),
        headlineLarge: TextStyle(
          fontSize: AppDimensions.headlineLargeFontSize,
          fontWeight: FontWeight.w600,
        ),
        headlineMedium: TextStyle(
          fontSize: AppDimensions.headlineMediumFontSize,
          fontWeight: FontWeight.w600,
        ),
        headlineSmall: TextStyle(
          fontSize: AppDimensions.headlineSmallFontSize,
          fontWeight: FontWeight.w600,
        ),
        titleLarge: TextStyle(
          fontSize: AppDimensions.titleLargeFontSize,
          fontWeight: FontWeight.w500,
        ),
        titleMedium: TextStyle(
          fontSize: AppDimensions.titleMediumFontSize,
          fontWeight: FontWeight.w500,
        ),
        titleSmall: TextStyle(
          fontSize: AppDimensions.titleSmallFontSize,
          fontWeight: FontWeight.w500,
        ),
        bodyLarge: TextStyle(
          fontSize: AppDimensions.bodyLargeFontSize,
        ),
        bodyMedium: TextStyle(
          fontSize: AppDimensions.bodyMediumFontSize,
        ),
        bodySmall: TextStyle(
          fontSize: AppDimensions.bodySmallFontSize,
        ),
      ),
      colorScheme: ColorScheme.fromSeed(
        seedColor: Colors.blue,
        brightness: Brightness.light,
      ),
    );
  }

  // Get dark theme
  ThemeData getDarkTheme() {
    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      primaryColor: Colors.blue,
      scaffoldBackgroundColor: Colors.grey[900],
      appBarTheme: AppBarTheme(
        elevation: AppDimensions.appBarElevation,
        backgroundColor: Colors.grey[900],
        foregroundColor: Colors.white,
        centerTitle: true,
      ),
      cardTheme: CardTheme(
        elevation: AppDimensions.cardElevation,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppDimensions.cardBorderRadius),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppDimensions.inputBorderRadius),
        ),
        contentPadding: const EdgeInsets.symmetric(
          horizontal: AppDimensions.inputHorizontalPadding,
          vertical: AppDimensions.inputVerticalPadding,
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          elevation: AppDimensions.buttonElevation,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppDimensions.buttonBorderRadius),
          ),
          padding: const EdgeInsets.symmetric(
            horizontal: AppDimensions.buttonHorizontalPadding,
            vertical: AppDimensions.buttonVerticalPadding,
          ),
        ),
      ),
      textTheme: const TextTheme(
        displayLarge: TextStyle(
          fontSize: AppDimensions.displayLargeFontSize,
          fontWeight: FontWeight.bold,
          color: Colors.white,
        ),
        displayMedium: TextStyle(
          fontSize: AppDimensions.displayMediumFontSize,
          fontWeight: FontWeight.bold,
          color: Colors.white,
        ),
        displaySmall: TextStyle(
          fontSize: AppDimensions.displaySmallFontSize,
          fontWeight: FontWeight.bold,
          color: Colors.white,
        ),
        headlineLarge: TextStyle(
          fontSize: AppDimensions.headlineLargeFontSize,
          fontWeight: FontWeight.w600,
          color: Colors.white,
        ),
        headlineMedium: TextStyle(
          fontSize: AppDimensions.headlineMediumFontSize,
          fontWeight: FontWeight.w600,
          color: Colors.white,
        ),
        headlineSmall: TextStyle(
          fontSize: AppDimensions.headlineSmallFontSize,
          fontWeight: FontWeight.w600,
          color: Colors.white,
        ),
        titleLarge: TextStyle(
          fontSize: AppDimensions.titleLargeFontSize,
          fontWeight: FontWeight.w500,
          color: Colors.white,
        ),
        titleMedium: TextStyle(
          fontSize: AppDimensions.titleMediumFontSize,
          fontWeight: FontWeight.w500,
          color: Colors.white,
        ),
        titleSmall: TextStyle(
          fontSize: AppDimensions.titleSmallFontSize,
          fontWeight: FontWeight.w500,
          color: Colors.white,
        ),
        bodyLarge: TextStyle(
          fontSize: AppDimensions.bodyLargeFontSize,
          color: Colors.white,
        ),
        bodyMedium: TextStyle(
          fontSize: AppDimensions.bodyMediumFontSize,
          color: Colors.white,
        ),
        bodySmall: TextStyle(
          fontSize: AppDimensions.bodySmallFontSize,
          color: Colors.white,
        ),
      ),
      colorScheme: ColorScheme.fromSeed(
        seedColor: Colors.blue,
        brightness: Brightness.dark,
      ),
    );
  }

  // Get VIP level color
  Color getVipLevelColor(VipLevel level) {
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
      default:
        return Colors.grey;
    }
  }

  // Get gift type color
  Color getGiftTypeColor(GiftType type) {
    switch (type) {
      case GiftType.basic:
        return Colors.blue;
      case GiftType.premium:
        return Colors.purple;
      case GiftType.exclusive:
        return Colors.orange;
      case GiftType.limited:
        return Colors.red;
      default:
        return Colors.blue;
    }
  }

  // Get PK status color
  Color getPkStatusColor(PKStatus status) {
    switch (status) {
      case PKStatus.waiting:
        return Colors.grey;
      case PKStatus.ongoing:
        return Colors.green;
      case PKStatus.finished:
        return Colors.blue;
      case PKStatus.cancelled:
        return Colors.red;
      default:
        return Colors.grey;
    }
  }

  // Helper method to convert string to ThemeMode
  ThemeMode _getThemeModeFromString(String? themeString) {
    switch (themeString) {
      case 'ThemeMode.light':
        return ThemeMode.light;
      case 'ThemeMode.dark':
        return ThemeMode.dark;
      default:
        return ThemeMode.system;
    }
  }
}