import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';
import '../constants/app_constants.dart';
import '../utils/app_logger.dart';

class StorageService {
  static final StorageService _instance = StorageService._internal();
  factory StorageService() => _instance;
  StorageService._internal();

  late SharedPreferences _prefs;

  Future<void> initialize() async {
    try {
      _prefs = await SharedPreferences.getInstance();
      AppLogger.i('Storage service initialized', tag: 'Storage');
    } catch (e, stackTrace) {
      AppLogger.e(
        'Storage service initialization error',
        tag: 'Storage',
        error: e,
        stackTrace: stackTrace,
      );
    }
  }

  // Save string value
  Future<bool> setString(String key, String value) async {
    try {
      await _prefs.setString(key, value);
      AppLogger.d('Stored string for key: $key', tag: 'Storage');
      return true;
    } catch (e) {
      AppLogger.e('Error storing string', tag: 'Storage', error: e);
      return false;
    }
  }

  // Get string value
  String? getString(String key) {
    try {
      final value = _prefs.getString(key);
      AppLogger.d('Retrieved string for key: $key', tag: 'Storage');
      return value;
    } catch (e) {
      AppLogger.e('Error retrieving string', tag: 'Storage', error: e);
      return null;
    }
  }

  // Save boolean value
  Future<bool> setBool(String key, bool value) async {
    try {
      await _prefs.setBool(key, value);
      AppLogger.d('Stored boolean for key: $key', tag: 'Storage');
      return true;
    } catch (e) {
      AppLogger.e('Error storing boolean', tag: 'Storage', error: e);
      return false;
    }
  }

  // Get boolean value
  bool? getBool(String key) {
    try {
      final value = _prefs.getBool(key);
      AppLogger.d('Retrieved boolean for key: $key', tag: 'Storage');
      return value;
    } catch (e) {
      AppLogger.e('Error retrieving boolean', tag: 'Storage', error: e);
      return null;
    }
  }

  // Save integer value
  Future<bool> setInt(String key, int value) async {
    try {
      await _prefs.setInt(key, value);
      AppLogger.d('Stored integer for key: $key', tag: 'Storage');
      return true;
    } catch (e) {
      AppLogger.e('Error storing integer', tag: 'Storage', error: e);
      return false;
    }
  }

  // Get integer value
  int? getInt(String key) {
    try {
      final value = _prefs.getInt(key);
      AppLogger.d('Retrieved integer for key: $key', tag: 'Storage');
      return value;
    } catch (e) {
      AppLogger.e('Error retrieving integer', tag: 'Storage', error: e);
      return null;
    }
  }

  // Save double value
  Future<bool> setDouble(String key, double value) async {
    try {
      await _prefs.setDouble(key, value);
      AppLogger.d('Stored double for key: $key', tag: 'Storage');
      return true;
    } catch (e) {
      AppLogger.e('Error storing double', tag: 'Storage', error: e);
      return false;
    }
  }

  // Get double value
  double? getDouble(String key) {
    try {
      final value = _prefs.getDouble(key);
      AppLogger.d('Retrieved double for key: $key', tag: 'Storage');
      return value;
    } catch (e) {
      AppLogger.e('Error retrieving double', tag: 'Storage', error: e);
      return null;
    }
  }

  // Save object value
  Future<bool> setObject(String key, Map<String, dynamic> value) async {
    try {
      final jsonString = json.encode(value);
      await _prefs.setString(key, jsonString);
      AppLogger.d('Stored object for key: $key', tag: 'Storage');
      return true;
    } catch (e) {
      AppLogger.e('Error storing object', tag: 'Storage', error: e);
      return false;
    }
  }

  // Get object value
  Map<String, dynamic>? getObject(String key) {
    try {
      final jsonString = _prefs.getString(key);
      if (jsonString != null) {
        final value = json.decode(jsonString) as Map<String, dynamic>;
        AppLogger.d('Retrieved object for key: $key', tag: 'Storage');
        return value;
      }
      return null;
    } catch (e) {
      AppLogger.e('Error retrieving object', tag: 'Storage', error: e);
      return null;
    }
  }

  // Save list value
  Future<bool> setList(String key, List<String> value) async {
    try {
      await _prefs.setStringList(key, value);
      AppLogger.d('Stored list for key: $key', tag: 'Storage');
      return true;
    } catch (e) {
      AppLogger.e('Error storing list', tag: 'Storage', error: e);
      return false;
    }
  }

  // Get list value
  List<String>? getList(String key) {
    try {
      final value = _prefs.getStringList(key);
      AppLogger.d('Retrieved list for key: $key', tag: 'Storage');
      return value;
    } catch (e) {
      AppLogger.e('Error retrieving list', tag: 'Storage', error: e);
      return null;
    }
  }

  // Save object list value
  Future<bool> setObjectList(String key, List<Map<String, dynamic>> value) async {
    try {
      final jsonString = json.encode(value);
      await _prefs.setString(key, jsonString);
      AppLogger.d('Stored object list for key: $key', tag: 'Storage');
      return true;
    } catch (e) {
      AppLogger.e('Error storing object list', tag: 'Storage', error: e);
      return false;
    }
  }

  // Get object list value
  List<Map<String, dynamic>>? getObjectList(String key) {
    try {
      final jsonString = _prefs.getString(key);
      if (jsonString != null) {
        final List<dynamic> decodedList = json.decode(jsonString);
        final value = decodedList
            .map((item) => item as Map<String, dynamic>)
            .toList();
        AppLogger.d('Retrieved object list for key: $key', tag: 'Storage');
        return value;
      }
      return null;
    } catch (e) {
      AppLogger.e('Error retrieving object list', tag: 'Storage', error: e);
      return null;
    }
  }

  // Remove value
  Future<bool> remove(String key) async {
    try {
      await _prefs.remove(key);
      AppLogger.d('Removed value for key: $key', tag: 'Storage');
      return true;
    } catch (e) {
      AppLogger.e('Error removing value', tag: 'Storage', error: e);
      return false;
    }
  }

  // Clear all values
  Future<bool> clear() async {
    try {
      await _prefs.clear();
      AppLogger.d('Cleared all storage values', tag: 'Storage');
      return true;
    } catch (e) {
      AppLogger.e('Error clearing storage', tag: 'Storage', error: e);
      return false;
    }
  }

  // Check if key exists
  bool hasKey(String key) {
    try {
      return _prefs.containsKey(key);
    } catch (e) {
      AppLogger.e('Error checking key existence', tag: 'Storage', error: e);
      return false;
    }
  }

  // Get all keys
  Set<String> getAllKeys() {
    try {
      return _prefs.getKeys();
    } catch (e) {
      AppLogger.e('Error getting all keys', tag: 'Storage', error: e);
      return {};
    }
  }

  // Save user preferences
  Future<bool> saveUserPreferences(Map<String, dynamic> preferences) async {
    try {
      return await setObject(AppConstants.storageKeys.userPreferences, preferences);
    } catch (e) {
      AppLogger.e('Error saving user preferences', tag: 'Storage', error: e);
      return false;
    }
  }

  // Get user preferences
  Map<String, dynamic>? getUserPreferences() {
    try {
      return getObject(AppConstants.storageKeys.userPreferences);
    } catch (e) {
      AppLogger.e('Error getting user preferences', tag: 'Storage', error: e);
      return null;
    }
  }

  // Save auth token
  Future<bool> saveAuthToken(String token) async {
    try {
      return await setString(AppConstants.storageKeys.authToken, token);
    } catch (e) {
      AppLogger.e('Error saving auth token', tag: 'Storage', error: e);
      return false;
    }
  }

  // Get auth token
  String? getAuthToken() {
    try {
      return getString(AppConstants.storageKeys.authToken);
    } catch (e) {
      AppLogger.e('Error getting auth token', tag: 'Storage', error: e);
      return null;
    }
  }

  // Save user session
  Future<bool> saveUserSession(Map<String, dynamic> session) async {
    try {
      return await setObject(AppConstants.storageKeys.userSession, session);
    } catch (e) {
      AppLogger.e('Error saving user session', tag: 'Storage', error: e);
      return false;
    }
  }

  // Get user session
  Map<String, dynamic>? getUserSession() {
    try {
      return getObject(AppConstants.storageKeys.userSession);
    } catch (e) {
      AppLogger.e('Error getting user session', tag: 'Storage', error: e);
      return null;
    }
  }

  // Clear user data
  Future<bool> clearUserData() async {
    try {
      await remove(AppConstants.storageKeys.authToken);
      await remove(AppConstants.storageKeys.userSession);
      await remove(AppConstants.storageKeys.userPreferences);
      AppLogger.d('Cleared user data', tag: 'Storage');
      return true;
    } catch (e) {
      AppLogger.e('Error clearing user data', tag: 'Storage', error: e);
      return false;
    }
  }
}