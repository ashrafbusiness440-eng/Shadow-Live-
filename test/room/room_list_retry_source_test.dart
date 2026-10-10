import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('room list errors offer manual retry on existing bounded read methods', () {
    final source = File('lib/screens/room/room_list_screen.dart')
        .readAsStringSync();
    expect(source.contains("onPressed: _loading ? null : () => _load(forceRefresh: true)"), isTrue);
    expect(source.contains("onPressed: _libraryLoading"), isTrue);
    expect(source.contains("() => _loadRoomLibrary(forceRefresh: true)"), isTrue);
    expect(source.contains("child: const Text('إعادة المحاولة')"), isTrue);
    expect(source.contains("Future<void> _loadRoomLibrary({bool forceRefresh = false}) async"), isTrue);
    expect(source.contains("if (!forceRefresh && _libraryLoaded && _libraryUid == user.uid) return;"), isTrue);
    expect(source.contains("Future<void> _load({bool forceRefresh = false}) async"), isTrue);
    expect(source.contains("_libraryError = false;"), isTrue);
    expect(source.contains("_libraryError = true"), isTrue);
    expect(source.contains("تعذر تحميل المفضلة والسجل"), isTrue);
    expect(source.contains("لا توجد غرف متاحة حالياً"), isTrue);
    expect(source.contains("يمكنك إعادة تحميل البيانات يدويًا."), isTrue);
  });

  test('retry UI does not create listeners or duplicate room sources', () {
    final source = File('lib/screens/room/room_list_screen.dart')
        .readAsStringSync();
    expect(source.contains("_service.loadRooms("), isTrue);
    expect(source.contains("_roomActions.loadRoomLibrary()"), isTrue);
    expect(source.contains("roomSurfaceImageUrl(room.data)"), isTrue);
    expect(source.contains("StreamBuilder("), isFalse);
    expect(source.contains("FirebaseFirestore.instance"), isFalse);
    expect(source.contains("Timer.periodic"), isFalse);
  });
}
