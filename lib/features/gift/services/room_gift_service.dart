import 'dart:async';
import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

class RoomGiftService {
  RoomGiftService({
    FirebaseAuth? auth,
    http.Client? client,
    String? baseUrl,
  })  : _auth = auth ?? FirebaseAuth.instance,
        _client = client ?? http.Client(),
        _baseUrl = baseUrl ??
            const String.fromEnvironment(
              'SHADOW_CLOUDFLARE_API_BASE_URL',
              defaultValue: 'https://shadow-live.ashraf-business-440.workers.dev/api',
            );

  final FirebaseAuth _auth;
  final http.Client _client;
  final String _baseUrl;

  // Reuse an unresolved operation if an HTTP timeout/network failure may
  // have hidden an already committed gift. This is scoped to this sheet's
  // existing service instance; no extra backend request or listener.
  String _retryFingerprint = '';
  String _retryIdempotencyKey = '';

  void _clearRetryReservation() {
    _retryFingerprint = '';
    _retryIdempotencyKey = '';
  }

  Future<Map<String, dynamic>> send({
    required String roomId,
    required String giftId,
    required int quantity,
    String recipientMode = 'users',
    List<String> recipientIds = const <String>[],
    bool useGiftBag = false,
  }) async {
    final user = _auth.currentUser;
    if (user == null) throw StateError('not_signed_in');
    final senderUid = user.uid;
    final token = await user.getIdToken();
    if (_auth.currentUser?.uid != senderUid) {
      // The response could belong to a different account after an auth swap.
      throw StateError('gift_account_changed');
    }
    if (token == null || token.isEmpty) {
      throw StateError('not_signed_in');
    }

    final normalizedIds = recipientIds
        .map((value) => value.trim())
        .where((value) => value.isNotEmpty)
        .toSet()
        .toList(growable: false);
    if (recipientMode == 'users' && normalizedIds.isEmpty) {
      throw StateError('recipient_required');
    }

    // Preserve the recipient order: the server records recipient suboperations
    // by index. A different order/selection must start a new transaction.
    final fingerprint = jsonEncode(<Object>[
      user.uid,
      roomId,
      giftId,
      quantity,
      recipientMode,
      normalizedIds,
      useGiftBag,
    ]);
    final key =
        _retryFingerprint == fingerprint && _retryIdempotencyKey.isNotEmpty
            ? _retryIdempotencyKey
            : [
                'roomgift',
                user.uid,
                DateTime.now().microsecondsSinceEpoch.toString(),
                giftId,
              ].join('_');
    _retryFingerprint = fingerprint;
    _retryIdempotencyKey = key;

    late final http.Response response;
    try {
      response = await _client.post(
      Uri.parse('$_baseUrl/room-gift'),
      headers: {
        'authorization': 'Bearer $token',
        'content-type': 'application/json',
      },
      body: jsonEncode({
        'roomId': roomId,
        'recipientMode': recipientMode,
        'recipientIds': normalizedIds,
        if (recipientMode == 'users' && normalizedIds.length == 1)
          'receiverId': normalizedIds.single,
        'giftId': giftId,
        'quantity': quantity,
        'useGiftBag': useGiftBag,
        'idempotencyKey': key,
      }),
    ).timeout(const Duration(seconds: 25));
    } on TimeoutException {
      throw StateError('gift_connection_timeout');
    } on http.ClientException {
      throw StateError('gift_network_unavailable');
    }

    // A request may have committed before the user switched accounts.
    // Never surface that account's receipt/balance in the new session.
    if (_auth.currentUser?.uid != senderUid) {
      throw StateError('gift_account_changed');
    }
    Map<String, dynamic> body = <String, dynamic>{};
    try {
      final decoded = jsonDecode(response.body);
      if (decoded is Map<String, dynamic>) body = decoded;
    } catch (_) {}

    if (response.statusCode < 200 || response.statusCode >= 300 || body['ok'] != true) {
      final serverCode = (body['code'] ?? '').toString();
      // These 409 responses are authoritative *pre-charge* rejections in the
      // worker. Others (e.g. idempotency contention) remain uncertain.
      final definiteConflict = response.statusCode == 409 &&
          const <String>{
            'insufficient_balance', 'gift_bag_insufficient', 'gift_inactive',
          }.contains(serverCode);
      if (response.statusCode >= 400 &&
          response.statusCode < 500 &&
          response.statusCode != 408 &&
          (response.statusCode != 409 || definiteConflict)) {
        _clearRetryReservation();
      }
      if (response.statusCode >= 500 ||
          response.statusCode == 408 ||
          (response.statusCode == 409 && !definiteConflict) ||
          (response.statusCode >= 200 && response.statusCode < 300 && body['code'] == null)) {
        throw StateError('gift_confirmation_pending');
      }
      throw StateError((body['code'] ?? 'room_gift_failed').toString());
    }
    // A confirmed success or existing-operation response is definitive.
    _clearRetryReservation();
    return body;
  }

  void close() => _client.close();
}
