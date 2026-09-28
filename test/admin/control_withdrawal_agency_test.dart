import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/admin/control_withdrawal.dart';
import 'package:voice_chat_room/admin/control_agency.dart';
void main(){
 test('withdrawal state machine',(){expect(WithdrawalPolicy.canTransition('pending','under_review'),isTrue);expect(WithdrawalPolicy.canTransition('pending','paid'),isFalse);expect(WithdrawalPolicy.canTransition('approved','paid'),isTrue);});
 test('withdrawal validation',(){expect(()=>WithdrawalPolicy.validateRequest(available:150,amount:100,minimum:100),returnsNormally);expect(()=>WithdrawalPolicy.validateRequest(available:90,amount:100,minimum:100),throwsArgumentError);});
 test('agency monthly cycle and qualified day',(){expect(AgencyPolicy.cycleForDay(1),'monthly');expect(AgencyPolicy.cycleForDay(31),'monthly');expect(AgencyPolicy.qualifiesDay(const Duration(hours:2)),isTrue);});
}
