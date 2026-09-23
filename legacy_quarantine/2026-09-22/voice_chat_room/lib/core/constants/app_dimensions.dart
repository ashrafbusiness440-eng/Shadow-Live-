import 'package:flutter/material.dart';

class AppDimensions {
  // Screen Breakpoints
  static const double mobileBreakpoint = 600;
  static const double tabletBreakpoint = 900;
  static const double desktopBreakpoint = 1200;

  // Padding and Margin
  static const double paddingXS = 4.0;
  static const double paddingS = 8.0;
  static const double paddingM = 16.0;
  static const double paddingL = 24.0;
  static const double paddingXL = 32.0;
  static const double paddingXXL = 48.0;

  // Border Radius
  static const double radiusXS = 4.0;
  static const double radiusS = 8.0;
  static const double radiusM = 12.0;
  static const double radiusL = 16.0;
  static const double radiusXL = 24.0;
  static const double radiusXXL = 32.0;
  static const double radiusCircular = 999.0;

  // Icon Sizes
  static const double iconXS = 16.0;
  static const double iconS = 20.0;
  static const double iconM = 24.0;
  static const double iconL = 32.0;
  static const double iconXL = 40.0;
  static const double iconXXL = 48.0;

  // Font Sizes
  static const double fontXS = 12.0;
  static const double fontS = 14.0;
  static const double fontM = 16.0;
  static const double fontL = 18.0;
  static const double fontXL = 20.0;
  static const double fontXXL = 24.0;
  static const double fontDisplay = 32.0;
  static const double fontHero = 48.0;

  // Button Sizes
  static const double buttonHeightS = 32.0;
  static const double buttonHeightM = 40.0;
  static const double buttonHeightL = 48.0;
  static const double buttonHeightXL = 56.0;

  static const double buttonWidthS = 80.0;
  static const double buttonWidthM = 120.0;
  static const double buttonWidthL = 160.0;
  static const double buttonWidthXL = 200.0;

  // Input Field Sizes
  static const double inputHeightS = 32.0;
  static const double inputHeightM = 40.0;
  static const double inputHeightL = 48.0;
  static const double inputHeightXL = 56.0;

  // Avatar Sizes
  static const double avatarXS = 24.0;
  static const double avatarS = 32.0;
  static const double avatarM = 40.0;
  static const double avatarL = 56.0;
  static const double avatarXL = 72.0;
  static const double avatarXXL = 96.0;

  // Card Sizes
  static const double cardWidthS = 160.0;
  static const double cardWidthM = 240.0;
  static const double cardWidthL = 320.0;
  static const double cardWidthXL = 400.0;

  static const double cardHeightS = 120.0;
  static const double cardHeightM = 180.0;
  static const double cardHeightL = 240.0;
  static const double cardHeightXL = 300.0;

  // Dialog Sizes
  static const double dialogWidthS = 280.0;
  static const double dialogWidthM = 400.0;
  static const double dialogWidthL = 560.0;
  static const double dialogWidthXL = 720.0;

  // Bottom Sheet Sizes
  static const double bottomSheetHeightS = 200.0;
  static const double bottomSheetHeightM = 300.0;
  static const double bottomSheetHeightL = 400.0;
  static const double bottomSheetHeightXL = 500.0;

  // Grid Spacing
  static const double gridSpacingXS = 4.0;
  static const double gridSpacingS = 8.0;
  static const double gridSpacingM = 16.0;
  static const double gridSpacingL = 24.0;
  static const double gridSpacingXL = 32.0;

  // Room UI Specific
  static const double roomCardHeight = 180.0;
  static const double roomCardWidth = 320.0;
  static const double roomAvatarSize = 48.0;
  static const double roomHeaderHeight = 64.0;
  static const double roomFooterHeight = 80.0;
  static const double roomSidebarWidth = 280.0;

  // Gift UI Specific
  static const double giftItemSize = 80.0;
  static const double giftAnimationSize = 120.0;
  static const double giftPanelHeight = 240.0;

  // Profile UI Specific
  static const double profileHeaderHeight = 200.0;
  static const double profileAvatarSize = 96.0;
  static const double profileTabBarHeight = 48.0;

  // Navigation
  static const double bottomNavBarHeight = 56.0;
  static const double appBarHeight = 56.0;
  static const double tabBarHeight = 48.0;
  static const double drawerWidth = 280.0;

  // Animations
  static const double animationOffset = 32.0;
  static const Duration animationDurationShort = Duration(milliseconds: 200);
  static const Duration animationDurationMedium = Duration(milliseconds: 300);
  static const Duration animationDurationLong = Duration(milliseconds: 500);

  // Elevation
  static const double elevationXS = 2.0;
  static const double elevationS = 4.0;
  static const double elevationM = 8.0;
  static const double elevationL = 12.0;
  static const double elevationXL = 16.0;

  // Opacity
  static const double opacityDisabled = 0.38;
  static const double opacityOverlay = 0.54;
  static const double opacityHover = 0.08;
  static const double opacityFocus = 0.12;
  static const double opacityPressed = 0.12;
  static const double opacityDragged = 0.16;

  // Device Specific
  static double screenWidth(BuildContext context) => MediaQuery.of(context).size.width;
  static double screenHeight(BuildContext context) => MediaQuery.of(context).size.height;
  static double statusBarHeight(BuildContext context) => MediaQuery.of(context).padding.top;
  static double bottomBarHeight(BuildContext context) => MediaQuery.of(context).padding.bottom;
  static double keyboardHeight(BuildContext context) => MediaQuery.of(context).viewInsets.bottom;

  // Responsive Helpers
  static bool isMobile(BuildContext context) => screenWidth(context) < mobileBreakpoint;
  static bool isTablet(BuildContext context) => screenWidth(context) >= mobileBreakpoint && screenWidth(context) < tabletBreakpoint;
  static bool isDesktop(BuildContext context) => screenWidth(context) >= tabletBreakpoint;

  // Safe Area Helpers
  static EdgeInsets safeAreaPadding(BuildContext context) => MediaQuery.of(context).padding;
  static double safePaddingTop(BuildContext context) => MediaQuery.of(context).padding.top;
  static double safePaddingBottom(BuildContext context) => MediaQuery.of(context).padding.bottom;
  static double safePaddingLeft(BuildContext context) => MediaQuery.of(context).padding.left;
  static double safePaddingRight(BuildContext context) => MediaQuery.of(context).padding.right;
}