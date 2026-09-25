// ignore_for_file: deprecated_member_use

import 'dart:async';
import 'dart:html' as html;

import 'room_presence_socket_base.dart';

class _WebRoomPresenceSocketConnection
    implements RoomPresenceSocketConnection {
  _WebRoomPresenceSocketConnection(
    this._socket,
    this._controller,
    this._messageSubscription,
    this._closeSubscription,
    this._errorSubscription,
  );

  final html.WebSocket _socket;
  final StreamController<Object?> _controller;
  final StreamSubscription<html.MessageEvent> _messageSubscription;
  final StreamSubscription<html.CloseEvent> _closeSubscription;
  final StreamSubscription<html.Event> _errorSubscription;

  @override
  Stream<Object?> get messages => _controller.stream;

  @override
  Future<void> close() async {
    _socket.close(1000, 'room_leave');
    await _messageSubscription.cancel();
    await _closeSubscription.cancel();
    await _errorSubscription.cancel();
    if (!_controller.isClosed) await _controller.close();
  }
}

Future<RoomPresenceSocketConnection> connectRoomPresenceSocket(Uri uri) {
  final completer = Completer<RoomPresenceSocketConnection>();
  final socket = html.WebSocket(uri.toString());
  final controller = StreamController<Object?>();
  late StreamSubscription<html.Event> openSubscription;
  late StreamSubscription<html.MessageEvent> messageSubscription;
  late StreamSubscription<html.CloseEvent> closeSubscription;
  late StreamSubscription<html.Event> errorSubscription;

  messageSubscription = socket.onMessage.listen((event) {
    if (!controller.isClosed) controller.add(event.data);
  });
  closeSubscription = socket.onClose.listen((_) {
    if (!completer.isCompleted) {
      completer.completeError(StateError('websocket_closed_before_open'));
    }
    if (!controller.isClosed) unawaited(controller.close());
  });
  errorSubscription = socket.onError.listen((_) {
    if (!completer.isCompleted) {
      completer.completeError(StateError('websocket_connect_failed'));
    } else if (!controller.isClosed) {
      controller.addError(StateError('websocket_error'));
    }
  });
  openSubscription = socket.onOpen.listen((_) {
    if (!completer.isCompleted) {
      completer.complete(
        _WebRoomPresenceSocketConnection(
          socket,
          controller,
          messageSubscription,
          closeSubscription,
          errorSubscription,
        ),
      );
    }
    unawaited(openSubscription.cancel());
  });

  return completer.future;
}
