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

  test('dynamic categories are parsed when authorized by the server', () {
    final gifts = GiftCatalogService.parseCatalog([
      {
        'id': 'seasonal_gift',
        'nameAr': 'هدية موسمية',
        'priceCoins': 700,
        'category': 'ramadan',
        'enabled': true,
        'sortOrder': 0,
      },
    ], allowedCategoryIds: {'general', 'ramadan'});
    expect(gifts.single.category, 'ramadan');
  });

  test('server-hidden entire catalog stays empty, never resurrects demo gifts', () {
    expect(GiftCatalogService.parseCatalog([]), isEmpty);
    expect(GiftCatalogService.parseCatalog([
      {
        'id': 'rose',
        'nameAr': 'وردة',
        'priceCoins': 100,
        'category': 'general',
        'enabled': false,
      },
    ]), isEmpty);
  });

  test('gift context and schedule apply at start/end boundaries', () {
    final gift = GiftCatalogItem.fromMap({
      'id': 'seasonal_chat',
      'nameAr': 'هدية للمحادثة',
      'priceCoins': 700,
      'category': 'general',
      'enabled': true,
      'allowedContexts': ['chat'],
      'visibleFromMs': 100000,
      'visibleUntilMs': 200000,
    });
    expect(gift.isAvailableIn('chat',
        at: DateTime.fromMillisecondsSinceEpoch(99999)), isFalse);
    expect(gift.isAvailableIn('chat',
        at: DateTime.fromMillisecondsSinceEpoch(100000)), isTrue);
    expect(gift.isAvailableIn('chat',
        at: DateTime.fromMillisecondsSinceEpoch(199999)), isTrue);
    expect(gift.isAvailableIn('chat',
        at: DateTime.fromMillisecondsSinceEpoch(200000)), isFalse);
    expect(gift.isAvailableIn('room',
        at: DateTime.fromMillisecondsSinceEpoch(150000)), isFalse);
    expect(gift.isAvailableIn('diary',
        at: DateTime.fromMillisecondsSinceEpoch(150000)), isFalse);
    expect(gift.toMap()['allowedContexts'], ['chat']);
    expect(gift.toMap()['visibleFromMs'], 100000);
    expect(gift.toMap()['visibleUntilMs'], 200000);
  });

  test('legacy gift keeps default visibility in all supported contexts', () {
    final gift = GiftCatalogItem.fromMap({
      'id': 'rose',
      'nameAr': 'وردة',
      'priceCoins': 100,
      'category': 'general',
    });
    expect(gift.allowedContexts, ['room', 'chat', 'diary']);
    for (final context in ['room', 'chat', 'diary']) {
      expect(gift.isAvailableIn(context), isTrue);
    }
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
