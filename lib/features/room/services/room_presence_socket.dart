import 'room_presence_socket_base.dart';
import 'room_presence_socket_stub.dart'
    if (dart.library.io) 'room_presence_socket_io.dart'
    if (dart.library.html) 'room_presence_socket_web.dart' as platform;

export 'room_presence_socket_base.dart';

Future<RoomPresenceSocketConnection> connectRoomPresenceSocket(Uri uri) =>
    platform.connectRoomPresenceSocket(uri);
