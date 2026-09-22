String normalizeSearchText(Object? value) {
  var text = (value ?? '').toString().toLowerCase();

  const arabicDigits = '٠١٢٣٤٥٦٧٨٩';
  const persianDigits = '۰۱۲۳۴۵۶۷۸۹';
  for (var i = 0; i < 10; i++) {
    text = text
        .replaceAll(arabicDigits[i], '$i')
        .replaceAll(persianDigits[i], '$i');
  }

  text = text
      .replaceAll(RegExp(r'[\u064B-\u065F\u0670\u06D6-\u06ED]'), '')
      .replaceAll('ـ', '')
      .replaceAll(RegExp(r'[أإآٱ]'), 'ا')
      .replaceAll('ى', 'ي')
      .replaceAll(RegExp(r'\s+'), ' ')
      .trim();

  return text;
}

List<String> buildSearchTokens(
  Iterable<Object?> values, {
  int maxSubstringLength = 8,
  int maxTokens = 512,
}) {
  final tokens = <String>{};

  void add(String token) {
    if (token.isEmpty || tokens.length >= maxTokens) return;
    tokens.add(token);
  }

  for (final value in values) {
    if (tokens.length >= maxTokens) break;
    final normalized = normalizeSearchText(value);
    if (normalized.isEmpty) continue;

    add(normalized);

    final runes = normalized.runes.toList();

    // Prefixes make "ا" -> "اش" -> "اشر" -> "اشرف" instant.
    for (var end = 1; end <= runes.length; end++) {
      add(String.fromCharCodes(runes.take(end)));
      if (tokens.length >= maxTokens) break;
    }

    // Word prefixes help multi-word names such as "محمد اشرف".
    for (final word in normalized.split(' ')) {
      if (word.isEmpty) continue;
      final wordRunes = word.runes.toList();
      for (var end = 1; end <= wordRunes.length; end++) {
        add(String.fromCharCodes(wordRunes.take(end)));
        if (tokens.length >= maxTokens) break;
      }
      if (tokens.length >= maxTokens) break;
    }

    // Short contiguous fragments support emoji/symbol search and partial
    // fragments without requiring a third-party full-text search service.
    for (var start = 0; start < runes.length; start++) {
      if (tokens.length >= maxTokens) break;
      final maxEnd =
          (start + maxSubstringLength).clamp(0, runes.length).toInt();
      for (var end = start + 1; end <= maxEnd; end++) {
        final token = String.fromCharCodes(runes.sublist(start, end)).trim();
        add(token);
        if (tokens.length >= maxTokens) break;
      }
    }
  }

  return tokens.toList(growable: false);
}

bool searchTextMatches(Object? value, Object? query) {
  final text = normalizeSearchText(value);
  final normalizedQuery = normalizeSearchText(query);
  return normalizedQuery.isNotEmpty && text.contains(normalizedQuery);
}

int searchMatchRank(Object? value, Object? query) {
  final text = normalizeSearchText(value);
  final normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery.isEmpty || !text.contains(normalizedQuery)) return 99;
  if (text == normalizedQuery) return 0;
  if (text.startsWith(normalizedQuery)) return 1;
  if (text.split(' ').any((word) => word.startsWith(normalizedQuery))) return 2;
  return 3;
}
