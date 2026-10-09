/// Session-only projection of server-confirmed paid gift deltas on the room
/// snapshot that is already watched for seats. Does not award coins locally.
class StarBattleScoreOverlay {
  static const int _maxSeenOperations = 256;
  static const int _maxSafeCoins = 9007199254740991;

  String _roundId = '';
  final Map<String, int> _deltas = <String, int>{};
  final Set<String> _seenOperations = <String>{};

  String get roundId => _roundId;

  void clear() {
    _roundId = '';
    _deltas.clear();
    _seenOperations.clear();
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
    if (_deltas.isEmpty) return Map<String, dynamic>.from(room);
    final rawScores = round['scores'];
    final scores = rawScores is Map
        ? Map<String, dynamic>.from(rawScores)
        : <String, dynamic>{};

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
      final previous = _deltas[entry.key] ?? 0;
      _deltas[entry.key] =
          (previous + entry.value).clamp(0, _maxSafeCoins);
    }
    if (_seenOperations.length >= _maxSeenOperations) {
      _seenOperations.remove(_seenOperations.first);
    }
    _seenOperations.add(operationId);
    return true;
  }
}
