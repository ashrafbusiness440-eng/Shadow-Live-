import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

/// A validated server projection, NOT the raw user's editable profile data.
/// The server checks Store ownership, expiry and the published visual asset.
class StoreVerifiedFrame {
  const StoreVerifiedFrame({
    required this.assetKey,
    required this.imageUrl,
    required this.expiresAtMs,
  });
  final String assetKey;
  final String imageUrl;
  final int? expiresAtMs;

  bool get activeNow => expiresAtMs == null ||
      expiresAtMs! > DateTime.now().millisecondsSinceEpoch;

  static StoreVerifiedFrame? fromResponse(Object? raw) {
    if (raw == null) return null;
    if (raw is! Map) throw const FormatException('invalid_store_frame');
    final key = raw['assetKey'];
    final url = raw['imageUrl'];
    final expires = raw['expiresAtMs'];
    if (key is! String ||
        !RegExp(r'^store\.item\.[1-9][0-9]{5,8}\.visual$').hasMatch(key) ||
        url is! String ||
        Uri.tryParse(url)?.scheme != 'https' ||
        (expires != null && (expires is! int || expires < 0))) {
      throw const FormatException('invalid_store_frame');
    }
    return StoreVerifiedFrame(
      assetKey: key,
      imageUrl: url,
      expiresAtMs: expires as int?,
    );
  }
}

class StoreVisualPresentationService {
  StoreVisualPresentationService({
    http.Client? client,
    String? baseUrl,
    Future<String?> Function()? tokenProvider,
  }) : _client = client ?? http.Client(),
       _ownsClient = client == null,
       _base = baseUrl ?? const String.fromEnvironment(
         'SHADOW_CLOUDFLARE_API_BASE_URL',
         defaultValue: 'https://shadow-live.ashraf-business-440.workers.dev/api',
       ),
       _tokenProvider = tokenProvider ?? _authToken;

  static Future<String?> _authToken() async {
    final user = FirebaseAuth.instance.currentUser;
    return user == null ? null : await user.getIdToken();
  }

  final http.Client _client;
  final bool _ownsClient;
  final String _base;
  final Future<String?> Function() _tokenProvider;

  Future<StoreVerifiedFrame?> loadFrame(String uid) async {
    final userId = uid.trim();
    if (userId.isEmpty) return null;
    final token = await _tokenProvider();
    if (token == null || token.isEmpty) return null;
    final url = Uri.parse(
      '${_base.replaceFirst(RegExp(r"/+$"), "")}/store-presentation',
    ).replace(queryParameters: {'uid': userId});
    try {
      final response = await _client.get(url, headers: {
        'authorization': 'Bearer $token',
      }).timeout(const Duration(seconds: 8));
      if (response.statusCode != 200) return null;
      final result = jsonDecode(response.body);
      if (result is! Map || result['ok'] != true ||
          result['visuals'] is! Map) return null;
      final visual = StoreVerifiedFrame.fromResponse(
        (result['visuals'] as Map)['frames'],
      );
      return visual != null && visual.activeNow ? visual : null;
    } catch (_) {
      // Failure is cosmetic only; keep existing level/VIP profile frame.
      return null;
    }
  }

  void close() {
    if (_ownsClient) _client.close();
  }
}
