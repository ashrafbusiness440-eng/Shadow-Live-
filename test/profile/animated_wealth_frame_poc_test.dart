import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/room/widgets/cosmetic_effect_widgets.dart';

void main() {
  test('animated profile frame POC is scoped only to wealth LV26-30', () {
    expect(
      usesAnimatedProfileFramePoc('levels.wealth.lv26_30.profileFrame'),
      isTrue,
    );
    expect(
      usesAnimatedProfileFramePoc('levels.wealth.lv21_25.profileFrame'),
      isFalse,
    );
    expect(
      usesAnimatedProfileFramePoc('levels.wealth.lv31_35.profileFrame'),
      isFalse,
    );
    expect(
      usesAnimatedProfileFramePoc('vip.v8.profileFrame'),
      isFalse,
    );
  });

  test('POC uses bounded native animation performance guardrails', () {
    final source = File(
      'lib/features/room/widgets/cosmetic_effect_widgets.dart',
    ).readAsStringSync();

    expect(source.contains('AnimationController('), isTrue);
    expect(source.contains('Duration(seconds: 4)'), isTrue);
    expect(source.contains('RepaintBoundary('), isTrue);
    expect(source.contains('TickerMode.of(context)'), isTrue);
    expect(source.contains('disableAnimations'), isTrue);
    expect(source.contains('CustomPaint('), isTrue);
    expect(source.contains('Timer.periodic'), isFalse);
    expect(source.contains('canvas.drawArc('), isTrue);
    expect(source.contains('specularCore'), isTrue);
    expect(source.contains('specularHalo'), isTrue);
    expect(source.contains('wingPaint'), isTrue);
    expect(source.contains('RadialGradient('), isTrue);
    expect(source.contains('_burstEnvelope'), isTrue);
    expect(source.contains('for (var i = 0; i < 4; i++)'), isTrue);
    expect(source.contains('sparkleAngles'), isFalse);
  });

  test('equipped permanent level frame is allowed on the profile', () {
    final source =
        File('lib/features/user/screens/profile_screen.dart').readAsStringSync();

    expect(
      source.contains('(item.permanent || item.expiresAtMs > now)'),
      isTrue,
    );
    expect(source.contains('AnimatedProfileFrameVisual('), isTrue);
  });

  test('My Items previews the POC through the native animated wrapper', () {
    final source = File(
      'lib/features/profile/screens/my_items_screen.dart',
    ).readAsStringSync();

    expect(source.contains('usesAnimatedProfileFramePoc(item.assetKey)'), isTrue);
    expect(source.contains('AnimatedProfileFrameVisual('), isTrue);
  });
}
