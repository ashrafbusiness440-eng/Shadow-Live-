import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/admin/control_withdrawal.dart';
import 'package:voice_chat_room/admin/control_agency.dart';
void main(){
 test('withdrawal state machine',(){expect(WithdrawalPolicy.canTransition('pending','under_review'),isTrue);expect(WithdrawalPolicy.canTransition('pending','paid'),isFalse);expect(WithdrawalPolicy.canTransition('approved','paid'),isTrue);});
 test('withdrawal validation',(){expect(()=>WithdrawalPolicy.validateRequest(available:150,amount:100,minimum:100),returnsNormally);expect(()=>WithdrawalPolicy.validateRequest(available:90,amount:100,minimum:100),throwsArgumentError);});
 test('agency cycles and qualified day',(){expect(AgencyPolicy.cycleForDay(15),'1-15');expect(AgencyPolicy.cycleForDay(16),'16-end');expect(AgencyPolicy.qualifiesDay(const Duration(hours:2)),isTrue);});
}
