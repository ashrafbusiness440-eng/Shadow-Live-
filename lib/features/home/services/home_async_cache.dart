class AsyncTtlCache<T> {
  AsyncTtlCache({
    required this.ttl,
    DateTime Function()? clock,
  }) : _clock = clock ?? DateTime.now;

  final Duration ttl;
  final DateTime Function() _clock;

  T? _value;
  DateTime? _expiresAt;
  Future<T>? _inFlight;

  Future<T> get(
    Future<T> Function() loader, {
    bool forceRefresh = false,
  }) {
    final running = _inFlight;
    if (running != null) return running;

    final expiresAt = _expiresAt;
    final value = _value;
    if (!forceRefresh &&
        value != null &&
        expiresAt != null &&
        expiresAt.isAfter(_clock())) {
      return Future<T>.value(value);
    }

    late final Future<T> future;
    future = Future<T>.sync(loader).then((loaded) {
      _value = loaded;
      _expiresAt = _clock().add(ttl);
      return loaded;
    }).whenComplete(() {
      if (identical(_inFlight, future)) _inFlight = null;
    });
    _inFlight = future;
    return future;
  }

  void clear() {
    _value = null;
    _expiresAt = null;
  }
}
