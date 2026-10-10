import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  final source = File('lib/features/home/screens/discovery_search_screen.dart')
      .readAsStringSync();

  test('search reuses Arabic loading empty and retry read feedback', () {
    expect(source.contains("import '../../../shared/widgets/loading_indicator.dart';"),
        isTrue);
    expect(source.contains("message: 'جارٍ البحث...'"), isTrue);
    expect(source.contains("message: 'ما لقينا نتائج مطابقة. جرّب اسمًا أو رقم ID آخر.'"),
        isTrue);
    expect(source.contains('onRetry: _loading ? null : _retryRead'), isTrue);
    expect(source.contains('icon: Icons.wifi_off_rounded'), isTrue);
    expect(source.contains('icon: Icons.search_off_rounded'), isTrue);
  });

  test('search ignores responses for older queries and cancels debounced retries', () {
    expect(source.contains('int _searchGeneration = 0;'), isTrue);
    expect(source.contains('_searchGeneration++;'), isTrue);
    expect(source.contains('final generation = ++_searchGeneration;'), isTrue);
    expect('generation == _searchGeneration'.allMatches(source).length, 3);
    expect(source.contains('void _retryRead() {\n    _debounce?.cancel();\n    _search(_controller.text);'), isTrue);
    expect(source.contains('      _people = const [];\n      _rooms = const [];'), isTrue);
    expect(source.contains('const Duration(milliseconds: 250)'), isTrue);
  });
}
