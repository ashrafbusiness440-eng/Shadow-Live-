import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/profile/screens/public_user_support_screen.dart';
import 'package:voice_chat_room/features/profile/services/user_level_service.dart';

UserLevelSupportItem supporter(int rank) => UserLevelSupportItem(
  uid: 'supporter-$rank',
  displayName: 'مستخدم $rank',
  profileImageUrl: '',
  publicId: '10$rank',
  rank: rank,
  points: 1000 - rank,
  giftCount: 1,
  mysteriousMode: false,
  mysteriousId: '',
  accountDeleted: true,
);

void main() {
  testWidgets('visitor sees two public support tabs, podium 3-1-2, and cursor',
      (tester) async {
    await tester.binding.setSurfaceSize(const Size(430, 800));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final requests = <String>[];
    await tester.pumpWidget(MaterialApp(
      home: PublicUserSupportScreen(
        userId: 'visited-account',
        loadPage: ({required uid, required metric, cursor}) async {
          requests.add('$uid:$metric:${cursor ?? "first"}');
          if (metric == 'attraction') {
            return const UserLevelSupportPage(
              metric: 'attraction',
              items: [],
              nextCursor: null,
              totalCap: 100,
              pageSize: 20,
            );
          }
          return UserLevelSupportPage(
            metric: 'wealth',
            items: cursor == null
                ? [supporter(1), supporter(2), supporter(3), supporter(4)]
                : [supporter(5)],
            nextCursor: cursor == null ? 'next-page' : null,
            totalCap: 100,
            pageSize: 20,
          );
        },
      ),
    ));
    await tester.pumpAndSettle();
    expect(find.text('الثروة'), findsOneWidget);
    expect(find.text('الجاذبية'), findsOneWidget);
    expect(find.text('الألعاب'), findsNothing);
    expect(find.textContaining('المتبقي'), findsNothing);
    expect(find.byKey(const Key('public-support-top3')), findsOneWidget);
    final third = tester.getTopLeft(find.byKey(const Key('public-support-rank-3')));
    final first = tester.getTopLeft(find.byKey(const Key('public-support-rank-1')));
    final second = tester.getTopLeft(find.byKey(const Key('public-support-rank-2')));
    expect(third.dx, lessThan(first.dx));
    expect(first.dx, lessThan(second.dx));
    expect(find.text('مستخدم 4'), findsOneWidget);
    await tester.tap(find.byKey(const Key('public-support-more-wealth')));
    await tester.pumpAndSettle();
    expect(find.text('مستخدم 5'), findsOneWidget);
    expect(requests, contains('visited-account:wealth:next-page'));
    await tester.tap(find.text('الجاذبية'));
    await tester.pumpAndSettle();
    expect(find.text('لا توجد بيانات دعم حتى الآن'), findsOneWidget);
    expect(requests, contains('visited-account:attraction:first'));
  });

  testWidgets('hidden level is not exposed and has no retry that bypasses it',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: PublicUserSupportScreen(
        userId: 'hidden-person',
        loadPage: ({required uid, required metric, cursor}) async {
          throw StateError('level_hidden');
        },
      ),
    ));
    await tester.pumpAndSettle();
    expect(find.text('تفاصيل هذا المستوى مخفية.'), findsOneWidget);
    expect(find.byKey(const Key('public-support-top3')), findsNothing);
    expect(find.text('إعادة المحاولة'), findsNothing);
  });

  test('public and quick entry points do not open private progress for visitors',
      () {
    final public = File(
      'lib/features/profile/screens/public_profile_screen.dart',
    ).readAsStringSync();
    final quick = File(
      'lib/features/profile/widgets/quick_profile_sheet.dart',
    ).readAsStringSync();
    final screen = File(
      'lib/features/profile/screens/public_user_support_screen.dart',
    ).readAsStringSync();
    for (final entry in [public, quick]) {
      expect(entry, contains('PublicUserSupportScreen('));
      expect(entry, contains('_isSelf'));
    }
    expect(screen, contains('loadSupportPage('));
    expect(screen, isNot(contains('loadForUser(')));
    expect(screen, isNot(contains('updateVisibility(')));
    expect(screen, isNot(contains('summary.remaining')));
    expect(screen, isNot(contains('Timer.periodic')));
  });
}
