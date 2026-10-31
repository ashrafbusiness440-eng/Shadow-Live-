import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  final app = File('lib/main.dart').readAsStringSync();
  final begin = app.indexOf('Widget _buildVoiceSeats()');
  final end = app.indexOf('Future<void> _showSupportersSheet()', begin);
  final seats = app.substring(begin, end);

  test('mic seats retain alpha in PNG and animated WebP avatars', () {
    expect(begin, greaterThan(0));
    expect(end, greaterThan(begin));
    // A null decoration color means no forced opaque backdrop under the
    // network image, even when some image pixels are fully transparent.
    expect(seats, contains('color: seat.profileImageUrl.isNotEmpty'));
    expect(seats, contains('? null'));
    expect(seats, contains('image: seat.profileImageUrl.isEmpty'));
    expect(seats, contains('DecorationImage('));
    expect(seats, contains('fit: BoxFit.cover'));
    expect(seats, isNot(contains('color: const Color(0xFF151B29)')));
  });

  test('empty seats remain identifiable without a solid dark disc', () {
    expect(seats, contains('const Color(0x10FFFFFF)'));
    expect(seats, contains('const Color(0x33FFFFFF)'));
    expect(seats, contains('const Color(0x18FFFFFF)'));
    expect(seats, contains('seat.locked'));
    expect(seats, contains('seat.muteLocked'));
    expect(seats, contains('seat.occupied'));
  });

  test('mic actions and cosmetics preserve their existing render paths', () {
    expect(seats, contains('onTap: _changingSeat ? null'));
    expect(seats, contains('seat.mysteriousMode'));
    expect(seats, contains('if (seat.frameActive && !seat.mysteriousMode)'));
    expect(seats, contains('CosmeticAssetVisual('));
    expect(seats, contains('if (seat.voiceWaveActive && !seat.mysteriousMode)'));
    expect(seats, contains('if (seat.occupied)'));
    expect(seats, contains('state?.starBattleActive == true'));
    expect(seats, contains('count <= 8 ? 4'));
    expect(seats, contains('count <= 20 ? 5 : 6'));
  });
}
