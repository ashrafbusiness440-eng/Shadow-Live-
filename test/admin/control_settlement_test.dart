import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/admin/control_settlement.dart';
void main(){
 test('attendance payout ladder',(){
  expect(AgencySettlementPolicy.payoutPercent(9),100);
  expect(AgencySettlementPolicy.payoutPercent(8),90);
  expect(AgencySettlementPolicy.payoutPercent(7),80);
  expect(AgencySettlementPolicy.payoutPercent(6),70);
  expect(AgencySettlementPolicy.payoutPercent(5),55);
  expect(AgencySettlementPolicy.payoutPercent(4),40);
  expect(AgencySettlementPolicy.payoutPercent(3),25);
  expect(AgencySettlementPolicy.payoutPercent(2),0);
 });
 test('payable applies attendance percent',(){expect(AgencySettlementPolicy.payable(100,7),80);});
}
