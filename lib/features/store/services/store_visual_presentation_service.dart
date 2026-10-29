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

  Future<StoreVerifiedFrame?> loadFrame(String uid) =>
      _loadVisual(uid, 'frames');

  // Reuse the same verified owner-scoped projection; never read an editable
  // public profile field to infer a purchased profile card.
  Future<StoreVerifiedFrame?> loadProfileCard(String uid) =>
      _loadVisual(uid, 'profileCards');

  Future<StoreVerifiedFrame?> _loadVisual(String uid, String category) async {
    final results = await loadRoomScopedVisuals(uid, [category]);
    return results[category];
  }

  /// One authenticated request for both room decorations. Never fetch an
  /// individual entitlement from Firestore directly or trust room arguments.
  Future<Map<String, StoreVerifiedFrame>> loadRoomDecorations(String uid) =>
      loadRoomScopedVisuals(uid, const ['roomFrames', 'backgrounds']);

  Future<Map<String, StoreVerifiedFrame>> loadRoomScopedVisuals(
    String uid, List<String> categories,
  ) async {
    final userId = uid.trim();
    if (userId.isEmpty) return {};
    final token = await _tokenProvider();
    if (token == null || token.isEmpty) return {};
    final url = Uri.parse(
      '${_base.replaceFirst(RegExp(r"/+$"), "")}/store-presentation',
    ).replace(queryParameters: {'uid': userId});
    try {
      final response = await _client.get(url, headers: {
        'authorization': 'Bearer $token',
      }).timeout(const Duration(seconds: 8));
      if (response.statusCode != 200) return {};
      final result = jsonDecode(response.body);
      if (result is! Map || result['ok'] != true ||
          result['visuals'] is! Map) return {};
      final rawVisuals = result['visuals'] as Map;
      final verified = <String, StoreVerifiedFrame>{};
      for (final category in categories) {
        // A damaged frame must not hide a separate valid background.
        // All categories are fixed in trusted callers, not in UI input.
        try {
          final visual = StoreVerifiedFrame.fromResponse(rawVisuals[category]);
          if (visual != null && visual.activeNow) verified[category] = visual;
        } on FormatException {
          // Invalid Store claims fail closed for this category alone.
        }
      }
      return verified;
    } catch (_) {
      // Failure is cosmetic only; keep existing level/VIP profile frame.
      return {};
    }
  }

  void close() {
    if (_ownsClient) _client.close();
  }
}
