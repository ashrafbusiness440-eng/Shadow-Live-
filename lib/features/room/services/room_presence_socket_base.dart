abstract class RoomPresenceSocketConnection {
  Stream<Object?> get messages;

  Future<void> close();
}
