import 'dart:io';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final app = File('lib/main.dart').readAsStringSync();

  test('top supporters stay left before insights hydrate in RTL', () {
    final a = app.indexOf('Widget _buildRoomInsightsBar()');
    final b = app.indexOf('Widget _buildRoomBottomBar()', a);
    final roomBar = app.substring(a, b);
    final unknown = roomBar.substring(
      roomBar.indexOf('if (insights == null)'),
      roomBar.indexOf('Widget levelBox()'),
    );
    expect(unknown, contains('const Spacer()'));
    expect(unknown.indexOf('const Spacer()'),
        lessThan(unknown.indexOf('_buildSupporterCluster()')));
    expect(unknown, contains('if (_showRoomSupport)'));
  });

  test('star battle mic score remains while duplicate star glyph goes', () {
    final a = app.indexOf('Widget _buildVoiceSeats()');
    final b = app.indexOf('Future<void> _showSupportersSheet()', a);
    final seats = app.substring(a, b);
    expect(seats, contains('state?.starBattleActive == true'));
    expect(seats, contains('_formatStarBattleCoins(seat.starBattleCoins)'));
    expect(seats, isNot(contains("+ ' ⭐'")));
    expect(seats, contains('maxLines: 1,'));
  });

  test('ranking and supporters sheets reject rapid duplicate taps', () {
    expect(app, contains('bool _supportersSheetInFlight = false;'));
    expect(app, contains('bool _rankingSheetInFlight = false;'));
    expect(app, contains('if (_supportersSheetInFlight) return;'));
    expect(app, contains('if (_rankingSheetInFlight) return;'));
    expect(app, contains('_supportersSheetInFlight = false;'));
    expect(app, contains('_rankingSheetInFlight = false;'));
  });

  test('room sound and effects use small round controls below icons', () {
    final a = app.indexOf('class _RoomToolToggle extends StatelessWidget');
    final toggle = app.substring(a);
    expect(toggle, contains('width: 48,'));
    expect(toggle, contains('width: 23,'));
    expect(toggle, contains('toggled: value'));
    expect(toggle, contains('onTap: () => onChanged(!value)'));
    expect(toggle, contains('customBorder: const CircleBorder()'));
    expect(toggle, isNot(contains('Transform.scale(')));
    expect(toggle, isNot(contains('Switch(')));
  });
}
