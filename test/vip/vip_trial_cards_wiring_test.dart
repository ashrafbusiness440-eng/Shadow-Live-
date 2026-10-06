import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('VIP trial cards are wired through API and not direct Firestore access', () {
    final vipScreen =
        File('lib/features/vip/screens/vip_screen.dart').readAsStringSync();
    final cardsScreen = File(
      'lib/features/vip/screens/vip_trial_cards_screen.dart',
    ).readAsStringSync();
    final service =
        File('lib/features/vip/services/vip_service.dart').readAsStringSync();

    expect(vipScreen.contains("'vip-trial-cards-open'"), isTrue);
    expect(vipScreen.contains('VipTrialCardsScreen'), isTrue);
    expect(vipScreen.contains("effectiveVipSource == 'trial_card'"), isTrue);
    expect(vipScreen.contains("'بطاقة تجربة VIP'"), isTrue);

    expect(cardsScreen.contains("'vip-trial-card-use-"), isTrue);
    expect(cardsScreen.contains("'vip-trial-card-gift-"), isTrue);
    expect(cardsScreen.contains('VipFancyIdService'), isTrue);
    expect(cardsScreen.contains('FirebaseFirestore'), isFalse);

    expect(service.contains("'action': 'listTrialCards'"), isTrue);
    expect(service.contains("'action': 'giftTrialCard'"), isTrue);
    expect(service.contains("'action': 'redeemTrialCard'"), isTrue);
  });
}
