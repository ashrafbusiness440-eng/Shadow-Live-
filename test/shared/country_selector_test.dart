import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/shared/widgets/country_selector.dart';

void main() {
  test('Bashan is pinned first in the canonical country selector', () {
    expect(shadowCountries, isNotEmpty);
    expect(shadowCountries.first.nameAr, 'الباشان');
    expect(shadowCountries.first.flag, '🇸🇨');
  });

  test('legacy UAE values resolve to the shared canonical country', () {
    expect(shadowCountryByName('الإمارات')?.nameAr, 'الإمارات العربية المتحدة');
    expect(shadowCountryByName('UAE')?.nameAr, 'الإمارات العربية المتحدة');
  });
}
