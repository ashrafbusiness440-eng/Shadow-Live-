import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('mysterious badge presence skin and voice icons use shared asset keys', () {
    final registry = File(
      'lib/core/assets/shadow_asset_registry.dart',
    ).readAsStringSync();
    final widgets = File(
      'lib/features/mysterious/widgets/mysterious_identity_widgets.dart',
    ).readAsStringSync();
    final screen = File(
      'lib/features/mysterious/screens/mysterious_person_screen.dart',
    ).readAsStringSync();
    final main = File('lib/main.dart').readAsStringSync();

    expect(widgets.contains('ShadowAssetKeys.mysteriousBadge'), isTrue);
    expect(
      widgets.contains('ShadowAssetKeys.mysteriousRoomPresenceSkin'),
      isTrue,
    );
    expect(screen.contains('mysteriousVoiceOptionIcon(option.id)'), isTrue);
    expect(main.contains('MysteriousRoomPresenceSkin('), isTrue);
    expect(registry.contains("mysterious.entrance"), isTrue);
    expect(widgets.contains('ShadowAssetRegistry.remoteUrl(assetKey)'), isTrue);
    expect(widgets.contains('CachedNetworkImage('), isTrue);
  });
}
