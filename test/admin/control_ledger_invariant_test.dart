import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/admin/control_financial_event.dart';
import 'package:voice_chat_room/admin/control_money.dart';
import 'package:voice_chat_room/admin/control_ledger_invariant.dart';
void main(){
 test('diamonds use minor units',(){expect(MoneyPolicy.diamondsToMinorUnits(142.75),14275);expect(MoneyPolicy.diamondsFromMinorUnits(14275),142.75);});
 test('coins cannot contain fractions',(){expect(()=>MoneyPolicy.coins(10.5),throwsArgumentError);expect(MoneyPolicy.coins(10000),10000);});
 test('ledger reconciles balance',(){expect(LedgerInvariant.balancesMatch(opening:100,deltas:[50,-20],closing:130),isTrue);expect(()=>LedgerInvariant.requireBalanced(opening:100,deltas:[50],closing:140),throwsStateError);});
 test('financial event validates idempotency',(){const e=FinancialEvent(type:'recharge',userId:'u',asset:'coins',amount:11000,sourceId:'purchase',idempotencyKey:'key');expect(e.validate,returnsNormally);});
}
