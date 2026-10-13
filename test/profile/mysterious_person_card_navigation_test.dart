import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  final profile = File('lib/features/user/screens/profile_screen.dart')
      .readAsStringSync();
  final mysterious =
      File('lib/features/mysterious/screens/mysterious_person_screen.dart')
          .readAsStringSync();

  test('profile keeps three compact header tabs and preserves their content', () {
    expect(profile.contains('TabController(length: 3, vsync: this)'), isTrue);
    for (final tab in const [
      "Tab(text: 'حول')",
      "Tab(text: 'الغرف')",
      "Tab(text: 'الهدايا')",
    ]) {
      expect(profile.contains(tab), isTrue, reason: tab);
    }
    expect(profile.contains("Tab(text: 'الشخص الغامض')"), isFalse);
    expect(profile.contains('const MysteriousPersonScreen(embedded: true)'),
        isFalse);
    expect(profile.contains('_profileTabIndex'), isFalse,
        reason: 'Removing fourth tab also removes its rebuild listener');
    expect(profile.contains('_tabs.addListener('), isFalse);
    expect(profile.contains('_tabs.dispose()'), isTrue);
    expect(profile.contains('ProfilePersonalRoomTab('), isTrue,
        reason: 'Personal room uses existing authoritative service');
    expect(profile.contains('ProfileGiftShowcase(userId: currentUid)'), isTrue,
        reason: 'Own gifts show the existing bounded public showcase');
    expect(profile.contains("'غرف المستخدم'"), isFalse);
    expect(profile.contains("'هدايا المستخدم'"), isFalse);
  });

  test('Mysterious Person opens from the existing bottom action card', () {
    final vip = profile.indexOf("'VIP',");
    expect(profile.substring(vip).contains('_openVip,'), isTrue);
    final entry = profile.indexOf("'الشخص الغامض',");
    final relationships = profile.indexOf("'العلاقات',");
    expect(vip, greaterThan(0));
    expect(entry, greaterThan(vip));
    expect(relationships, greaterThan(entry));
    final action = profile.substring(entry, relationships);
    expect(action.contains('Navigator.of(context).push('), isTrue);
    expect(action.contains('MaterialPageRoute<void>('), isTrue);
    expect(action.contains('const MysteriousPersonScreen()'), isTrue);
    expect(mysterious.contains('this.embedded = false'), isTrue);
    expect(mysterious.contains('appBar: AppBar('), isTrue,
        reason: 'Nonembedded route must retain a normal return control');
    expect(mysterious.contains('MysteriousPersonService()'), isTrue,
        reason: 'Existing subscription and voice logic are preserved');
  });
}
