import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

/// Confirms only a server-priced Store purchase. Never writes wallet data
/// directly or supplies a client-calculated balance/discount/level.
class StoreCheckoutService {
  StoreCheckoutService({
    http.Client? client,
    String? baseUrl,
    Future<String?> Function()? tokenProvider,
  }) : _client = client ?? http.Client(),
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
  final String _base;
  final Future<String?> Function() _tokenProvider;

  Future<Map<String, dynamic>> purchase({
    required String productId,
    required String operationId,
    required int expectedPriceCoins,
    required int expectedDurationDays,
  }) async {
    if (!RegExp(r'^[1-9][0-9]{5,8}$').hasMatch(productId) ||
        !RegExp(r'^[A-Za-z0-9_-]{12,100}$').hasMatch(operationId) ||
        expectedPriceCoins <= 0 || expectedDurationDays < 0) {
      throw StateError('invalid_store_purchase_quote');
    }
    final token = await _tokenProvider();
    if (token == null || token.isEmpty) {
      throw StateError('store_login_required');
    }
    final uri = Uri.parse(
      '${_base.replaceFirst(RegExp(r"/+$"), "")}/store-purchase',
    );
    final response = await _client.post(uri, headers: {
      'authorization': 'Bearer $token',
      'content-type': 'application/json',
    }, body: jsonEncode({
      'action': 'purchase',
      'confirmation': 'confirmed',
      'productId': productId,
      'operationId': operationId,
      'expectedPriceCoins': expectedPriceCoins,
      'expectedDurationDays': expectedDurationDays,
    })).timeout(const Duration(seconds: 25));
    final decoded = jsonDecode(response.body);
    if (decoded is! Map || decoded['ok'] != true ||
        response.statusCode != 200) {
      final code = decoded is Map ? decoded['code']?.toString() : null;
      throw StateError(code == null || code.isEmpty
          ? 'store_checkout_unavailable' : code);
    }
    if (decoded['operationId'] != operationId ||
        decoded['productId'] != productId ||
        decoded['priceCoins'] != expectedPriceCoins ||
        decoded['durationDays'] != expectedDurationDays ||
        decoded['deliveryStatus'] != 'delivered') {
      throw StateError('invalid_store_purchase_receipt');
    }
    return Map<String, dynamic>.from(decoded);
  }

  void close() => _client.close();
}
