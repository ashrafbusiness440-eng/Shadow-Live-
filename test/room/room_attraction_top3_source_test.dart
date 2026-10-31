import 'dart:io';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final app = File('lib/main.dart').readAsStringSync();
  final source = File('lib/features/room/services/room_insights_service.dart')
      .readAsStringSync();
  final start = app.indexOf('Future<void> _showSupportersSheet()');
  final end = app.indexOf('Future<void> _showRoomRankingSheet()', start);
  final sheet = app.substring(start, end);

  test('ranking switches between donor and receiver records without fake users', () {
    expect(sheet, contains("Text('داعمو الغرفة')"));
    expect(sheet, contains("Text('الجاذبية')"));
    expect(sheet, contains('setTabState(() => attractionTab = true)'));
    expect(sheet, contains('attractionTab ? attraction : supporters'));
    expect(sheet, contains('rankingsLoadFailed'));
    expect(sheet, contains('لا توجد هدايا مستقبلة اليوم'));
    expect(sheet, contains('includeAttraction: true,'));
  });

  test('room insights uses a separate opt-in real receiver list and cache key', () {
    expect(source, contains('final List<RoomSupporter> attraction;'));
    expect(source, contains("final rawAttraction = json['attraction'];"));
    expect(source, contains("'includeAttraction': includeAttraction,"));
    expect(source, contains(r'attraction=$includeAttraction'));
    expect(source, contains('rawAttraction is List'));
    expect(source, isNot(contains('Timer.periodic')));
  });
}
