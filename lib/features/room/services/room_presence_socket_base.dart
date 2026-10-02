abstract class RoomPresenceSocketConnection {
  Stream<Object?> get messages;

  void send(String message);

  Future<void> close();
}
