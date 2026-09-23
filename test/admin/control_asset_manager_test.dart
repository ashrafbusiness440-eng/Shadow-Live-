import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/admin/control_asset_policy.dart';

void main() {
  test('asset paths are allowlisted', () {
    expect(ControlAssetPolicy.directoryAllowed('assets/images/vip/'), isTrue);
    expect(ControlAssetPolicy.directoryAllowed('assets/images/../../lib'), isFalse);
    expect(ControlAssetPolicy.directoryAllowed('lib'), isFalse);
  });

  test('asset file names are safe and image-only', () {
    expect(ControlAssetPolicy.fileNameAllowed('vip_3.webp'), isTrue);
    expect(ControlAssetPolicy.fileNameAllowed('badge.png'), isTrue);
    expect(ControlAssetPolicy.fileNameAllowed('../main.dart'), isFalse);
    expect(ControlAssetPolicy.fileNameAllowed('payload.js'), isFalse);
  });

  test('asset keys use stable registry format', () {
    expect(ControlAssetPolicy.assetKeyAllowed('vip.badge.3'), isTrue);
    expect(ControlAssetPolicy.assetKeyAllowed('badge.support_team'), isTrue);
    expect(ControlAssetPolicy.assetKeyAllowed('VIP Badge'), isFalse);
  });
}
