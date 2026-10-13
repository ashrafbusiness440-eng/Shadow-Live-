import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import '../../lib/admin/content_filter_starter.dart';

void main() {
  test('candidate library contains a bounded, grouped Arabic-first collection', () {
    expect(filterStarterSuggestions.length, inInclusiveRange(150, 250));
    final groups = filterStarterSuggestions.map((e) => e.group).toSet();
    expect(groups, containsAll(<String>{
      'insults', 'sexual', 'bullying', 'threats', 'spam', 'ads',
    }));
    final normalized = filterStarterSuggestions
        .map((e) => normalizeStarterPhrase(e.phrase))
        .toList();
    expect(normalized.toSet().length, normalized.length,
        reason: 'No redundant Arabic spelling variants');
    for (final suggestion in filterStarterSuggestions) {
      expect(suggestion.phrase.length, inInclusiveRange(2, 80));
      expect(['mask', 'flag'], contains(suggestion.action));
      if (suggestion.group == 'threats' ||
          suggestion.group == 'spam' || suggestion.group == 'ads') {
        expect(suggestion.action, 'flag');
      } else {
        expect(suggestion.action, 'mask');
      }
    }
  });

  test('normalization preserves separate words and removes Arabic variants', () {
    expect(normalizeStarterPhrase('إِهَانة'), 'اهانه');
    expect(normalizeStarterPhrase('أنت بلا قيمة'),
        normalizeStarterPhrase('انت بلا قيمه'));
    expect(normalizeStarterPhrase('حق ير') ==
        normalizeStarterPhrase('حقير'), isFalse);
  });

  test('starter candidates are staged inactive and never automatically live', () {
    final control = File('lib/admin/content_filter_control_page.dart')
        .readAsStringSync();
    expect(control.contains('كلمات مقترحة للمراجعة'), isTrue);
    expect(control.contains(" 'enabled': false,"), isTrue);
    expect(control.contains('راجِع'), isFalse);
    expect(control.contains('إضافة للمراجعة'), isTrue);
    expect(control.contains('حفظ التغييرات'), isTrue);
  });
}
