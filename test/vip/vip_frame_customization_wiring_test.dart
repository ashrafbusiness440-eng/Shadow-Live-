import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('selected VIP frame skin is reused by public profile surfaces', () {
    final widget =
        File('lib/features/vip/widgets/vip_avatar_frame.dart')
            .readAsStringSync();
    final publicProfile =
        File('lib/features/profile/screens/public_profile_screen.dart')
            .readAsStringSync();
    final quickProfile =
        File('lib/features/profile/widgets/quick_profile_sheet.dart')
            .readAsStringSync();
    final vip =
        File('lib/features/vip/screens/vip_screen.dart').readAsStringSync();

    expect(widget.contains('final int? frameLevel;'), isTrue);
    expect(widget.contains('selected <= effectiveVip'), isTrue);

    expect(publicProfile.contains("data['vipProfileFrameLevel']"), isTrue);
    expect(publicProfile.contains('frameLevel: vipFrameLevel'), isTrue);

    expect(quickProfile.contains("data['vipProfileFrameLevel']"), isTrue);
    expect(quickProfile.contains('frameLevel: vipFrameLevel'), isTrue);

    expect(vip.contains("'vip-frame-customization'"), isTrue);
    expect(vip.contains("'vip-frame-choice-\$level'"), isTrue);
    expect(vip.contains('setVipProfileFrame(level)'), isTrue);
    expect(vip.contains('30 يوم'), isTrue);
  });
}
