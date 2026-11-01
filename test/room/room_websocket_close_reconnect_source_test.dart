import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('web transport cleanup cannot block on a cancelled stream listener', () {
    final web = File(
      'lib/features/room/services/room_presence_socket_web.dart',
    ).readAsStringSync();
    final start = web.indexOf('Future<void> close() async {');
    final end = web.indexOf('\n}\n\nFuture<RoomPresenceSocketConnection>', start);
    expect(start, greaterThanOrEqualTo(0));
    expect(end, greaterThan(start));
    final close = web.substring(start, end);
    expect(close, contains('await _messageSubscription.cancel();'));
    expect(close, contains('await _closeSubscription.cancel();'));
    expect(close, contains('await _errorSubscription.cancel();'));
    expect(close, contains('unawaited(_controller.close());'));
    expect(close, isNot(contains('await _controller.close();')));
  });

  test('failed presence transport is disposed before a bounded retry', () {
    final source = File(
      'lib/features/room/services/room_presence_service.dart',
    ).readAsStringSync();
    final start = source.indexOf('Future<void> _connect(');
    final end = source.indexOf('Future<void> join(String roomId, {String? roomPassword})', start);
    final connect = source.substring(start, end);
    expect(connect.indexOf('await failedSubscription?.cancel();'),
        lessThan(connect.indexOf('await failedSocket.close();')));
    expect(connect.indexOf('await failedSocket.close();'),
        lessThan(connect.indexOf('_scheduleReconnect(roomId, generation);')));
    expect(source, contains('static const int _maxReconnectAttempts = 6;'));
    expect(source, isNot(contains('Timer.periodic')));
  });

  test('room reconnect UI does not misdiagnose a server failure as bad internet', () {
    final main = File('lib/main.dart').readAsStringSync();
    expect(main, contains(r'تعذّر اتصال الغرفة (رمز: $code)'));
    expect(main, isNot(contains('تعذر إعادة الاتصال. تحقق من الإنترنت.')));
  });
}
