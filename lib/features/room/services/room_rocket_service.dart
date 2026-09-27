import 'dart:async';
import 'dart:convert';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

import 'room_presence_socket.dart';

class RoomRocketEvent {
  const RoomRocketEvent({
    required this.id,
    required this.roomId,
    required this.level,
    required this.startsAtMs,
    required this.endsAtMs,
    required this.triggerUid,
    required this.triggerDisplayName,
    required this.triggerProfileImageUrl,
    required this.contributorIds,
    required this.top3Ids,
  });

  final String id;
  final String roomId;
  final int level;
  final int startsAtMs;
  final int endsAtMs;
  final String triggerUid;
  final String triggerDisplayName;
  final String triggerProfileImageUrl;
  final List<String> contributorIds;
  final List<String> top3Ids;

  bool activeAt(int nowMs) => nowMs >= startsAtMs && nowMs < endsAtMs;
  bool endedAt(int nowMs) => nowMs >= endsAtMs;

  factory RoomRocketEvent.fromMap(Map<String, dynamic> data) {
    final top3 = data['top3'] is List ? data['top3'] as List : const [];
    return RoomRocketEvent(
      id: (data['explosionId'] ?? data['id'] ?? '').toString(),
      roomId: (data['roomId'] ?? '').toString(),
      level: (data['level'] as num?)?.toInt() ?? 0,
      startsAtMs: (data['startsAtMs'] as num?)?.toInt() ?? 0,
      endsAtMs: (data['endsAtMs'] as num?)?.toInt() ?? 0,
      triggerUid: (data['triggerUid'] ?? '').toString(),
      triggerDisplayName:
          (data['triggerDisplayName'] ?? 'مستخدم Shadow Live').toString(),
      triggerProfileImageUrl:
          (data['triggerProfileImageUrl'] ?? '').toString(),
      contributorIds: data['contributorIds'] is List
          ? (data['contributorIds'] as List)
              .map((e) => e.toString())
              .where((e) => e.isNotEmpty)
              .toList(growable: false)
          : const [],
      top3Ids: top3
          .whereType<Map>()
          .map((e) => (e['uid'] ?? '').toString())
          .where((e) => e.isNotEmpty)
          .toList(growable: false),
    );
  }

  factory RoomRocketEvent.fromDoc(
    QueryDocumentSnapshot<Map<String, dynamic>> doc,
  ) =>
      RoomRocketEvent.fromMap({
        ...doc.data(),
        'id': doc.id,
      });
}

class RoomRocketState {
  const RoomRocketState({
    required this.currentLevel,
    required this.progressCoins,
    required this.thresholdCoins,
    required this.contributors,
  });

  final int currentLevel;
  final int progressCoins;
  final int thresholdCoins;
  final List<Map<String, dynamic>> contributors;

  double get progress => thresholdCoins <= 0
      ? 0
      : (progressCoins / thresholdCoins).clamp(0.0, 1.0).toDouble();

  factory RoomRocketState.fromMap(Map<String, dynamic> data) {
    final raw = data['levelContributors'];
    final contributors = <Map<String, dynamic>>[];
    if (raw is Map) {
      for (final entry in raw.entries) {
        if (entry.value is! Map) continue;
        final item = Map<String, dynamic>.from(entry.value as Map);
        item['uid'] = (item['uid'] ?? entry.key).toString();
        contributors.add(item);
      }
      contributors.sort(
        (a, b) => ((b['coins'] as num?)?.toInt() ?? 0)
            .compareTo((a['coins'] as num?)?.toInt() ?? 0),
      );
    }
    return RoomRocketState(
      currentLevel: (data['currentLevel'] as num?)?.toInt() ?? 1,
      progressCoins: (data['progressCoins'] as num?)?.toInt() ?? 0,
      thresholdCoins: (data['levelThresholdCoins'] as num?)?.toInt() ?? 100000,
      contributors: contributors,
    );
  }
}

class RoomRocketService {
  RoomRocketService({
    FirebaseFirestore? firestore,
    FirebaseAuth? auth,
    http.Client? client,
    String? baseUrl,
  })  : _firestore = firestore ?? FirebaseFirestore.instance,
        _auth = auth ?? FirebaseAuth.instance,
        _client = client ?? http.Client(),
        _baseUrl = baseUrl ??
            const String.fromEnvironment(
              'SHADOW_CLOUDFLARE_API_BASE_URL',
              defaultValue:
                  'https://shadow-live.ashraf-business-440.workers.dev/api',
            );

  static const int _maxFeedEvents = 80;
  static const int _feedRetentionMs = 120000;

  final FirebaseFirestore _firestore;
  final FirebaseAuth _auth;
  final http.Client _client;
  final String _baseUrl;

  final StreamController<List<RoomRocketEvent>> _feedController =
      StreamController<List<RoomRocketEvent>>.broadcast();
  final Map<String, RoomRocketEvent> _feedEvents = <String, RoomRocketEvent>{};

  StreamSubscription<User?>? _authSubscription;
  RoomPresenceSocketConnection? _feedSocket;
  StreamSubscription<Object?>? _feedSocketSubscription;
  Timer? _feedReconnectTimer;
  int _feedGeneration = 0;
  int _feedReconnectAttempt = 0;
  bool _feedStarted = false;

  Stream<List<RoomRocketEvent>> watchRecentEvents() {
    if (!_feedStarted) {
      _feedStarted = true;
      _authSubscription = _auth.idTokenChanges().listen((user) {
        _feedGeneration += 1;
        final generation = _feedGeneration;
        _feedReconnectAttempt = 0;
        _feedReconnectTimer?.cancel();
        _feedReconnectTimer = null;

        if (user == null) {
          _feedEvents.clear();
          _emitFeedEvents();
          unawaited(_closeFeedSocket());
          return;
        }

        unawaited(
          _connectRocketFeed(generation).catchError((_) {}),
        );
      });
    }
    return _feedController.stream;
  }

  Uri _socketUri(String socketPath) {
    final base = Uri.parse(_baseUrl);
    final resolved = base.resolve(socketPath);
    return resolved.replace(
      scheme: resolved.scheme == 'http' ? 'ws' : 'wss',
    );
  }

  Future<Map<String, dynamic>> _requestRocketFeedTicket() async {
    final token = await _auth.currentUser?.getIdToken();
    if (token == null || token.isEmpty) throw StateError('not_signed_in');
    final response = await _client
        .post(
          Uri.parse('$_baseUrl/room-realtime'),
          headers: {
            'authorization': 'Bearer $token',
            'content-type': 'application/json',
          },
          body: jsonEncode({
            'action': 'rocketFeedTicket',
            'reconnectAttempt': _feedReconnectAttempt,
          }),
        )
        .timeout(const Duration(seconds: 15));

    final decoded = response.body.isEmpty
        ? <String, dynamic>{}
        : Map<String, dynamic>.from(jsonDecode(response.body) as Map);
    if (response.statusCode != 200 || decoded['ok'] != true) {
      throw StateError(
        (decoded['code'] ?? 'rocket_feed_ticket_failed').toString(),
      );
    }
    return decoded;
  }

  void _scheduleFeedReconnect(int generation) {
    if (generation != _feedGeneration || _auth.currentUser == null) return;
    if (_feedReconnectTimer?.isActive == true) return;
    if (_feedReconnectAttempt >= 3) return;

    final delaySeconds = 1 << _feedReconnectAttempt;
    _feedReconnectAttempt += 1;
    _feedReconnectTimer = Timer(Duration(seconds: delaySeconds), () {
      if (generation != _feedGeneration || _auth.currentUser == null) return;
      unawaited(
        _connectRocketFeed(generation).catchError((_) {}),
      );
    });
  }

  void _handleFeedEnded(
    int generation,
    RoomPresenceSocketConnection connection,
  ) {
    if (generation != _feedGeneration) return;
    if (!identical(_feedSocket, connection)) return;
    _feedSocket = null;
    _feedSocketSubscription = null;
    _scheduleFeedReconnect(generation);
  }

  Future<void> _connectRocketFeed(int generation) async {
    if (generation != _feedGeneration || _auth.currentUser == null) return;

    try {
      final ticket = await _requestRocketFeedTicket();
      if (generation != _feedGeneration || _auth.currentUser == null) return;

      final socketPath = (ticket['socketPath'] ?? '').toString();
      if (socketPath.isEmpty) throw StateError('rocket_feed_socket_missing');
      final connection = await connectRoomPresenceSocket(
        _socketUri(socketPath),
      );
      if (generation != _feedGeneration || _auth.currentUser == null) {
        await connection.close();
        return;
      }

      final oldSubscription = _feedSocketSubscription;
      final oldSocket = _feedSocket;
      _feedSocket = connection;
      _feedReconnectAttempt = 0;
      _feedReconnectTimer?.cancel();
      _feedReconnectTimer = null;
      await oldSubscription?.cancel();
      if (oldSocket != null && !identical(oldSocket, connection)) {
        await oldSocket.close();
      }

      _feedSocketSubscription = connection.messages.listen(
        _handleFeedMessage,
        onError: (_) => _handleFeedEnded(generation, connection),
        onDone: () => _handleFeedEnded(generation, connection),
        cancelOnError: false,
      );
    } catch (_) {
      _scheduleFeedReconnect(generation);
      rethrow;
    }
  }

  void _handleFeedMessage(Object? raw) {
    if (raw is! String || raw.isEmpty) return;
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! Map) return;
      final envelope = Map<String, dynamic>.from(decoded);
      final type = (envelope['type'] ?? '').toString();
      final rawPayload = envelope['payload'];
      final payload = rawPayload is Map
          ? Map<String, dynamic>.from(rawPayload)
          : <String, dynamic>{};

      if (type == 'server.ready') {
        final rawEvents = payload['recentEvents'];
        if (rawEvents is List) {
          _feedEvents.clear();
          for (final rawEvent in rawEvents.whereType<Map>()) {
            _upsertFeedEvent(Map<String, dynamic>.from(rawEvent));
          }
          _emitFeedEvents();
        }
        return;
      }

      if (type == 'room.rocket_explosion') {
        _upsertFeedEvent(payload);
        _emitFeedEvents();
      }
    } catch (_) {
      // A malformed/future realtime message must never affect room audio.
    }
  }

  void _upsertFeedEvent(Map<String, dynamic> data) {
    final event = RoomRocketEvent.fromMap(data);
    if (event.id.isEmpty || event.roomId.isEmpty) return;
    _feedEvents[event.id] = event;
  }

  void _emitFeedEvents() {
    final nowMs = DateTime.now().millisecondsSinceEpoch;
    _feedEvents.removeWhere(
      (_, event) => event.endsAtMs + _feedRetentionMs <= nowMs,
    );
    final events = _feedEvents.values.toList(growable: false)
      ..sort((a, b) => b.startsAtMs.compareTo(a.startsAtMs));
    final bounded = events.take(_maxFeedEvents).toList(growable: false);
    if (_feedEvents.length > bounded.length) {
      final keep = bounded.map((event) => event.id).toSet();
      _feedEvents.removeWhere((id, _) => !keep.contains(id));
    }
    if (!_feedController.isClosed) {
      _feedController.add(bounded);
    }
  }

  Future<void> _closeFeedSocket() async {
    _feedReconnectTimer?.cancel();
    _feedReconnectTimer = null;
    await _feedSocketSubscription?.cancel();
    _feedSocketSubscription = null;
    final socket = _feedSocket;
    _feedSocket = null;
    if (socket != null) {
      try {
        await socket.close();
      } catch (_) {}
    }
  }

  Stream<RoomRocketState> watchRoomState(String roomId) {
    return _firestore
        .collection('room_rocket_state')
        .doc(roomId)
        .snapshots()
        .map(
          (snapshot) => RoomRocketState.fromMap(
            snapshot.data() ?? const <String, dynamic>{},
          ),
        );
  }

  Future<Map<String, dynamic>> _post(
    String action,
    String explosionId,
  ) async {
    final token = await _auth.currentUser?.getIdToken();
    if (token == null || token.isEmpty) throw StateError('not_signed_in');
    final uri = Uri.parse('$_baseUrl/economy-router').replace(
      queryParameters: const {'route': 'room-rocket'},
    );
    final response = await _client
        .post(
          uri,
          headers: {
            'authorization': 'Bearer $token',
            'content-type': 'application/json',
          },
          body: jsonEncode({
            'action': action,
            'explosionId': explosionId,
          }),
        )
        .timeout(const Duration(seconds: 20));

    final decoded = response.body.isEmpty
        ? <String, dynamic>{}
        : Map<String, dynamic>.from(jsonDecode(response.body) as Map);
    if (response.statusCode < 200 ||
        response.statusCode >= 300 ||
        decoded['ok'] != true) {
      throw StateError((decoded['code'] ?? 'room_rocket_failed').toString());
    }
    return decoded;
  }

  Future<void> enter(String explosionId) async {
    await _post('enter', explosionId);
  }

  Future<Map<String, dynamic>> claim(String explosionId) =>
      _post('claim', explosionId);

  Future<Map<String, dynamic>?> loadRoomNavigationArguments(
    String roomId,
  ) async {
    final snapshot = await _firestore.collection('rooms').doc(roomId).get();
    if (!snapshot.exists) return null;
    final data = snapshot.data() ?? const <String, dynamic>{};
    return {
      ...data,
      'roomId': roomId,
    };
  }

  void close() {
    _feedGeneration += 1;
    _feedStarted = false;
    unawaited(_authSubscription?.cancel());
    _authSubscription = null;
    unawaited(_closeFeedSocket());
    if (!_feedController.isClosed) {
      unawaited(_feedController.close());
    }
    _client.close();
  }
}
