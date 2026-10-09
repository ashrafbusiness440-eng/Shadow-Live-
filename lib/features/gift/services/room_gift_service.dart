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

  Future<Map<String, dynamic>> send({
    required String roomId,
    required String giftId,
    required int quantity,
    String recipientMode = 'users',
    List<String> recipientIds = const <String>[],
    bool useGiftBag = false,
  }) async {
    final user = _auth.currentUser;
    final token = await user?.getIdToken();
    if (user == null || token == null || token.isEmpty) {
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

    final key = [
      'roomgift',
      user.uid,
      DateTime.now().microsecondsSinceEpoch.toString(),
      giftId,
    ].join('_');

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

    Map<String, dynamic> body = <String, dynamic>{};
    try {
      final decoded = jsonDecode(response.body);
      if (decoded is Map<String, dynamic>) body = decoded;
    } catch (_) {}

    if (response.statusCode != 200 || body['ok'] != true) {
      throw StateError((body['code'] ?? 'room_gift_failed').toString());
    }
    return body;
  }

  void close() => _client.close();
}
