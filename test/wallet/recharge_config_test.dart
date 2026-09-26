import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/wallet/services/recharge_config_service.dart';

void main() {
  test('fallback recharge packages are valid and ordered', () {
    final packages = RechargeConfigService.fallbackPackages;

    expect(packages, isNotEmpty);
    expect(RechargeConfigService.coinsPerUsd, 10000);

    final ids = <String>{};
    final products = <String>{};
    double previousPrice = 0;

    for (final package in packages) {
      expect(package.id, isNotEmpty);
      expect(package.productId, isNotEmpty);
      expect(package.priceUsd, greaterThan(0));
      expect(package.priceUsd, greaterThan(previousPrice));
      expect(package.baseCoins, greaterThan(0));
      expect(package.bonusCoins, greaterThanOrEqualTo(0));
      expect(package.totalCoins, package.baseCoins + package.bonusCoins);
      expect(ids.add(package.id), isTrue);
      expect(products.add(package.productId), isTrue);
      previousPrice = package.priceUsd;
    }
  });

  test('API package parser filters disabled packages and sorts them', () {
    final packages = RechargeConfigService.parsePackages(<Map<String, dynamic>>[
      <String, dynamic>{
        'id': 'later',
        'productId': 'shadow_later',
        'priceUsd': 2.99,
        'baseCoins': 29900,
        'bonusCoins': 100,
        'enabled': true,
        'sortOrder': 2,
      },
      <String, dynamic>{
        'id': 'disabled',
        'productId': 'shadow_disabled',
        'priceUsd': 0.99,
        'baseCoins': 9900,
        'bonusCoins': 100,
        'enabled': false,
        'sortOrder': 0,
      },
      <String, dynamic>{
        'id': 'first',
        'productId': 'shadow_first',
        'priceUsd': 1.99,
        'baseCoins': 19900,
        'bonusCoins': 100,
        'enabled': true,
        'sortOrder': 1,
      },
    ]);

    expect(
      packages.map((package) => package.id).toList(),
      <String>['first', 'later'],
    );
  });

  test('fallback recharge totals match approved package totals', () {
    final totals = RechargeConfigService.fallbackPackages
        .map((package) => package.totalCoins)
        .toList();

    expect(
      totals,
      equals(<int>[
        11000,
        23000,
        60000,
        125000,
        330000,
        700000,
        1500000,
      ]),
    );
  });
}
