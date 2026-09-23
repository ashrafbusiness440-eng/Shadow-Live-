import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/utils/compact_number.dart';

void main() {
  test('formats balances using shared K/M notation', () {
    expect(formatCompactAmount(0), '0');
    expect(formatCompactAmount(999), '999');
    expect(formatCompactAmount(1000), '1K');
    expect(formatCompactAmount(7300), '7.3K');
    expect(formatCompactAmount(85000), '85K');
    expect(formatCompactAmount(1000000), '1M');
    expect(formatCompactAmount(3500000), '3.5M');
    expect(formatCompactAmount(100000000), '100M');
  });
}
