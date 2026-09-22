import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';

class StorageService {
  static const String _keyPrefix = 'voice_chat_room_';
  static const String _keyUser = '${_keyPrefix}user';
  static const String _keyTheme = '${_keyPrefix}theme';
  static const String _keySettings = '${_keyPrefix}settings';
  static const String _keyToken = '${_keyPrefix}token';
  static const String _keyOnboarding = '${_keyPrefix}onboarding_completed';

  late SharedPreferences _prefs;
  bool _initialized = false;

  Future<void> init() async {
    if (!_initialized) {
      _prefs = await SharedPreferences.getInstance();
      _initialized = true;
    }
  }

  // User Data
  Future<void> saveUser(Map<String, dynamic> userData) async {
    await init();
    await _prefs.setString(_keyUser, jsonEncode(userData));
  }

  Future<Map<String, dynamic>?> getUser() async {
    await init();
    final userStr = _prefs.getString(_keyUser);
    if (userStr != null) {
      return jsonDecode(userStr) as Map<String, dynamic>;
    }
    return null;
  }

  Future<void> removeUser() async {
    await init();
    await _prefs.remove(_keyUser);
  }

  // Theme
  Future<void> saveThemeMode(String themeMode) async {
    await init();
    await _prefs.setString(_keyTheme, themeMode);
  }

  Future<String?> getThemeMode() async {
    await init();
    return _prefs.getString(_keyTheme);
  }

  // Settings
  Future<void> saveSettings(Map<String, dynamic> settings) async {
    await init();
    await _prefs.setString(_keySettings, jsonEncode(settings));
  }

  Future<Map<String, dynamic>> getSettings() async {
    await init();
    final settingsStr = _prefs.getString(_keySettings);
    if (settingsStr != null) {
      return jsonDecode(settingsStr) as Map<String, dynamic>;
    }
    return {};
  }

  Future<void> updateSettings(String key, dynamic value) async {
    final settings = await getSettings();
    settings[key] = value;
    await saveSettings(settings);
  }

  // Auth Token
  Future<void> saveToken(String token) async {
    await init();
    await _prefs.setString(_keyToken, token);
  }

  Future<String?> getToken() async {
    await init();
    return _prefs.getString(_keyToken);
  }

  Future<void> removeToken() async {
    await init();
    await _prefs.remove(_keyToken);
  }

  // Onboarding Status
  Future<void> setOnboardingCompleted(bool completed) async {
    await init();
    await _prefs.setBool(_keyOnboarding, completed);
  }

  Future<bool> isOnboardingCompleted() async {
    await init();
    return _prefs.getBool(_keyOnboarding) ?? false;
  }

  // Generic Methods
  Future<void> saveData(String key, dynamic value) async {
    await init();
    if (value is String) {
      await _prefs.setString('${_keyPrefix}$key', value);
    } else if (value is int) {
      await _prefs.setInt('${_keyPrefix}$key', value);
    } else if (value is bool) {
      await _prefs.setBool('${_keyPrefix}$key', value);
    } else if (value is double) {
      await _prefs.setDouble('${_keyPrefix}$key', value);
    } else {
      await _prefs.setString('${_keyPrefix}$key', jsonEncode(value));
    }
  }

  Future<T?> getData<T>(String key) async {
    await init();
    final value = _prefs.get('${_keyPrefix}$key');
    if (value != null) {
      if (T == String || T == int || T == bool || T == double) {
        return value as T;
      }
      return jsonDecode(value.toString()) as T;
    }
    return null;
  }

  Future<void> removeData(String key) async {
    await init();
    await _prefs.remove('${_keyPrefix}$key');
  }

  Future<void> clearAll() async {
    await init();
    final keys = _prefs.getKeys();
    for (final key in keys) {
      if (key.startsWith(_keyPrefix)) {
        await _prefs.remove(key);
      }
    }
  }
}