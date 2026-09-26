import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/gift/services/gift_catalog_service.dart';

void main() {
  test('default gift catalog is valid and ordered', () {
    final gifts = GiftCatalogService.fallbackGifts;
    expect(gifts.length, 12);

    final ids = <String>{};
    var previousPrice = 0;

    for (final gift in gifts) {
      expect(gift.id, isNotEmpty);
      expect(gift.nameAr, isNotEmpty);
      expect(gift.priceCoins, greaterThan(0));
      expect(gift.priceCoins, greaterThanOrEqualTo(previousPrice));
      expect(GiftCatalogService.categories.contains(gift.category), isTrue);
      expect(ids.add(gift.id), isTrue);
      expect(gift.assetKey, 'gifts.placeholder.default');
      expect(
        gift.localPlaceholder,
        'assets/images/gifts/gift_placeholder.webp',
      );
      previousPrice = gift.priceCoins;
    }
  });

  test('API catalog parser filters disabled gifts and preserves sort order', () {
    final gifts = GiftCatalogService.parseCatalog(<Map<String, dynamic>>[
      <String, dynamic>{
        'id': 'later',
        'nameAr': 'لاحق',
        'priceCoins': 200,
        'category': 'general',
        'enabled': true,
        'sortOrder': 2,
      },
      <String, dynamic>{
        'id': 'disabled',
        'nameAr': 'متوقف',
        'priceCoins': 100,
        'category': 'general',
        'enabled': false,
        'sortOrder': 0,
      },
      <String, dynamic>{
        'id': 'first',
        'nameAr': 'أول',
        'priceCoins': 100,
        'category': 'general',
        'enabled': true,
        'sortOrder': 1,
      },
    ]);

    expect(gifts.map((gift) => gift.id).toList(), <String>['first', 'later']);
  });

  test('default gift prices match approved starter table', () {
    expect(
      GiftCatalogService.fallbackGifts
          .map((gift) => gift.priceCoins)
          .toList(),
      <int>[
        100,
        300,
        500,
        1000,
        2500,
        5000,
        10000,
        25000,
        50000,
        100000,
        250000,
        500000,
      ],
    );
  });
}
