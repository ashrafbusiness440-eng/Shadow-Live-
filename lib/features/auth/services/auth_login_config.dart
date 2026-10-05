import 'dart:convert';

import 'package:http/http.dart' as http;

class AuthLoginConfig {
  const AuthLoginConfig({
    required this.email,
    required this.google,
    required this.guest,
    required this.phone,
    required this.facebook,
    required this.apple,
    required this.optionalAccountLinking,
  });

  final bool email;
  final bool google;
  final bool guest;
  final bool phone;
  final bool facebook;
  final bool apple;
  final bool optionalAccountLinking;

  static const defaults = AuthLoginConfig(
    email: true,
    google: true,
    guest: true,
    phone: false,
    facebook: false,
    apple: false,
    optionalAccountLinking: false,
  );

  factory AuthLoginConfig.fromMap(Map<String, dynamic> map) {
    final providers = map['providers'] is Map
        ? Map<String, dynamic>.from(map['providers'] as Map)
        : const <String, dynamic>{};

    bool value(String key, bool fallback) {
      final raw = providers[key];
      return raw is bool ? raw : fallback;
    }

    final optional = map['optionalAccountLinking'];
    return AuthLoginConfig(
      email: value('email', defaults.email),
      google: value('google', defaults.google),
      guest: value('guest', defaults.guest),
      phone: value('phone', defaults.phone),
      facebook: value('facebook', defaults.facebook),
      apple: value('apple', defaults.apple),
      optionalAccountLinking: optional is bool
          ? optional
          : defaults.optionalAccountLinking,
    );
  }

  bool providerEnabled(String provider) => switch (provider) {
        'email' => email,
        'google' => google,
        'guest' => guest,
        'phone' => phone,
        'facebook' => facebook,
        'apple' => apple,
        _ => false,
      };

  String get postSignupSetupStep =>
      optionalAccountLinking ? 'linking' : 'ready';

  String get postSignupRoute =>
      optionalAccountLinking ? '/account-linking' : '/account-ready';

  Map<String, dynamic> toMap() => {
        'providers': {
          'email': email,
          'google': google,
          'guest': guest,
          'phone': phone,
          'facebook': facebook,
          'apple': apple,
        },
        'optionalAccountLinking': optionalAccountLinking,
      };
}

abstract final class AuthLoginConfigService {
  static const _apiBase = String.fromEnvironment(
    'SHADOW_CLOUDFLARE_API_BASE_URL',
    defaultValue: 'https://shadow-live.ashraf-business-440.workers.dev/api',
  );

  static Future<AuthLoginConfig>? _cached;
  static DateTime? _cachedAt;
  static const _cacheTtl = Duration(seconds: 30);

  static Uri get _endpoint {
    final base = _apiBase.endsWith('/')
        ? _apiBase.substring(0, _apiBase.length - 1)
        : _apiBase;
    return Uri.parse('$base/auth-config');
  }

  static Future<AuthLoginConfig> load({
    http.Client? client,
    bool refresh = false,
  }) {
    if (refresh) {
      _cached = null;
      _cachedAt = null;
    }
    if (client != null) return _load(client);
    final now = DateTime.now();
    final cachedAt = _cachedAt;
    if (_cached != null &&
        cachedAt != null &&
        now.difference(cachedAt) < _cacheTtl) {
      return _cached!;
    }
    _cachedAt = now;
    return _cached = _load(http.Client(), closeClient: true);
  }

  static Future<AuthLoginConfig> _load(
    http.Client client, {
    bool closeClient = false,
  }) async {
    try {
      final response = await client
          .get(_endpoint)
          .timeout(const Duration(seconds: 8));
      if (response.statusCode != 200) return AuthLoginConfig.defaults;
      final decoded = jsonDecode(response.body);
      if (decoded is! Map<String, dynamic>) {
        return AuthLoginConfig.defaults;
      }
      final raw = decoded['config'];
      if (raw is! Map) return AuthLoginConfig.defaults;
      return AuthLoginConfig.fromMap(Map<String, dynamic>.from(raw));
    } catch (_) {
      return AuthLoginConfig.defaults;
    } finally {
      if (closeClient) client.close();
    }
  }

  static Future<bool> providerEnabled(String provider) async =>
      (await load()).providerEnabled(provider);
}
