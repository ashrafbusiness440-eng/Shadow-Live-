import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/admin/control_vip.dart';
import 'package:voice_chat_room/admin/control_special_id.dart';
void main(){
 test('vip privacy thresholds',(){expect(VipEntitlementPolicy.hideWealth(2),isTrue);expect(VipEntitlementPolicy.hideUserLevel(2),isFalse);expect(VipEntitlementPolicy.hideCurrentRoom(4),isTrue);expect(VipEntitlementPolicy.silentRoomEntry(5),isTrue);});
 test('special id eligibility',(){expect(SpecialIdPolicy.eligibleByVip(2),isFalse);expect(SpecialIdPolicy.eligibleByVip(3),isTrue);expect(SpecialIdPolicy.valid('SHADOW_7'),isTrue);expect(SpecialIdPolicy.valid('x'),isFalse);});
}
