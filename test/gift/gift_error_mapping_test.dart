import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('room gift recipient picker includes seated users even before presence', () {
    final source = File(
      'lib/features/gift/widgets/room_gift_sheet.dart',
    ).readAsStringSync();
    expect(source.contains('for (final seat in widget.seats)'), isTrue);
    expect(source.contains('if (!seat.occupied || !seen.add(seat.uid)) continue;'),
        isTrue);
    expect(source.contains('RoomPresenceUser.fromMap('), isTrue);
    expect(source.contains("'mysteriousMode': seat.mysteriousMode"), isTrue);
    expect(source.contains("StateError('room_presence_unavailable')"), isFalse);
    expect(source.contains("final result = await _gifts.send("), isTrue);
    expect(source.contains("Timer.periodic"), isFalse);
  });

  test('recipient avatars use existing snapshot without N profile subscriptions', () {
    final picker = File(
      'lib/features/gift/widgets/room_gift_sheet.dart',
    ).readAsStringSync();
    final avatar = File(
      'lib/features/profile/widgets/profile_avatar_with_frame.dart',
    ).readAsStringSync();
    expect(picker.contains('userId: user.uid,\n      snapshotOnly: true,'), isTrue);
    expect(avatar.contains('if (widget.snapshotOnly) return _render(fallback);'),
        isTrue);
    expect(avatar.contains('if (widget.snapshotOnly) return;'), isTrue);
  });

  test('room gift retry retains the same key after uncertain delivery', () {
    final source = File(
      'lib/features/gift/services/room_gift_service.dart',
    ).readAsStringSync();
    expect(source.contains('String _retryFingerprint ='), isTrue);
    expect(source.contains('String _retryIdempotencyKey ='), isTrue);
    expect(
      source.contains(
        '_retryFingerprint == fingerprint && _retryIdempotencyKey.isNotEmpty',
      ),
      isTrue,
    );
    // Sender, room, gift, quantity, mode, ordered recipients, and bag flag
    // are all part of the operation fingerprint.
    for (final part in <String>[
      'user.uid,',
      'roomId,',
      'giftId,',
      'quantity,',
      'recipientMode,',
      'normalizedIds,',
      'useGiftBag,',
    ]) {
      expect(source.contains(part), isTrue, reason: part);
    }
    expect(source.contains("StateError('gift_connection_timeout')"), isTrue);
    expect(source.contains("StateError('gift_network_unavailable')"), isTrue);
    expect(source.contains('response.statusCode != 408'), isTrue);
    expect(source.contains('_clearRetryReservation();'), isTrue);
    expect(source.contains('Timer.periodic'), isFalse);
  });

  test('direct gift retry reuses server key only for the same unresolved request', () {
    final source = File(
      'lib/features/gift/widgets/direct_gift_sheet.dart',
    ).readAsStringSync();

    // A timeout or network error does not prove the first send rolled back.
    // Reusing the key on retry allows the existing server gift_operations
    // transaction to return the previous result without charging twice.
    expect(source.contains('String _retryFingerprint ='), isTrue);
    expect(source.contains('String _retryIdempotencyKey ='), isTrue);
    expect(source.contains('_retryFingerprint == fingerprint && _retryIdempotencyKey.isNotEmpty'), isTrue);
    for (final argument in <String>[
      'widget.receiverId,',
      'gift.id,',
      'quantity.toString(),',
      'useGiftBag.toString(),',
      'diaryId,',
      'conversationId,',
    ]) {
      expect(source.contains(argument), isTrue, reason: argument);
    }
    expect(source.contains("StateError('gift_connection_timeout')"), isTrue);
    expect(source.contains("StateError('gift_network_unavailable')"), isTrue);
    expect(source.contains('response.statusCode != 408'), isTrue);
    expect(source.contains('_clearRetryReservation();'), isTrue);
  });

  test('direct diary gifting reports connection and backend cause', () {
    final direct = File(
      'lib/features/gift/widgets/direct_gift_sheet.dart',
    ).readAsStringSync();
    final picker = File(
      'lib/features/gift/widgets/unified_gift_picker_sheet.dart',
    ).readAsStringSync();
    expect(direct.contains("if (diaryId.isNotEmpty) 'diaryId': diaryId"), isTrue);
    expect(direct.contains("StateError('gift_connection_timeout')"), isTrue);
    expect(direct.contains("StateError('gift_network_unavailable')"), isTrue);
    expect(picker.contains("'gift_connection_timeout'"), isTrue);
    expect(picker.contains("'gift_network_unavailable'"), isTrue);
    expect(picker.contains("'not_found' || 'gift_not_found'"), isTrue);
  });

  test('gift UI maps diary and account failures explicitly', () {
    final source = File(
      'lib/features/gift/widgets/unified_gift_picker_sheet.dart',
    ).readAsStringSync();

    for (final code in <String>[
      'sender_not_found',
      'receiver_not_found',
      'diary_not_found',
      'conversation_not_found',
      'invalid_diary_receiver',
      'invalid_request',
      'unauthorized',
      'transaction_failed',
    ]) {
      expect(source.contains("'$code'"), isTrue, reason: code);
    }
  });
}
