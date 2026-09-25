import 'dart:io';

import 'room_presence_socket_base.dart';

class _IoRoomPresenceSocketConnection
    implements RoomPresenceSocketConnection {
  _IoRoomPresenceSocketConnection(this._socket);

  final WebSocket _socket;

  @override
  Stream<Object?> get messages => _socket;

  @override
  Future<void> close() async {
    await _socket.close(WebSocketStatus.normalClosure, 'room_leave');
  }
}

Future<RoomPresenceSocketConnection> connectRoomPresenceSocket(Uri uri) async {
  final socket = await WebSocket.connect(uri.toString());
  return _IoRoomPresenceSocketConnection(socket);
}
