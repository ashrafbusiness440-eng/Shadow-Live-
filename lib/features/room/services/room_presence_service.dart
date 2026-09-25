import 'dart:async';
import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

import 'room_presence_socket.dart';

class RoomPresenceUser {
  const RoomPresenceUser({
    required this.uid,
    required this.displayName,
    required this.profileImageUrl,
    required this.joinedAtMs,
    required this.lastSeenAtMs,
  });

  final String uid;
  final String displayName;
  final String profileImageUrl;
  final int joinedAtMs;
  final int lastSeenAtMs;

  factory RoomPresenceUser.fromMap(Map<String, dynamic> data) =>
      RoomPresenceUser(
        uid: (data['uid'] ?? '').toString(),
        displayName:
            (data['displayName'] ?? 'مستخدم Shadow Live').toString(),
        profileImageUrl: (data['profileImageUrl'] ?? '').toString(),
        joinedAtMs: (data['joinedAtMs'] as num?)?.toInt() ?? 0,
        lastSeenAtMs: (data['lastSeenAtMs'] as num?)?.toInt() ?? 0,
      );
}

class RoomRealtimeEvent {
  const RoomRealtimeEvent({
    required this.type,
    required this.payload,
    required this.serverTimeMs,
  });

  final String type;
  final Map<String, dynamic> payload;
  final int serverTimeMs;
}

class RoomPresenceService {
  RoomPresenceService({
    FirebaseAuth? auth,
    http.Client? client,
    String? baseUrl,
  })  : _auth = auth ?? FirebaseAuth.instance,
        _client = client ?? http.Client(),
        _baseUrl = baseUrl ??
            const String.fromEnvironment(
              'SHADOW_CLOUDFLARE_API_BASE_URL',
              defaultValue:
                  'https://shadow-live.ashraf-business-440.workers.dev/api',
            );

  final FirebaseAuth _auth;
  final http.Client _client;
  final String _baseUrl;
  final StreamController<RoomRealtimeEvent> _eventsController =
      StreamController<RoomRealtimeEvent>.broadcast();

  RoomPresenceSocketConnection? _socket;
  StreamSubscription<Object?>? _socketSubscription;
  Timer? _reconnectTimer;
  String _desiredRoomId = '';
  int _generation = 0;
  int _reconnectAttempt = 0;

  Stream<RoomRealtimeEvent> get events => _eventsController.stream;

  Future<Map<String, dynamic>> _post(
    String endpoint,
    Map<String, dynamic> body,
  ) async {
    final token = await _auth.currentUser?.getIdToken();
    if (token == null || token.isEmpty) throw StateError('not_signed_in');

    final response = await _client.post(
      Uri.parse('$_baseUrl/$endpoint'),
      headers: {
        'authorization': 'Bearer $token',
        'content-type': 'application/json',
      },
      body: jsonEncode(body),
    );

    Map<String, dynamic> decoded = <String, dynamic>{};
    try {
      final value = jsonDecode(response.body);
      if (value is Map<String, dynamic>) decoded = value;
    } catch (_) {}

    if (response.statusCode != 200 || decoded['ok'] != true) {
      throw StateError(
        (decoded['code'] ?? 'room_presence_failed').toString(),
      );
    }
    return decoded;
  }

  Uri _socketUri(String socketPath) {
    final base = Uri.parse(_baseUrl);
    final resolved = base.resolve(socketPath);
    return resolved.replace(
      scheme: resolved.scheme == 'http' ? 'ws' : 'wss',
    );
  }

  void _handleSocketMessage(Object? raw) {
    if (raw is! String || raw.isEmpty) return;
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! Map) return;
      final map = Map<String, dynamic>.from(decoded);
      final type = (map['type'] ?? '').toString().trim();
      if (type.isEmpty) return;
      final rawPayload = map['payload'];
      final payload = rawPayload is Map
          ? Map<String, dynamic>.from(rawPayload)
          : <String, dynamic>{};
      if (!_eventsController.isClosed) {
        _eventsController.add(
          RoomRealtimeEvent(
            type: type,
            payload: payload,
            serverTimeMs: (map['serverTimeMs'] as num?)?.toInt() ?? 0,
          ),
        );
      }
    } catch (_) {
      // Ignore malformed or future protocol messages without affecting voice.
    }
  }

  Future<void> _announceJoin(String roomId) async {
    try {
      await _post('voice-session', {
        'action': 'roomPresenceAnnounceJoin',
        'roomId': roomId,
      });
    } catch (_) {
      // Presence is authoritative from the socket; a join message must never
      // tear down an otherwise healthy realtime connection.
    }
  }

  void _scheduleReconnect(String roomId, int generation) {
    if (_desiredRoomId != roomId || generation != _generation) return;
    if (_reconnectTimer?.isActive == true) return;
    if (_reconnectAttempt >= 3) return;

    final delaySeconds = 1 << _reconnectAttempt;
    _reconnectAttempt += 1;
    _reconnectTimer = Timer(Duration(seconds: delaySeconds), () {
      if (_desiredRoomId != roomId || generation != _generation) return;
      unawaited(
        _connect(
          roomId,
          generation,
          announceOnReady: false,
        ).catchError((_) {}),
      );
    });
  }

  void _handleSocketEnded(
    String roomId,
    int generation,
    RoomPresenceSocketConnection connection,
  ) {
    if (generation != _generation || _desiredRoomId != roomId) return;
    if (!identical(_socket, connection)) return;
    _socket = null;
    _socketSubscription = null;
    _scheduleReconnect(roomId, generation);
  }

  Future<void> _connect(
    String roomId,
    int generation, {
    required bool announceOnReady,
  }) async {
    if (_desiredRoomId != roomId || generation != _generation) return;

    try {
      final ticket = await _post('room-realtime', {
        'action': 'ticket',
        'roomId': roomId,
      });
      if (_desiredRoomId != roomId || generation != _generation) return;

      final socketPath = (ticket['socketPath'] ?? '').toString();
      if (socketPath.isEmpty) throw StateError('realtime_socket_missing');
      final connection = await connectRoomPresenceSocket(
        _socketUri(socketPath),
      );
      if (_desiredRoomId != roomId || generation != _generation) {
        await connection.close();
        return;
      }

      final oldSubscription = _socketSubscription;
      final oldSocket = _socket;
      _socket = connection;
      _reconnectAttempt = 0;
      _reconnectTimer?.cancel();
      _reconnectTimer = null;
      await oldSubscription?.cancel();
      if (oldSocket != null && !identical(oldSocket, connection)) {
        await oldSocket.close();
      }

      _socketSubscription = connection.messages.listen(
        _handleSocketMessage,
        onError: (_) => _handleSocketEnded(roomId, generation, connection),
        onDone: () => _handleSocketEnded(roomId, generation, connection),
        cancelOnError: false,
      );

      if (announceOnReady && ticket['alreadyPresent'] != true) {
        unawaited(_announceJoin(roomId));
      }
    } catch (_) {
      _scheduleReconnect(roomId, generation);
      rethrow;
    }
  }

  Future<void> join(String roomId) async {
    final id = roomId.trim();
    if (id.isEmpty) throw StateError('room_id_missing');
    if (_desiredRoomId == id && _socket != null) return;

    _generation += 1;
    final generation = _generation;
    _desiredRoomId = id;
    _reconnectAttempt = 0;
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    await _socketSubscription?.cancel();
    _socketSubscription = null;
    final previous = _socket;
    _socket = null;
    if (previous != null) await previous.close();

    await _connect(id, generation, announceOnReady: true);
  }

  Future<void> leave(String roomId) async {
    final id = roomId.trim();
    _generation += 1;
    _desiredRoomId = '';
    _reconnectAttempt = 0;
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    await _socketSubscription?.cancel();
    _socketSubscription = null;
    final connection = _socket;
    _socket = null;
    if (connection != null) {
      try {
        await connection.close();
      } catch (_) {}
    }

    if (id.isEmpty) return;
    await _post('voice-session', {
      'action': 'roomSessionLeave',
      'roomId': id,
    });
  }

  Future<List<RoomPresenceUser>> load(String roomId) async {
    final body = await _post('room-realtime', {
      'action': 'presenceState',
      'roomId': roomId,
    });
    final raw = body['participants'];
    if (raw is! List) return const [];
    return raw
        .whereType<Map>()
        .map(
          (item) => RoomPresenceUser.fromMap(
            Map<String, dynamic>.from(item),
          ),
        )
        .where((item) => item.uid.isNotEmpty)
        .toList(growable: false);
  }

  void close() {
    _generation += 1;
    _desiredRoomId = '';
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    unawaited(_socketSubscription?.cancel());
    _socketSubscription = null;
    final connection = _socket;
    _socket = null;
    if (connection != null) unawaited(connection.close());
    if (!_eventsController.isClosed) {
      unawaited(_eventsController.close());
    }
    _client.close();
  }
}
