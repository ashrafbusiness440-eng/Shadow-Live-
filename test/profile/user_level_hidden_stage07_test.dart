import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('Stage 07 Hidden Level stays backend-authoritative and bounded', () {
    final service =
        File('lib/features/profile/services/user_level_service.dart')
            .readAsStringSync();
    final screen =
        File('lib/features/profile/screens/user_level_screen.dart')
            .readAsStringSync();
    final publicProfile =
        File('lib/features/profile/screens/public_profile_screen.dart')
            .readAsStringSync();
    final quickProfile =
        File('lib/features/profile/widgets/quick_profile_sheet.dart')
            .readAsStringSync();
    final access =
        File('lib/admin/user_access_control_card.dart').readAsStringSync();

    expect(service, contains("'action': 'updateVisibility'"));
    expect(service, contains("'hideWealthLevel'"));
    expect(service, contains("'hideAttractionLevel'"));
    expect(service, contains("'hideGameLevel'"));
    expect(screen, contains("Key('level-visibility-\$metric')"));
    expect(screen, contains("metric: 'wealth'"));
    expect(screen, contains("metric: 'attraction'"));
    expect(screen, contains("metric: 'games'"));
    expect(screen, contains('مستوى مخفي'));
    expect(access, contains('viewHiddenUserLevels'));

    for (final forbidden in <String>[
      'FirebaseFirestore',
      '.collection(',
      '.snapshots()',
      'Timer.periodic',
      'StreamBuilder',
    ]) {
      expect(service.contains(forbidden), isFalse,
          reason: 'visibility service must stay backend-only: $forbidden');
      expect(screen.contains(forbidden), isFalse,
          reason: 'visibility UI must not add direct Firestore/polling: $forbidden');
    }

    expect(publicProfile, contains('_levelService.loadForUser(widget.userId)'));
    expect(quickProfile, contains('_levelService.loadForUser(widget.userId)'));
  });
}
