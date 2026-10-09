/// Client-only projection of confirmed paid PK gift events.
/// The room snapshot is the lifecycle authority; server PK score snapshots
/// rebase counts so entering mid-round never starts at zero.
class PkScoreOverlay {
  static const int _maxOperations = 256;
  static const int _maxRecipients = 16;
  static const int _safeMax = 9007199254740991;
  String _roundId = '';
  int _revision = 0;
  final Map<String, int> _baseTwice = <String, int>{};
  final Map<String, int> _deltasTwice = <String, int>{};
  final Set<String> _seen = <String>{};
  final Map<String, ({int revision, Map<String, int> deltas})> _recent =
      <String, ({int revision, Map<String, int> deltas})>{};

  int get revision => _revision;
  String get roundId => _roundId;

  void clear() {
    _roundId = '';
    _baseTwice.clear();
    _deltasTwice.clear();
    _seen.clear();
    _recent.clear();
  }

  Map<String, dynamic> merge(Map<String, dynamic> room) {
    final rawPk = room['pkState'];
    if (rawPk is! Map) {
      clear();
      return Map<String, dynamic>.from(room);
    }
    final pk = Map<String, dynamic>.from(rawPk);
    final id = (pk['id'] ?? '').toString().trim();
    final status = (pk['status'] ?? '').toString();
    if (id.isEmpty || !const ['active', 'countdown', 'finalizing']
        .contains(status)) {
      clear();
      return Map<String, dynamic>.from(room);
    }
    if (_roundId != id) {
      clear();
      _roundId = id;
    }
    if (_baseTwice.isEmpty && _deltasTwice.isEmpty) {
      return Map<String, dynamic>.from(room);
    }
    final source = pk['participants'];
    if (source is! List) return Map<String, dynamic>.from(room);
    pk['participants'] = source.map((raw) {
      if (raw is! Map) return raw;
      final person = Map<String, dynamic>.from(raw);
      final uid = (person['uid'] ?? '').toString().trim();
      if (uid.isEmpty) return person;
      final current = person['score'];
      final snapshotBase = current is num ? (current * 2).round() : 0;
      final twice = ((_baseTwice[uid] ?? snapshotBase) +
          (_deltasTwice[uid] ?? 0)).clamp(0, _safeMax).toInt();
      person['score'] = twice / 2;
      return person;
    }).toList(growable: false);
    return <String, dynamic>{...room, 'pkState': pk};
  }

  bool apply(Map<String, dynamic> award) {
    final id = (award['roundId'] ?? '').toString().trim();
    final op = (award['operationId'] ?? '').toString().trim();
    if (id.isEmpty || id != _roundId || op.isEmpty ||
        _seen.contains(op)) return false;
    final raw = award['deltas'];
    if (raw is! List) return false;
    final updates = <String, int>{};
    for (final item in raw) {
      if (item is! Map) continue;
      final uid = (item['uid'] ?? '').toString().trim();
      final amount = item['scoreTwice'];
      if (uid.isEmpty || amount is! int || amount <= 0 ||
          amount > _safeMax || updates.length >= _maxRecipients) continue;
      updates[uid] = amount;
    }
    if (updates.isEmpty) return false;
    for (final update in updates.entries) {
      _add(update.key, update.value);
    }
    _revision++;
    if (_seen.length >= _maxOperations) {
      final oldest = _seen.first;
      _seen.remove(oldest);
      _recent.remove(oldest);
    }
    _seen.add(op);
    _recent[op] = (revision: _revision, deltas: updates);
    return true;
  }

  bool installSnapshot(Map<String, dynamic> state, {
    required int startedAtRevision,
  }) {
    final id = (state['id'] ?? '').toString().trim();
    if (id.isEmpty || id != _roundId ||
        !const ['active', 'countdown', 'finalizing']
            .contains(state['status'])) return false;
    final participants = state['participants'];
    if (participants is! List) return false;
    _baseTwice.clear();
    for (final raw in participants) {
      if (raw is! Map || _baseTwice.length >= _maxRecipients) continue;
      final uid = (raw['uid'] ?? '').toString().trim();
      final score = raw['score'];
      if (uid.isEmpty || score is! num || score < 0) continue;
      _baseTwice[uid] = (score * 2).round().clamp(0, _safeMax).toInt();
    }
    _deltasTwice.clear();
    _recent.removeWhere((_, award) =>
        award.revision <= startedAtRevision);
    for (final award in _recent.values) {
      for (final delta in award.deltas.entries) {
        _add(delta.key, delta.value);
      }
    }
    return true;
  }

  void _add(String uid, int amount) {
    if (!_deltasTwice.containsKey(uid) &&
        _deltasTwice.length >= _maxRecipients) {
      _deltasTwice.remove(_deltasTwice.keys.first);
    }
    _deltasTwice[uid] =
        ((_deltasTwice[uid] ?? 0) + amount).clamp(0, _safeMax).toInt();
  }
}
