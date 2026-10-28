import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/admin/gift_catalog_numeric_id.dart';

void main() {
  test('suggest first six-digit gift number without asking the owner to type', () {
    expect(nextGiftNumericId(['rose', 'heart']), '100001');
  });
  test('skip numbers in published catalog, saved drafts and local pending list', () {
    expect(nextGiftNumericId(['heart', '100001', '100002', '100004']), '100003');
  });
  test('numeric identifiers remain stable as strings and never modify old IDs', () {
    final ids = <String>['100001', 'rose', '100002'];
    expect(nextGiftNumericId(ids), '100003');
    expect(ids, ['100001', 'rose', '100002']);
  });
}
