import 'dart:io';
import 'package:flutter_test/flutter_test.dart';

void main() {
  const bridge =
      'assets/packages/zego_express_engine/assets/ZegoExpressWebFlutterWrapper.js';

  test('production and local Flutter Web load the ZEGO bridge before bootstrap', () {
    for (final path in ['scripts/app_index.html', 'web/index.html']) {
      final html = File(path).readAsStringSync();
      expect(bridge.allMatches(html).length, 1, reason: path);
      expect(html.indexOf(bridge), lessThan(html.indexOf('flutter_bootstrap.js')),
          reason: path);
      expect(html, isNot(contains('unpkg.com/')));
      expect(html, isNot(contains('cdn.jsdelivr.net/')));
    }
  });

  test('production deployment refuses missing or misplaced local ZEGO JS', () {
    final workflow = File(
      '.github/workflows/deploy-shadow-control-pages.yml',
    ).readAsStringSync();
    expect(workflow, contains('test -s site/live/$bridge'));
    expect(workflow, contains('html.index(bridge) < html.index'));
    expect(workflow, contains('flutter build web --release'));
  });

  test('ZEGO failures do not surface raw extendedData to the UI', () {
    final sdk = File(
      'lib/features/voice/services/zego_voice_service.dart',
    ).readAsStringSync();
    expect(sdk, contains('zegoSafeExtendedSubcode(extendedData)'));
    expect(sdk, contains('zegoSafeExtendedSubcode(result.extendedData)'));
    expect(sdk, isNot(contains('extendedData.toString()')));
    expect(sdk, isNot(contains('jsonEncode(extendedData)')));
  });
}
