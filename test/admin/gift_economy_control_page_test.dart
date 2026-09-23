import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/admin/gift_economy_control_page.dart';

void main() {
  testWidgets(
    'Shadow Control edits shares thresholds bonuses and saves the exact payload',
    (tester) async {
      var config = <String, dynamic>{
        'enabled': true,
        'hostPerformanceBonusBps': 200,
        'agencyPerformanceBonusBps': 200,
        'hostBonusQualifiedDays': 9,
        'hostBonusMinutesPerQualifiedDay': 120,
        'agencyBonusActiveHosts': 10,
        'tiers': <Map<String, dynamic>>[
          {
            'id': 'starter',
            'nameAr': 'Starter',
            'minGiftCoins': 0,
            'hostShareBps': 5500,
            'agencyShareBps': 500,
          },
          {
            'id': 'bronze',
            'nameAr': 'Bronze',
            'minGiftCoins': 1000000,
            'hostShareBps': 5700,
            'agencyShareBps': 600,
          },
        ],
      };
      Map<String, dynamic>? saved;

      Future<Map<String, dynamic>> fakePost(
        Map<String, dynamic> payload,
      ) async {
        if (payload['action'] == 'state') {
          return {'ok': true, 'config': config};
        }
        if (payload['action'] == 'save') {
          saved = Map<String, dynamic>.from(payload);
          config = <String, dynamic>{
            ...config,
            ...saved!,
            'tiers': saved!['tiers'],
          };
          return {'ok': true};
        }
        throw StateError('unexpected_action');
      }

      await tester.pumpWidget(
        MaterialApp(
          home: GiftEconomyControlPage(postOverride: fakePost),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Starter'), findsOneWidget);
      expect(find.text('Bronze'), findsOneWidget);

      Future<void> edit(String key, String value) async {
        final finder = find.byKey(ValueKey(key));
        expect(finder, findsOneWidget);
        await tester.ensureVisible(finder);
        await tester.enterText(finder, value);
        await tester.pump();
      }

      await edit('gift-economy-tier-bronze-min-usd', '125');
      await edit('gift-economy-tier-bronze-host-pct', '58.5');
      await edit('gift-economy-tier-bronze-agency-pct', '6.5');
      await edit('gift-economy-host-bonus-pct', '2.5');
      await edit('gift-economy-agency-bonus-pct', '1.5');
      await edit('gift-economy-host-bonus-days', '8');
      await edit('gift-economy-host-minutes-day', '100');
      await edit('gift-economy-agency-active-hosts', '7');

      expect(find.text('Shadow Live: 35.0%'), findsOneWidget);

      final saveButton = find.byKey(const ValueKey('gift-economy-save'));
      await tester.ensureVisible(saveButton);
      await tester.tap(saveButton);
      await tester.pumpAndSettle();

      expect(saved, isNotNull);
      expect(saved!['hostPerformanceBonusBps'], 250);
      expect(saved!['agencyPerformanceBonusBps'], 150);
      expect(saved!['hostBonusQualifiedDays'], 8);
      expect(saved!['hostBonusMinutesPerQualifiedDay'], 100);
      expect(saved!['agencyBonusActiveHosts'], 7);

      final savedTiers = (saved!['tiers'] as List<dynamic>).cast<Map>();
      final bronze = Map<String, dynamic>.from(
        savedTiers.firstWhere((tier) => tier['id'] == 'bronze'),
      );
      expect(bronze['minGiftCoins'], 1250000);
      expect(bronze['hostShareBps'], 5850);
      expect(bronze['agencyShareBps'], 650);

      expect(
        find.text('تم حفظ سياسة المضيف والوكالة وShadow Live.'),
        findsOneWidget,
      );

      final bronzeHost = tester.widget<TextField>(
        find.byKey(const ValueKey('gift-economy-tier-bronze-host-pct')),
      );
      expect(bronzeHost.controller!.text, '58.5');
    },
  );
}
