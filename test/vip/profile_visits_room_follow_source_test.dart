import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('visitor rows use the same server-verified room-follow resolver as chat', () {
    final source = File(
      'lib/features/vip/screens/profile_visit_history_screen.dart',
    ).readAsStringSync();
    expect(source.contains('RoomRealtimeQueryService _roomFollowQuery'), isTrue);
    expect(source.contains('_roomFollowQuery.resolveRoomFollows('), isTrue);
    expect(source.contains('RoomFollowNavigation.open('), isTrue);
    expect(source.contains("Text('في غرفة'"), isTrue);
    expect(source.contains("ValueKey('visit-room-follow-"), isTrue);
    expect(source.contains("_followLocations.containsKey(item.uid)"), isTrue);
  });

  test('visitors are batched 8 UIDs per server request and never polled', () {
    final source = File(
      'lib/features/vip/screens/profile_visit_history_screen.dart',
    ).readAsStringSync();
    expect(source.contains('.take(16)'), isTrue);
    expect(source.contains('index += 8'), isTrue);
    expect(source.contains('ids.sublist(index, end)'), isTrue);
    expect(source.contains("'عرض حالة الغرف لباقي الزوار'"), isTrue);
    expect(source.contains("'تعذر التحقق — إعادة المحاولة'"), isTrue);
    expect(source.contains('Timer.periodic('), isFalse);
    expect(source.contains('watch('), isFalse);
    expect(source.contains('.snapshots()'), isFalse);
  });

  test('a different account cannot inherit visitor-follow badges', () {
    final source = File(
      'lib/features/vip/screens/profile_visit_history_screen.dart',
    ).readAsStringSync();
    expect(source.contains('authStateChanges().listen((user)'), isTrue);
    expect(source.contains('_ownerUid = user?.uid;'), isTrue);
    expect(source.contains('_followGeneration++'), isTrue);
    expect(source.contains('_followLocations.clear()'), isTrue);
    expect(source.contains('generation == _followGeneration'), isTrue);
    expect(source.contains('FirebaseAuth.instance.currentUser?.uid == uid'),
        isTrue);
    expect(source.contains('_authSubscription?.cancel()'), isTrue);
    expect(source.contains('_roomFollowQuery.close()'), isTrue);
  });

  test('profile visit privacy remains on the source history API', () {
    final visitService = File(
      'lib/features/vip/services/profile_visit_service.dart',
    ).readAsStringSync();
    final followScreen = File(
      'lib/features/vip/screens/profile_visit_history_screen.dart',
    ).readAsStringSync();
    expect(visitService.contains("'mode': visited ? 'visited' : 'visitors'"),
        isTrue);
    expect(followScreen.contains('ProfileVisitService _service'), isTrue);
    expect(followScreen.contains('await _roomFollowQuery.resolveRoomFollows('),
        isTrue);
    expect(followScreen.contains('collection(\'profile_visit_private\')'),
        isFalse);
  });
}
