import 'dart:async';
import 'dart:convert';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import '../services/gift_catalog_service.dart';
import 'unified_gift_picker_sheet.dart';

Future<void> showDirectGiftSheet(
  BuildContext context, {
  required String receiverId,
  required String receiverName,
  String? conversationId,
  String? diaryId,
  void Function(int quantity, int paidCost)? onGiftSent,
}) async {
  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: const Color(0xFF0C101A),
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(26)),
    ),
    builder: (_) => _DirectGiftContext(
      receiverId: receiverId,
      receiverName: receiverName,
      conversationId: conversationId,
      diaryId: diaryId,
      onGiftSent: onGiftSent,
    ),
  );
}

class _DirectGiftContext extends StatefulWidget {
  const _DirectGiftContext({
    required this.receiverId,
    required this.receiverName,
    this.conversationId,
    this.diaryId,
    this.onGiftSent,
  });

  final String receiverId;
  final String receiverName;
  final String? conversationId;
  final String? diaryId;
  final void Function(int quantity, int paidCost)? onGiftSent;

  @override
  State<_DirectGiftContext> createState() => _DirectGiftContextState();
}

class _DirectGiftContextState extends State<_DirectGiftContext> {
  static const _apiBase = String.fromEnvironment(
    'SHADOW_CLOUDFLARE_API_BASE_URL',
    defaultValue: 'https://shadow-live.ashraf-business-440.workers.dev/api',
  );

  String get _uid => FirebaseAuth.instance.currentUser?.uid ?? '';

  String _conversationId() {
    final ids = [_uid, widget.receiverId]..sort();
    return ids.join('_');
  }

  Future<void> _ensureConversation(String conversationId) async {
    final ref = FirebaseFirestore.instance
        .collection('conversations')
        .doc(conversationId);
    try {
      final snapshot = await ref.get();
      if (snapshot.exists) return;
    } on FirebaseException catch (error) {
      if (error.code != 'permission-denied') rethrow;
    }
    final participants = [_uid, widget.receiverId]..sort();
    await ref.set({
      'participants': participants,
      'createdAt': FieldValue.serverTimestamp(),
      'updatedAt': FieldValue.serverTimestamp(),
      'unreadCounts': {_uid: 0, widget.receiverId: 0},
    });
  }

  Future<GiftPickerSendResult> _send(
    GiftCatalogItem gift,
    int quantity,
    bool useGiftBag,
  ) async {
    if (_uid.isEmpty ||
        widget.receiverId.isEmpty ||
        _uid == widget.receiverId) {
      throw StateError('invalid_receiver');
    }

    final diaryId = widget.diaryId?.trim() ?? '';
    final suppliedConversationId =
        widget.conversationId?.trim() ?? '';
    final conversationId = diaryId.isEmpty
        ? (suppliedConversationId.isNotEmpty
            ? suppliedConversationId
            : _conversationId())
        : '';
    if (diaryId.isEmpty && suppliedConversationId.isEmpty) {
      await _ensureConversation(conversationId);
    }

    final token = await FirebaseAuth.instance.currentUser?.getIdToken();
    if (token == null || token.isEmpty) throw StateError('not_signed_in');
    final key = [
      _uid,
      DateTime.now().microsecondsSinceEpoch.toString(),
      gift.id,
      diaryId.isEmpty ? 'profile' : 'diary',
    ].join('_');
    late final http.Response response;
    try {
      response = await http.post(
        Uri.parse('$_apiBase/chat-actions'),
        headers: {
          'authorization': 'Bearer $token',
          'content-type': 'application/json',
        },
        body: jsonEncode({
          'action': 'sendGift',
          'receiverId': widget.receiverId,
          'giftId': gift.id,
          'quantity': quantity,
          'useGiftBag': useGiftBag,
          if (diaryId.isEmpty) 'conversationId': conversationId,
          if (diaryId.isNotEmpty) 'diaryId': diaryId,
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
      if (decoded is Map<String, dynamic>) {
        body = decoded;
      }
    } catch (_) {}

    if (response.statusCode != 200 || body['ok'] != true) {
      throw StateError((body['code'] ?? 'gift_send_failed').toString());
    }

    final totalCost =
        (body['totalCost'] as num?)?.toInt() ?? gift.priceCoins * quantity;
    final paidCost =
        (body['paidCost'] as num?)?.toInt() ?? (useGiftBag ? 0 : totalCost);
    final balance = (body['balance'] as num?)?.toInt();
    if (balance != null) GiftCatalogService.updateCachedBalance(balance);
    widget.onGiftSent?.call(quantity, paidCost);
    return GiftPickerSendResult(
      balanceCoins: balance,
      wealthDeltaCoins: paidCost,
      bagQuantityRemaining:
          (body['bagQuantityRemaining'] as num?)?.toInt(),
      message: 'تم إرسال ${gift.nameAr} ×$quantity إلى ${widget.receiverName}',
    );
  }

  @override
  Widget build(BuildContext context) {
    return UnifiedGiftPickerSheet(
      title: widget.diaryId == null
          ? 'إرسال هدية إلى ${widget.receiverName}'
          : 'هدية ليوميات ${widget.receiverName}',
      canSend: _uid.isNotEmpty &&
          widget.receiverId.isNotEmpty &&
          _uid != widget.receiverId,
      recipientArea: Container(
        height: 44,
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 10),
        decoration: BoxDecoration(
          color: const Color(0xFF151A24),
          borderRadius: BorderRadius.circular(13),
          border: Border.all(color: Colors.white10),
        ),
        child: Row(
          children: [
            const CircleAvatar(
              radius: 14,
              backgroundColor: Color(0xFF2B2141),
              child: Icon(
                Icons.person_rounded,
                color: Colors.white70,
                size: 17,
              ),
            ),
            const SizedBox(width: 7),
            Expanded(
              child: Text(
                widget.receiverName,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 11,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ),
            const Icon(
              Icons.lock_rounded,
              color: Colors.white30,
              size: 14,
            ),
          ],
        ),
      ),
      onSend: _send,
    );
  }
}
