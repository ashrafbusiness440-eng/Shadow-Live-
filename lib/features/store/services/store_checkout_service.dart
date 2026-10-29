import 'dart:async';
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

  Map<String, dynamic> _validReceipt(
    Map decoded, {
    required String productId,
    required String operationId,
    required int expectedPriceCoins,
    required int expectedDurationDays,
  }) {
    if (decoded['ok'] != true ||
        decoded['operationId'] != operationId ||
        decoded['productId'] != productId ||
        decoded['priceCoins'] != expectedPriceCoins ||
        decoded['durationDays'] != expectedDurationDays ||
        decoded['deliveryStatus'] != 'delivered') {
      throw StateError('invalid_store_purchase_receipt');
    }
    return Map<String, dynamic>.from(decoded);
  }

  Future<Map<String, dynamic>> _recoverReceipt({
    required String token,
    required String productId,
    required String operationId,
    required int expectedPriceCoins,
    required int expectedDurationDays,
  }) async {
    // A lost response is NOT permission to issue a new charge. Query the
    // immutable, token-scoped receipt via the read-only endpoint instead.
    // Missing or unreachable receipt means "unconfirmed", never "failed".
    try {
      final uri = Uri.parse(
        '${_base.replaceFirst(RegExp(r"/+$"), "")}/store-purchase-status',
      );
      final response = await _client.post(uri, headers: {
        'authorization': 'Bearer $token',
        'content-type': 'application/json',
      }, body: jsonEncode({
        'action': 'status',
        'operationId': operationId,
        'productId': productId,
      })).timeout(const Duration(seconds: 20));
      if (response.statusCode == 200) {
        final decoded = jsonDecode(response.body);
        if (decoded is Map && decoded['ok'] == true &&
            decoded['found'] == true) {
          return _validReceipt(decoded,
            productId: productId,
            operationId: operationId,
            expectedPriceCoins: expectedPriceCoins,
            expectedDurationDays: expectedDurationDays,
          );
        }
      }
    } catch (_) {
      // Keep the same operation ID for explicit manual retry. A status lookup
      // error cannot prove that a transaction failed or that no Coins moved.
    }
    throw StateError('store_purchase_result_unconfirmed');
  }

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
    late final http.Response response;
    try {
      response = await _client.post(uri, headers: {
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
    } on TimeoutException {
      return _recoverReceipt(
        token: token, productId: productId, operationId: operationId,
        expectedPriceCoins: expectedPriceCoins,
        expectedDurationDays: expectedDurationDays,
      );
    } on http.ClientException {
      return _recoverReceipt(
        token: token, productId: productId, operationId: operationId,
        expectedPriceCoins: expectedPriceCoins,
        expectedDurationDays: expectedDurationDays,
      );
    }
    final decoded = jsonDecode(response.body);
    if (decoded is! Map || decoded['ok'] != true ||
        response.statusCode != 200) {
      final code = decoded is Map ? decoded['code']?.toString() : null;
      throw StateError(code == null || code.isEmpty
          ? 'store_checkout_unavailable' : code);
    }
    return _validReceipt(decoded,
      productId: productId, operationId: operationId,
      expectedPriceCoins: expectedPriceCoins,
      expectedDurationDays: expectedDurationDays,
    );
  }

  void close() => _client.close();
}
