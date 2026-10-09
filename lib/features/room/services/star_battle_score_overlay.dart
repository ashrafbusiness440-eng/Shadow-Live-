/// Session-only projection of server-confirmed paid gift deltas on the room
/// snapshot that is already watched for seats. Does not award coins locally.
class StarBattleScoreOverlay {
  static const int _maxSeenOperations = 256;
  static const int _maxTrackedRecipients = 256;
  static const int _maxSafeCoins = 9007199254740991;

  String _roundId = '';
  final Map<String, int> _deltas = <String, int>{};
  final Map<String, Map<String, dynamic>> _bootstrapScores =
      <String, Map<String, dynamic>>{};
  final Map<String, ({int revision, Map<String, int> deltas})> _recentAwards =
      <String, ({int revision, Map<String, int> deltas})>{};
  final Set<String> _seenOperations = <String>{};
  int _revision = 0;

  String get roundId => _roundId;
  int get revision => _revision;

  void clear() {
    _roundId = '';
    _deltas.clear();
    _bootstrapScores.clear();
    _recentAwards.clear();
    _seenOperations.clear();
  }

  /// Rebase from one authoritative room-bootstrap batch read. Keep only
  /// realtime gifts observed after that request started, avoiding replay
  /// of already committed gift deltas when opening a room mid-round.
  bool installBootstrap(Map<String, dynamic> battle, {
    required int startedAtRevision,
  }) {
    final id = (battle['id'] ?? '').toString().trim();
    if (id.isEmpty || battle['status'] != 'active' ||
        (_roundId.isNotEmpty && _roundId != id)) {
      return false;
    }
    if (_roundId.isEmpty) _roundId = id;
    final rawScores = battle['scores'];
    if (rawScores is! Map) return false;

    _bootstrapScores.clear();
    for (final entry in rawScores.entries) {
      final uid = entry.key.toString().trim();
      if (uid.isEmpty || entry.value is! Map ||
          _bootstrapScores.length >= 50) continue;
      final data = Map<String, dynamic>.from(entry.value as Map);
      final coins = data['coins'];
      if (coins is! num || coins < 0) continue;
      _bootstrapScores[uid] = <String, dynamic>{
        ...data,
        'coins': coins.toInt().clamp(0, _maxSafeCoins).toInt(),
      };
    }

    _deltas.clear();
    _recentAwards.removeWhere((_, value) => value.revision <= startedAtRevision);
    for (final award in _recentAwards.values) {
      for (final entry in award.deltas.entries) {
        _addDelta(entry.key, entry.value);
      }
    }
    return true;
  }

  void _addDelta(String uid, int coins) {
    if (!_deltas.containsKey(uid) &&
        _deltas.length >= _maxTrackedRecipients) {
      _deltas.remove(_deltas.keys.first);
    }
    _deltas[uid] =
        ((_deltas[uid] ?? 0) + coins).clamp(0, _maxSafeCoins).toInt();
  }

  Map<String, dynamic> merge(Map<String, dynamic> room) {
    final raw = room['starBattleState'];
    if (raw is! Map) {
      clear();
      return Map<String, dynamic>.from(room);
    }
    final round = Map<String, dynamic>.from(raw);
    final id = (round['id'] ?? '').toString().trim();
    if (round['status'] != 'active' || id.isEmpty) {
      clear();
      return Map<String, dynamic>.from(room);
    }
    if (id != _roundId) {
      clear();
      _roundId = id;
    }
    if (_deltas.isEmpty && _bootstrapScores.isEmpty) {
      return Map<String, dynamic>.from(room);
    }
    final rawScores = round['scores'];
    final scores = rawScores is Map
        ? Map<String, dynamic>.from(rawScores)
        : <String, dynamic>{};
    scores.addAll(_bootstrapScores);

    for (final entry in _deltas.entries) {
      final existing = scores[entry.key];
      final profile = existing is Map
          ? Map<String, dynamic>.from(existing)
          : <String, dynamic>{};
      final base = profile['coins'] is num
          ? (profile['coins'] as num).toInt().clamp(0, _maxSafeCoins)
          : 0;
      scores[entry.key] = <String, dynamic>{
        ...profile,
        'coins': (base + entry.value).clamp(0, _maxSafeCoins),
      };
    }
    return <String, dynamic>{
      ...room,
      'starBattleState': <String, dynamic>{
        ...round,
        'scores': scores,
      },
    };
  }

  /// Only accept signed-server gift feed data for the current round.
  /// Duplicate operations must not increment points twice.
  bool apply(Map<String, dynamic> award) {
    final id = (award['roundId'] ?? '').toString().trim();
    final operationId = (award['operationId'] ?? '').toString().trim();
    final rawDeltas = award['deltas'];
    if (_roundId.isEmpty ||
        id != _roundId ||
        operationId.isEmpty ||
        _seenOperations.contains(operationId) ||
        rawDeltas is! List ||
        rawDeltas.isEmpty ||
        rawDeltas.length > 22) {
      return false;
    }

    final updates = <String, int>{};
    for (final raw in rawDeltas) {
      if (raw is! Map) continue;
      final uid = (raw['uid'] ?? '').toString().trim();
      final coins = raw['coins'];
      if (uid.isEmpty ||
          updates.containsKey(uid) ||
          coins is! int ||
          coins <= 0 ||
          coins > _maxSafeCoins) {
        continue;
      }
      updates[uid] = coins;
    }
    if (updates.isEmpty) return false;

    for (final entry in updates.entries) {
      _addDelta(entry.key, entry.value);
    }
    _revision++;
    if (_seenOperations.length >= _maxSeenOperations) {
      final oldest = _seenOperations.first;
      _seenOperations.remove(oldest);
      _recentAwards.remove(oldest);
    }
    _seenOperations.add(operationId);
    _recentAwards[operationId] = (
      revision: _revision,
      deltas: updates,
    );
    return true;
  }
}
