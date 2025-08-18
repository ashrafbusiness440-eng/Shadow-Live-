import '../constants/app_constants.dart';
import '../constants/app_strings.dart';

class AppValidators {
  // Email Validation
  static String? validateEmail(String? value) {
    if (value == null || value.isEmpty) {
      return AppStrings.emailRequired;
    }

    final emailRegex = RegExp(r'^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}\$');
    if (!emailRegex.hasMatch(value)) {
      return AppStrings.invalidEmail;
    }

    return null;
  }

  // Password Validation
  static String? validatePassword(String? value) {
    if (value == null || value.isEmpty) {
      return AppStrings.passwordRequired;
    }

    if (value.length < AppConstants.minPasswordLength) {
      return AppStrings.passwordTooShort;
    }

    final passwordRegex = RegExp(r'^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8,}\$');
    if (!passwordRegex.hasMatch(value)) {
      return 'Password must contain at least one letter and one number';
    }

    return null;
  }

  // Confirm Password Validation
  static String? validateConfirmPassword(String? value, String password) {
    if (value == null || value.isEmpty) {
      return 'Please confirm your password';
    }

    if (value != password) {
      return AppStrings.passwordsDontMatch;
    }

    return null;
  }

  // Username Validation
  static String? validateUsername(String? value) {
    if (value == null || value.isEmpty) {
      return AppStrings.usernameRequired;
    }

    if (value.length < 3) {
      return AppStrings.usernameTooShort;
    }

    if (value.length > AppConstants.maxUsernameLength) {
      return 'Username is too long';
    }

    final usernameRegex = RegExp(r'^[a-zA-Z0-9_]{3,20}\$');
    if (!usernameRegex.hasMatch(value)) {
      return 'Username can only contain letters, numbers, and underscores';
    }

    return null;
  }

  // Room Name Validation
  static String? validateRoomName(String? value) {
    if (value == null || value.isEmpty) {
      return 'Room name is required';
    }

    if (value.length < AppConstants.minRoomNameLength) {
      return 'Room name is too short';
    }

    if (value.length > AppConstants.maxRoomNameLength) {
      return 'Room name is too long';
    }

    return null;
  }

  // Room Description Validation
  static String? validateRoomDescription(String? value) {
    if (value == null || value.isEmpty) {
      return 'Room description is required';
    }

    if (value.length > AppConstants.maxRoomDescription) {
      return 'Room description is too long';
    }

    return null;
  }

  // Bio Validation
  static String? validateBio(String? value) {
    if (value == null || value.isEmpty) {
      return null; // Bio is optional
    }

    if (value.length > AppConstants.maxBioLength) {
      return 'Bio is too long';
    }

    return null;
  }

  // Gift Amount Validation
  static String? validateGiftAmount(String? value) {
    if (value == null || value.isEmpty) {
      return 'Gift amount is required';
    }

    final amount = int.tryParse(value);
    if (amount == null) {
      return 'Please enter a valid number';
    }

    if (amount < AppConstants.minGiftAmount) {
      return 'Gift amount is too small';
    }

    if (amount > AppConstants.maxGiftAmount) {
      return 'Gift amount is too large';
    }

    return null;
  }

  // Message Validation
  static String? validateMessage(String? value) {
    if (value == null || value.isEmpty) {
      return 'Message cannot be empty';
    }

    if (value.length > AppConstants.maxMessageLength) {
      return 'Message is too long';
    }

    return null;
  }

  // File Size Validation
  static String? validateFileSize(int fileSize, int maxSize) {
    if (fileSize > maxSize) {
      return 'File size exceeds the maximum limit';
    }

    return null;
  }

  // File Type Validation
  static String? validateFileType(String fileName, List<String> allowedTypes) {
    final extension = fileName.split('.').last.toLowerCase();
    if (!allowedTypes.contains(extension)) {
      return 'File type not supported';
    }

    return null;
  }

  // URL Validation
  static String? validateUrl(String? value) {
    if (value == null || value.isEmpty) {
      return null; // URL is optional
    }

    final urlRegex = RegExp(
        r'^(https?:\/\/)?[\w\-]+(\.[\w\-]+)+[\/\?\=\&\#\%\w\-]*\$');
    if (!urlRegex.hasMatch(value)) {
      return 'Please enter a valid URL';
    }

    return null;
  }

  // Phone Number Validation
  static String? validatePhoneNumber(String? value) {
    if (value == null || value.isEmpty) {
      return null; // Phone number is optional
    }

    final phoneRegex = RegExp(r'^\+?[0-9]{10,15}\$');
    if (!phoneRegex.hasMatch(value)) {
      return 'Please enter a valid phone number';
    }

    return null;
  }

  // Search Query Validation
  static String? validateSearchQuery(String? value) {
    if (value == null || value.isEmpty) {
      return 'Search query cannot be empty';
    }

    if (value.length < 2) {
      return 'Search query is too short';
    }

    return null;
  }

  // Terms Acceptance Validation
  static String? validateTermsAcceptance(bool? value) {
    if (value == null || !value) {
      return AppStrings.acceptTermsRequired;
    }

    return null;
  }

  // Age Validation
  static String? validateAge(String? value) {
    if (value == null || value.isEmpty) {
      return 'Age is required';
    }

    final age = int.tryParse(value);
    if (age == null) {
      return 'Please enter a valid age';
    }

    if (age < 13) {
      return 'You must be at least 13 years old';
    }

    if (age > 120) {
      return 'Please enter a valid age';
    }

    return null;
  }

  // Date Validation
  static String? validateDate(DateTime? value) {
    if (value == null) {
      return 'Date is required';
    }

    if (value.isAfter(DateTime.now())) {
      return 'Date cannot be in the future';
    }

    return null;
  }

  // Required Field Validation
  static String? validateRequired(String? value, String fieldName) {
    if (value == null || value.isEmpty) {
      return '$fieldName is required';
    }

    return null;
  }
}