import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/admin/control_balance_policy.dart';
void main(){
 test('balance cannot become negative',(){expect(()=>ControlBalancePolicy.nextBalance(current:10,delta:-11),throwsStateError);});
 test('valid balance adjustment',(){expect(ControlBalancePolicy.nextBalance(current:10,delta:-4),6);});
 test('withdrawal respects minimum and available',(){expect(ControlBalancePolicy.isWithdrawalAllowed(availableDiamonds:150,amount:100,minimum:100),isTrue);expect(ControlBalancePolicy.isWithdrawalAllowed(availableDiamonds:150,amount:99,minimum:100),isFalse);expect(ControlBalancePolicy.isWithdrawalAllowed(availableDiamonds:90,amount:100,minimum:100),isFalse);});
}
