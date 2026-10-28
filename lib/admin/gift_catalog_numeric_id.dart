/// Suggests a readable numeric identifier for a new gift. Existing published,
/// local pending and saved-draft identifiers must all be supplied. The server
/// still validates catalog revisions and rejects collisions on save.
String nextGiftNumericId(Iterable<String> occupiedIds) {
  final occupied = occupiedIds.toSet();
  // Keep historical string IDs unchanged. Newly added gifts use a simple
  // six-digit number where possible; a gap is harmless because IDs are opaque.
  var candidate = 100001;
  while (candidate <= 999999999) {
    if (!occupied.contains(candidate.toString())) {
      return candidate.toString();
    }
    candidate++;
  }
  throw StateError('لم يعد هناك رقم متاح لإضافة هدية');
}
