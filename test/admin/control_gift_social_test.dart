import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/admin/control_gift_policy.dart';
import 'package:voice_chat_room/admin/control_room_box.dart';
import 'package:voice_chat_room/admin/control_social.dart';
import 'package:voice_chat_room/admin/control_profile_visit.dart';
void main(){
 test('gift total and banner',(){expect(GiftPolicy.totalCost(unitCoins:1000,quantity:77),77000);expect(GiftPolicy.globalBanner(50000),isTrue);});
 test('room box thresholds',(){expect(RoomBoxPolicy.levelForCumulative(99999),0);expect(RoomBoxPolicy.levelForCumulative(100000),1);expect(RoomBoxPolicy.levelForCumulative(5000000),4);});
 test('mutual follow is friendship',(){expect(SocialPolicy.areFriends(aFollowsB:true,bFollowsA:true),isTrue);});
 test('one-way DM is limited to three unanswered',(){expect(SocialPolicy.canSend(senderFollowsRecipient:true,mutual:false,unansweredCount:2),isTrue);expect(SocialPolicy.canSend(senderFollowsRecipient:true,mutual:false,unansweredCount:3),isFalse);});
 test('VIP5 profile visit is hidden',(){expect(ProfileVisitPolicy.recordVisibleVisit(visitorVipLevel:5),isFalse);});
}
