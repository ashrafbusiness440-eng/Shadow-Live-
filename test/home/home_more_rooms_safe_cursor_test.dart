import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/home/services/discovery_service.dart';

void main(){
  test('paged room results deduplicate and exclude the initial four rooms',(){
    const initial=[DiscoveryRoom(id:'a',data:{'visibility':'public'}),DiscoveryRoom(id:'b',data:{'visibility':'public'})];
    const next=[DiscoveryRoom(id:'b',data:{'visibility':'public'}),DiscoveryRoom(id:'c',data:{'visibility':'public'}),DiscoveryRoom(id:'x',data:{'visibility':'hidden'})];
    final items=mergeHomeRoomPages(initial,next,exclude:{'a'});
    expect(items.map((r)=>r.id).toList(),['b','c']);
  });
  test('pagination remains bounded with cursor and no polling',(){
    final source=File('lib/features/home/services/discovery_service.dart').readAsStringSync();
    final screen=File('lib/features/home/screens/home_more_rooms_screen.dart').readAsStringSync();
    expect(source.contains('limit.clamp(1,24)'),isTrue);
    expect(source.contains('startAfterDocument(after)'),isTrue);
    expect(source.contains('recheckRoomForEntry'),isTrue);
    expect(screen.contains('showDiscoveryRoomPasswordPrompt'),isTrue);
    expect(screen.contains('Timer.periodic'),isFalse);
    expect(screen.contains('user?.uid'),isTrue);
  });
}
