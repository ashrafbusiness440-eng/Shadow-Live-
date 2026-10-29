import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

class StoreOwnedItem {
  const StoreOwnedItem({
    required this.productId,
    required this.nameAr,
    required this.assetKey,
    required this.category,
    required this.source,
    required this.acquiredAtMs,
    required this.expiresAtMs,
    required this.active,
    required this.expired,
    required this.lifecycleState,
  });

  final String productId;
  final String nameAr;
  final String assetKey;
  final String category;
  final String source;
  final int acquiredAtMs;
  final int? expiresAtMs;
  final bool active;
  final bool expired;
  /// Server-projected lifecycle; legacy clients may fall back to prior flags.
  final String lifecycleState;

  factory StoreOwnedItem.fromJson(Map<String, dynamic> value) {
    final id = value['productId']?.toString() ?? '';
    if (!RegExp(r'^[1-9][0-9]{5,8}$').hasMatch(id) ||
        value['assetKey'] != 'store.item.$id.icon' ||
        value['active'] is! bool || value['expired'] is! bool ||
        value['acquiredAtMs'] is! int ||
        (value['acquiredAtMs'] as int) < 0 ||
        (value['expiresAtMs'] != null &&
            (value['expiresAtMs'] is! int ||
                (value['expiresAtMs'] as int) < 0)) ||
        !const {'purchase', 'admin_grant', 'reward'}.contains(value['source'])) {
      throw const FormatException('invalid_store_entitlement');
    }
    final rawState = value['lifecycleState'];
    if (rawState != null &&
        !const {'active', 'expired', 'revoked'}.contains(rawState)) {
      throw const FormatException('invalid_store_entitlement_state');
    }
    // No state field in older responses: preserve the legacy status label.
    final state = rawState is String
        ? rawState
        : value['active'] == true
            ? 'active'
            : value['expired'] == true
                ? 'expired'
                : 'unavailable';
    return StoreOwnedItem(
      productId: id,
      nameAr: (value['nameAr'] ?? '').toString(),
      assetKey: value['assetKey'] as String,
      category: (value['category'] ?? '').toString(),
      source: value['source'] as String,
      acquiredAtMs: value['acquiredAtMs'] as int,
      expiresAtMs: value['expiresAtMs'] as int?,
      active: value['active'] as bool,
      expired: value['expired'] as bool,
      lifecycleState: state,
    );
  }
}

class StoreOwnedItemsResult {
  const StoreOwnedItemsResult(this.items, this.moreMayExist);
  final List<StoreOwnedItem> items;
  final bool moreMayExist;
}

class StoreOwnedItemsService {
  StoreOwnedItemsService({
    http.Client? client,
    String? baseUrl,
    Future<String?> Function()? tokenProvider,
  })  : _client = client ?? http.Client(),
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

  Future<StoreOwnedItemsResult> load() async {
    final token = await _tokenProvider();
    if (token == null || token.isEmpty) {
      throw StateError('store_login_required');
    }
    final endpoint = Uri.parse(
      '${_base.replaceFirst(RegExp(r"/+$"), "")}/my-store-items',
    );
    final response = await _client.get(endpoint,
      headers: {'authorization': 'Bearer $token'},
    ).timeout(const Duration(seconds: 20));
    if (response.statusCode != 200) {
      throw StateError('store_items_unavailable');
    }
    final decoded = jsonDecode(response.body);
    if (decoded is! Map ||
        decoded['ok'] != true ||
        decoded['purchasingEnabled'] != false ||
        decoded['items'] is! List ||
        decoded['moreMayExist'] is! bool) {
      throw const FormatException('invalid_store_items_response');
    }
    final list = decoded['items'] as List;
    if (list.length > 100) {
      throw const FormatException('store_items_limit_exceeded');
    }
    final items = list.map((entry) {
      if (entry is! Map) throw const FormatException('invalid_store_entitlement');
      return StoreOwnedItem.fromJson(Map<String, dynamic>.from(entry));
    }).toList(growable: false);
    return StoreOwnedItemsResult(items, decoded['moreMayExist'] as bool);
  }

  void close() => _client.close();
}
