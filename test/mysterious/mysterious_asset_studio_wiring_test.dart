import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('mysterious visuals use the shared cached asset registry', () {
    final registry = File(
      'lib/core/assets/shadow_asset_registry.dart',
    ).readAsStringSync();
    final widget = File(
      'lib/features/mysterious/widgets/mysterious_identity_widgets.dart',
    ).readAsStringSync();
    final policy = File(
      'lib/admin/control_asset_policy.dart',
    ).readAsStringSync();

    expect(registry.contains("mysterious.room_identity"), isTrue);
    expect(registry.contains("mysterious.identity_card"), isTrue);
    expect(registry.contains("mysterious.id_plate"), isTrue);
    expect(registry.contains("mysterious.entrance"), isTrue);
    expect(registry.contains("mysterious.vehicle"), isTrue);
    expect(registry.contains("mysterious.room_presence_skin"), isTrue);
    expect(registry.contains("mysterious.voice_option_icons."), isTrue);

    expect(widget.contains('ShadowAssetRegistry.remoteUrl(assetKey)'), isTrue);
    expect(widget.contains('CachedNetworkImage('), isTrue);
    expect(
      widget.contains('ShadowAssetKeys.mysteriousRoomIdentity'),
      isTrue,
    );
    expect(
      widget.contains('ShadowAssetKeys.mysteriousIdentityCard'),
      isTrue,
    );
    expect(widget.contains('ShadowAssetKeys.mysteriousIdPlate'), isTrue);
    expect(policy.contains("'assets/images/mysterious'"), isTrue);

    expect(widget.contains('http.Client'), isFalse);
    expect(widget.contains('.snapshots()'), isFalse);
    expect(widget.contains('Timer.periodic'), isFalse);
  });
}
