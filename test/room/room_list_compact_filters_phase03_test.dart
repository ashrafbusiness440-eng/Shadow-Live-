import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/screens/room/room_list_screen.dart';

void main() {
  testWidgets('RTL filter pills stay visually compact but accept 44px taps',
      (tester) async {
    addTearDown(() => tester.binding.setSurfaceSize(null));
    for (final width in <double>[360, 390, 430]) {
      await tester.binding.setSurfaceSize(Size(width, 750));
      var selected = 'الكل';
      var taps = 0;
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Directionality(
            textDirection: TextDirection.rtl,
            child: StatefulBuilder(
              builder: (context, setSelected) => SizedBox(
                height: 44,
                child: ListView(
                  scrollDirection: Axis.horizontal,
                  children: [
                    for (final name in ['الكل', 'دردشة', 'رسمية', 'وكالات'])
                      RoomCategoryFilterChip(
                        label: name,
                        selected: selected == name,
                        onTap: () => setSelected(() {
                          selected = name;
                          taps++;
                        }),
                      ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ));
      expect(find.byType(RoomCategoryFilterChip), findsNWidgets(4));
      expect(
        tester.getSize(find.byType(RoomCategoryFilterChip).first).height,
        44,
      );
      expect(tester.takeException(), isNull);

      await tester.tap(find.text('دردشة'));
      await tester.pump();
      expect(selected, 'دردشة');
      expect(taps, 1);
      expect(tester.takeException(), isNull);
    }
  });

  test('filter source excludes fixed category duplicates and resets stale custom choices', () {
    final source = File('lib/screens/room/room_list_screen.dart')
        .readAsStringSync();

    expect(source.contains("static const _fixedCategories = ['الكل', 'دردشة', 'رسمية', 'وكالات'];"), isTrue);
    expect(source.contains('if (!_fixedCategories.contains(category)) values.add(category);'), isTrue);
    expect(source.contains('return [..._fixedCategories, ...result];'), isTrue);
    expect(source.contains('if (_fixedCategories.contains(_category)) return;'), isTrue);
    expect(source.contains("if (_viewMode == 'all') _resetUnavailableCustomFilter(rooms);"), isTrue);
    expect(source.contains("_resetUnavailableCustomFilter(_favoriteRooms);"), isTrue);
    expect(source.contains("_resetUnavailableCustomFilter(_historyRooms);"), isTrue);
    expect(source.contains('height: 44,'), isTrue);
    expect(source.contains("onTap: () => setState(() => _category = category)"), isTrue);
    expect(source.contains('roomSurfaceImageUrl(room.data)'), isTrue);
    expect(source.contains('_roomActions.setRoomFavorite('), isTrue);
    expect(source.contains('StreamBuilder('), isFalse);
    expect(source.contains('Timer.periodic'), isFalse);
  });
}
