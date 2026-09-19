import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/admin/control_session.dart';
import 'package:voice_chat_room/admin/control_campaign.dart';
import 'package:voice_chat_room/admin/control_custom_background.dart';
void main(){
 test('control session expires after idle timeout',(){final now=DateTime(2026,9,19,22);expect(ControlSessionPolicy.active(lastActivity:now.subtract(const Duration(minutes:29)),now:now),isTrue);expect(ControlSessionPolicy.active(lastActivity:now.subtract(const Duration(minutes:30)),now:now),isFalse);});
 test('campaign validates audience',(){expect(()=>CampaignPolicy.validate(audience:'vip',title:'حدث',body:'ابدأ الآن'),returnsNormally);expect(()=>CampaignPolicy.validate(audience:'unknown',title:'x',body:'y'),throwsArgumentError);});
 test('rejected custom background refunds',(){expect(CustomBackgroundPolicy.refundOnRejection,isTrue);expect(()=>CustomBackgroundPolicy.validateDuration(7),returnsNormally);});
}
