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
    this.profileAvatarAsset = '',
    this.activeProfileFrameAssetKey = '',
    this.activeProfileFrameImageUrl = '',
    this.activeProfileFrameExpiresAtMs = 0,
    this.activeProfileFramePermanent = false,
    this.mysteriousMode = false,
    this.mysteriousId = '',
    required this.vipLevel,
    required this.vipOnlinePriority,
    required this.joinedAtMs,
    required this.lastSeenAtMs,
  });

  final String uid;
  final String displayName;
  final String profileImageUrl;
  final String profileAvatarAsset;
  final String activeProfileFrameAssetKey;
  final String activeProfileFrameImageUrl;
  final int activeProfileFrameExpiresAtMs;
  final bool activeProfileFramePermanent;
  final bool mysteriousMode;
  final String mysteriousId;
  final int vipLevel;
  final bool vipOnlinePriority;
  final int joinedAtMs;
  final int lastSeenAtMs;

  factory RoomPresenceUser.fromMap(Map<String, dynamic> data) =>
      RoomPresenceUser(
        uid: (data['uid'] ?? '').toString(),
        displayName:
            (data['displayName'] ?? 'مستخدم Shadow Live').toString(),
        profileImageUrl: (data['profileImageUrl'] ?? '').toString(),
        profileAvatarAsset: (data['profileAvatarAsset'] ?? '').toString(),
        activeProfileFrameAssetKey:
            (data['activeProfileFrameAssetKey'] ?? '').toString(),
        activeProfileFrameImageUrl:
            (data['activeProfileFrameImageUrl'] ?? '').toString(),
        activeProfileFrameExpiresAtMs:
            (data['activeProfileFrameExpiresAtMs'] as num?)?.toInt() ?? 0,
        activeProfileFramePermanent:
            data['activeProfileFramePermanent'] == true,
        mysteriousMode: data['mysteriousMode'] == true,
        mysteriousId: (data['mysteriousId'] ?? '').toString(),
        vipLevel: (data['vipLevel'] as num?)?.toInt() ?? 0,
        vipOnlinePriority: data['vipOnlinePriority'] == true,
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
  final Map<String, Completer<void>> _pendingChat =
      <String, Completer<void>>{};
  final Map<String, Completer<String>> _pendingChatReports =
      <String, Completer<String>>{};

  RoomPresenceSocketConnection? _socket;
  StreamSubscription<Object?>? _socketSubscription;
  Timer? _reconnectTimer;
  String _desiredRoomId = '';
  int _generation = 0;
  int _reconnectAttempt = 0;
  static const int _maxReconnectAttempts = 6;
  Completer<void>? _readyCompleter;
  // Share admission with explicit chat/gift recovery. A second caller must not
  // invalidate the socket being opened by the first room join.
  Future<void>? _joinInFlight;
  String _joinRoomId = '';
  String _readyRoomId = '';
  String _lastConnectionError = 'room_realtime_not_connected';

  // Safe, bounded failure codes from the existing ticket/socket path.
  // No telemetry listener or additional backend request is required.
  String get lastConnectionError => _lastConnectionError;

  Stream<RoomRealtimeEvent> get events => _eventsController.stream;

  bool isReadyFor(String roomId) {
    final id = roomId.trim();
    return id.isNotEmpty &&
        _desiredRoomId == id &&
        _readyRoomId == id &&
        _socket != null;
  }

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
      if (type == 'server.ready') {
        _lastConnectionError = '';
        _readyRoomId = _desiredRoomId;
        final ready = _readyCompleter;
        if (ready != null && !ready.isCompleted) ready.complete();
      }
      final rawPayload = map['payload'];
      final payload = rawPayload is Map
          ? Map<String, dynamic>.from(rawPayload)
          : <String, dynamic>{};
      final requestId = (payload['requestId'] ?? '').toString().trim();
      if (requestId.isNotEmpty && type == 'room.chat_ack') {
        _pendingChat.remove(requestId)?.complete();
      } else if (requestId.isNotEmpty &&
          type == 'room.chat_report_ack') {
        final reportId = (payload['reportId'] ?? '').toString().trim();
        final pendingReport = _pendingChatReports.remove(requestId);
        if (reportId.isEmpty) {
          pendingReport?.completeError(StateError('room_report_missing_id'));
        } else {
          pendingReport?.complete(reportId);
        }
      } else if (requestId.isNotEmpty && type == 'server.error') {
        final code = (payload['code'] ?? 'room_chat_failed').toString();
        final chat = _pendingChat.remove(requestId);
        final report = _pendingChatReports.remove(requestId);
        chat?.completeError(StateError(code));
        report?.completeError(StateError(code));
      }
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

  void _failPendingChat(String code) {
    final pending = [
      ..._pendingChat.values,
      ..._pendingChatReports.values,
    ];
    _pendingChat.clear();
    _pendingChatReports.clear();
    for (final completer in pending) {
      if (!completer.isCompleted) {
        completer.completeError(StateError(code));
      }
    }
  }

  Future<String> reportChatMessage({
    required String roomId,
    required String messageId,
    required String reason,
  }) async {
    final id = roomId.trim();
    final targetMessageId = messageId.trim();
    final reportReason = reason.trim();
    if (id.isEmpty || id != _desiredRoomId || _socket == null) {
      throw StateError('room_realtime_not_connected');
    }
    if (targetMessageId.isEmpty || reportReason.isEmpty) {
      throw StateError('invalid_room_report');
    }

    final requestId = 'report_' +
        DateTime.now().microsecondsSinceEpoch.toString() +
        '_' +
        _generation.toString();
    final completer = Completer<String>();
    _pendingChatReports[requestId] = completer;
    try {
      _socket!.send(
        jsonEncode({
          'type': 'client.room_chat_report',
          'requestId': requestId,
          'payload': {
            'roomId': id,
            'messageId': targetMessageId,
            'reason': reportReason,
          },
        }),
      );
      return await completer.future.timeout(
        const Duration(seconds: 5),
        onTimeout: () => throw StateError('room_report_timeout'),
      );
    } finally {
      _pendingChatReports.remove(requestId);
    }
  }

  Future<void> sendChat({
    required String roomId,
    required String text,
    String? replyTo,
    String? replyPreview,
    String? replySenderUid,
    List<String> mentionUids = const [],
    String? animatedEmojiId,
  }) async {
    final id = roomId.trim();
    final message = text.trim();
    if (id.isEmpty || id != _desiredRoomId || _socket == null) {
      throw StateError('room_realtime_not_connected');
    }
    if (message.isEmpty || message.length > 500) {
      throw StateError('invalid_room_message');
    }

    final requestId = 'chat_' +
        DateTime.now().microsecondsSinceEpoch.toString() +
        '_' +
        _generation.toString();
    final completer = Completer<void>();
    _pendingChat[requestId] = completer;
    try {
      _socket!.send(
        jsonEncode({
          'type': 'client.room_chat',
          'requestId': requestId,
          'payload': {
            'roomId': id,
            'text': message,
            if (replyTo != null && replyTo.trim().isNotEmpty)
              'replyTo': replyTo.trim(),
            if (replyPreview != null && replyPreview.trim().isNotEmpty)
              'replyPreview': replyPreview.trim(),
            if (replySenderUid != null && replySenderUid.trim().isNotEmpty)
              'replySenderUid': replySenderUid.trim(),
            if (mentionUids.isNotEmpty)
              'mentionUids': mentionUids
                  .map((value) => value.trim())
                  .where((value) => value.isNotEmpty)
                  .take(10)
                  .toList(growable: false),
            if (animatedEmojiId != null && animatedEmojiId.trim().isNotEmpty)
              'animatedEmojiId': animatedEmojiId.trim(),
          },
        }),
      );
      await completer.future.timeout(
        const Duration(seconds: 5),
        onTimeout: () => throw StateError('room_chat_timeout'),
      );
    } finally {
      _pendingChat.remove(requestId);
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
    if (_reconnectAttempt >= _maxReconnectAttempts) return;

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
    final wasReady = _readyRoomId == roomId;
    _socket = null;
    _socketSubscription = null;
    _readyRoomId = '';
    _lastConnectionError = 'room_realtime_disconnected';
    final ready = _readyCompleter;
    if (ready != null && !ready.isCompleted) {
      ready.completeError(StateError('room_realtime_disconnected'));
    }
    _readyCompleter = null;
    _failPendingChat('room_realtime_disconnected');
    if (wasReady && !_eventsController.isClosed) {
      _eventsController.add(RoomRealtimeEvent(
        type: 'room.connection_lost',
        payload: <String, dynamic>{'roomId': roomId},
        serverTimeMs: DateTime.now().millisecondsSinceEpoch,
      ));
    }
    // Bounded event-driven reconnect, not polling or a new listener.
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
        'reconnectAttempt': _reconnectAttempt,
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
      // A TCP/WebSocket connection is not room presence until server.ready.
      // Keep the retry budget spent on transports that never become ready.
      _reconnectTimer?.cancel();
      _reconnectTimer = null;
      await oldSubscription?.cancel();
      if (oldSocket != null && !identical(oldSocket, connection)) {
        await oldSocket.close();
      }

      final ready = Completer<void>();
      _readyCompleter = ready;
      _readyRoomId = '';
      _socketSubscription = connection.messages.listen(
        (message) {
          // Ignore late events from an obsolete room or replaced transport.
          if (generation == _generation &&
              _desiredRoomId == roomId &&
              identical(_socket, connection)) {
            _handleSocketMessage(message);
          }
        },
        onError: (_) => _handleSocketEnded(roomId, generation, connection),
        onDone: () => _handleSocketEnded(roomId, generation, connection),
        cancelOnError: false,
      );

      await ready.future.timeout(
        const Duration(seconds: 5),
        onTimeout: () =>
            throw StateError('room_realtime_ready_timeout'),
      );
      if (_desiredRoomId != roomId || generation != _generation) return;
      // Reset retry budget only after the server admitted this room session.
      _reconnectAttempt = 0;

      if (announceOnReady && ticket['alreadyPresent'] != true) {
        unawaited(_announceJoin(roomId));
      }
    } catch (error) {
      _lastConnectionError = switch (error) {
        TimeoutException() => 'room_realtime_ready_timeout',
        http.ClientException() => 'room_network_unavailable',
        StateError() => error.message.toString(),
        _ => 'room_realtime_connection_failed',
      };
      // A socket without server.ready is unusable. Close it before retrying
      // so no stale transport can appear connected to the next room session.
      if (_desiredRoomId == roomId &&
          generation == _generation &&
          _readyRoomId != roomId) {
        final failedSocket = _socket;
        final failedSubscription = _socketSubscription;
        _socket = null;
        _socketSubscription = null;
        _readyCompleter = null;
        try {
          await failedSubscription?.cancel();
        } catch (_) {}
        if (failedSocket != null) {
          try {
            await failedSocket.close();
          } catch (_) {}
        }
      }
      _scheduleReconnect(roomId, generation);
      rethrow;
    }
  }

  Future<void> join(String roomId) {
    final id = roomId.trim();
    if (id.isEmpty) return Future<void>.error(StateError('room_id_missing'));
    if (isReadyFor(id)) return Future<void>.value();

    final pending = _joinInFlight;
    if (pending != null && _joinRoomId == id) return pending;

    late final Future<void> operation;
    operation = _joinOnce(id).whenComplete(() {
      if (identical(_joinInFlight, operation)) {
        _joinInFlight = null;
        _joinRoomId = '';
      }
    });
    _joinRoomId = id;
    _joinInFlight = operation;
    return operation;
  }

  Future<void> _joinOnce(String id) async {
    _generation += 1;
    final generation = _generation;
    _desiredRoomId = id;
    _readyRoomId = '';
    _reconnectAttempt = 0;
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    // Release OUR old socket before awaiting. A newer join must not have
    // its subscription cleared or its transport closed by this operation.
    final previousSubscription = _socketSubscription;
    final previous = _socket;
    _socketSubscription = null;
    _socket = null;
    await previousSubscription?.cancel();
    if (previous != null) await previous.close();

    // A later join or leave may have superseded this admission while awaiting
    // socket disposal. Never open an obsolete room's realtime connection.
    if (generation != _generation || _desiredRoomId != id) return;
    await _connect(id, generation, announceOnReady: true);
  }

  Future<bool> ensureReady(String roomId) async {
    final id = roomId.trim();
    if (id.isEmpty) return false;
    if (isReadyFor(id)) return true;

    try {
      // A user can press Send while initial ZEGO admission has completed but
      // the existing realtime join is still negotiating. Wait for that SAME
      // join; do not start a new ticket or cancel its socket.
      final joining = _joinInFlight;
      if (joining != null && _joinRoomId == id) {
        try {
          await joining.timeout(const Duration(seconds: 7));
        } catch (_) {
          // Failed admission may be repaired once on explicit user action.
        }
        if (isReadyFor(id)) return true;
      }

      // Also reuse an automatic reconnect already awaiting server.ready.
      final pending = _readyCompleter;
      if (_desiredRoomId == id &&
          _socket != null &&
          pending != null &&
          !pending.isCompleted) {
        try {
          await pending.future.timeout(const Duration(seconds: 6));
        } catch (_) {
          // Retry below only if the same room is still the desired session.
        }
        if (isReadyFor(id)) return true;
      }

      // Do not resurrect a room after leave or switch to another room.
      if (_desiredRoomId != id) return false;
      await join(id);
      return isReadyFor(id);
    } catch (_) {
      return false;
    }
  }

  Future<void> leave(String roomId) async {
    final id = roomId.trim();
    _generation += 1;
    _desiredRoomId = '';
    _readyRoomId = '';
    // Clear the flight so a rapid leave/rejoin of the SAME room doesn't
    // accidentally reuse a cancelled admission.
    _joinInFlight = null;
    _joinRoomId = '';
    // Never await a cancelled admission (it may be a stuck handshake).
    final previousReady = _readyCompleter;
    _readyCompleter = null;
    if (previousReady != null && !previousReady.isCompleted) {
      previousReady.completeError(StateError('room_left'));
    }
    _reconnectAttempt = 0;
    _failPendingChat('room_left');
    _reconnectTimer?.cancel();
    _reconnectTimer = null;
    final oldSubscription = _socketSubscription;
    final connection = _socket;
    _socketSubscription = null;
    _socket = null;
    await oldSubscription?.cancel();
    if (connection != null) {
      try {
        await connection.close();
      } catch (_) {}
    }

    if (id.isEmpty) return;
    // The socket is already closed; do not hold ZEGO disconnect hostage
    // to an unresponsive final presence API acknowledgment.
    await _post('voice-session', {
      'action': 'roomSessionLeave',
      'roomId': id,
    }).timeout(const Duration(seconds: 3));
  }

  Future<void> refreshIdentity(String roomId) async {
    final id = roomId.trim();
    if (id.isEmpty) return;
    await _post('room-realtime', {
      'action': 'refreshIdentity',
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
    _readyRoomId = '';
    _joinInFlight = null;
    _joinRoomId = '';
    _readyCompleter = null;
    _failPendingChat('room_realtime_closed');
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
