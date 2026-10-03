import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/admin/control_asset_policy.dart';
import 'package:voice_chat_room/admin/control_asset_studio_template.dart';

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

  test('asset studio cosmetic directories are allowlisted', () {
    for (final path in const [
      'assets/images/chat_bubbles',
      'assets/images/entrances',
      'assets/images/audio_waves',
      'assets/images/name_effects',
      'assets/images/mic_effects',
      'assets/images/stickers',
      'assets/images/cards',
      'assets/images/events',
      'assets/images/agencies',
      'assets/images/system',
    ]) {
      expect(ControlAssetPolicy.directoryAllowed(path), isTrue, reason: path);
    }
  });

  test('asset studio template parses backend catalog without inventing dimensions', () {
    final template = ControlAssetStudioTemplate.fromMap({
      'id': 'badge.base.v1',
      'type': 'badge',
      'version': 1,
      'labelAr': 'شارة',
      'directories': ['assets/images/badges', 'assets/images/vip'],
      'extensions': ['webp', 'png'],
      'maxBytes': 2500000,
      'width': null,
      'height': null,
      'dimensionsStatus': 'tbd',
      'transparency': 'required',
      'motion': 'static',
      'prompt': 'prompt',
      'noteAr': 'لم يتم تثبيت الأبعاد بعد',
    });

    expect(template.id, 'badge.base.v1');
    expect(template.allowsDirectory('assets/images/vip/'), isTrue);
    expect(template.allowsExtension('WEBP'), isTrue);
    expect(template.dimensionsLabel, 'غير مثبتة بعد');
    expect(template.dimensionsMatch(999, 123), isTrue);
  });

  test('asset keys use stable registry format', () {
    expect(ControlAssetPolicy.assetKeyAllowed('vip.badge.3'), isTrue);
    expect(ControlAssetPolicy.assetKeyAllowed('badge.support_team'), isTrue);
    expect(ControlAssetPolicy.assetKeyAllowed('VIP Badge'), isFalse);
  });
}
