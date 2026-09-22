import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/utils/search_index.dart';

void main() {
  test('Arabic name can be found from first letter through full name', () {
    final tokens = buildSearchTokens(['أشرف']);

    expect(tokens, contains('ا'));
    expect(tokens, contains('اش'));
    expect(tokens, contains('اشر'));
    expect(tokens, contains('اشرف'));
  });

  test('emoji inside a display name becomes searchable', () {
    final tokens = buildSearchTokens(['Ashraf 😊 Live']);

    expect(tokens, contains('😊'));
    expect(searchTextMatches('Ashraf 😊 Live', '😊'), isTrue);
  });

  test('Arabic alef variants and diacritics normalize consistently', () {
    expect(normalizeSearchText('أَشْرَف'), 'اشرف');
    expect(searchTextMatches('إشرف', 'ا'), isTrue);
  });

  test('Arabic and Persian digits normalize to latin digits', () {
    expect(normalizeSearchText('١٢٣۴۵'), '12345');
  });

  test('match ranking prefers exact then prefix then contains', () {
    expect(searchMatchRank('أشرف', 'أشرف'), 0);
    expect(searchMatchRank('أشرف النجم', 'أش'), 1);
    expect(searchMatchRank('محمد أشرف', 'أش'), 2);
    expect(searchMatchRank('xxأشرف', 'أش'), 3);
  });
}
