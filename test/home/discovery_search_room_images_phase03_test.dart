import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/home/screens/discovery_search_screen.dart';
import 'package:voice_chat_room/features/room/services/room_image_source.dart';

void main() {
  testWidgets('search room thumbnail stays compact and safe in RTL layouts',
      (tester) async {
    addTearDown(() => tester.binding.setSurfaceSize(null));
    for (final width in <double>[360, 390, 430]) {
      await tester.binding.setSurfaceSize(Size(width, 740));
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: Directionality(
              textDirection: TextDirection.rtl,
              child: Row(
                children: [
                  DiscoverySearchRoomImage(
                    room: {
                      'name': 'غرفة صوتية',
                      'roomType': 'personal',
                    },
                  ),
                  Expanded(child: Text('نتيجة الغرفة')),
                ],
              ),
            ),
          ),
        ),
      );
      expect(find.byType(DiscoverySearchRoomImage), findsOneWidget);
      expect(find.byIcon(Icons.mic_rounded), findsOneWidget);
      expect(tester.getSize(find.byType(DiscoverySearchRoomImage)).width, 46);
      expect(tester.takeException(), isNull);
    }
  });

  test('search result image uses the same canonical exterior field priority', () {
    expect(
      roomSurfaceImageUrl({
        'roomType': 'personal',
        'roomImageUrl': 'https://example.invalid/exterior.webp',
        'backgroundImageUrl': 'https://example.invalid/background.webp',
      }),
      'https://example.invalid/exterior.webp',
    );
    expect(
      roomSurfaceImageUrl({
        'roomType': 'agency',
        'agencyRoomImageUrl': 'https://example.invalid/agency.webp',
        'roomImageUrl': 'https://example.invalid/general.webp',
      }),
      'https://example.invalid/agency.webp',
    );
    final search = File('lib/features/home/screens/discovery_search_screen.dart')
        .readAsStringSync();
    expect(search.contains('roomSurfaceImageUrl(room)'), isTrue);
    expect(search.contains('leading: DiscoverySearchRoomImage(room: room)'), isTrue);
    expect(search.contains('CachedNetworkImage('), isTrue);
    expect(search.contains('StreamBuilder('), isFalse);
    expect(search.contains('roomSurfaceImageUrl(room['), isFalse);
  });
}
