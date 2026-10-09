import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('gift receiver picker reuses existing room notifier and current lists', () {
    final source = File(
      'lib/features/gift/widgets/room_gift_sheet.dart',
    ).readAsStringSync();
    final room = File('lib/main.dart').readAsStringSync();

    expect(source.contains('Listenable? rosterListenable,'), isTrue);
    expect(source.contains('currentParticipants?.call()'), isTrue);
    expect(source.contains('currentSeats?.call()'), isTrue);
    expect(source.contains('currentOwnerPhotoUrl?.call()'), isTrue);
    expect(source.contains('AnimatedBuilder('), isTrue);
    expect(source.contains('animation: existingRoomNotifier'), isTrue);
    expect(room.contains('rosterListenable: _voiceSession,'), isTrue);
    expect(room.contains('currentParticipants: () =>'), isTrue);
    expect(room.contains('currentSeats: () =>'), isTrue);
  });

  test('gift receiver list still contains the owner and occupied seats', () {
    final source = File(
      'lib/features/gift/widgets/room_gift_sheet.dart',
    ).readAsStringSync();
    expect(source.contains('if (ownerUid.isNotEmpty) ownerUid,'), isTrue);
    expect(source.contains('for (final seat in _liveSeats)'), isTrue);
    expect(source.contains('if (!seat.occupied || !seen.add(seat.uid)) continue;'),
        isTrue);
    expect(source.contains('final seatNumber = _seatNumber(uid);'), isTrue);
    expect(source.contains('Set<String> get _micIds => _liveSeats'), isTrue);
    expect(source.contains('_selectedIds.intersection(_availableReceiverIds)'),
        isTrue);
    expect(source.contains('recipientIds: _currentSelectedIds.toList('),
        isTrue);
  });

  test('live gift picker adds no Firestore or websocket observer', () {
    final source = File(
      'lib/features/gift/widgets/room_gift_sheet.dart',
    ).readAsStringSync();
    expect(source.contains('.snapshots()'), isFalse);
    expect(source.contains('StreamSubscription<'), isFalse);
    expect(source.contains('Timer.periodic('), isFalse);
  });
}
