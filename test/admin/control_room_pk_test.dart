import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/admin/control_room_policy.dart';
import 'package:voice_chat_room/admin/control_pk_policy.dart';
void main(){
 test('ordinary room capacities',(){expect(RoomPolicy.seats(level:1,agency:false),8);expect(RoomPolicy.seats(level:6,agency:false),20);expect(RoomPolicy.moderators(level:6,agency:false),12);});
 test('agency room capacities',(){expect(RoomPolicy.seats(level:1,agency:true),10);expect(RoomPolicy.seats(level:6,agency:true),22);expect(RoomPolicy.moderators(level:6,agency:true),14);});
 test('PK scoring and first gift',(){expect(PkPolicy.score(coins:100,firstGift:false),1000);expect(PkPolicy.score(coins:100,firstGift:true),1050);});
}
