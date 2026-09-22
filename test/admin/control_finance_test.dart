import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/admin/control_finance.dart';
void main(){
 test('agency normal gift split',(){final x=ControlFinance.normalGiftSplit(coins:10000,agency:true);expect(x['recipientDiamonds'],0.70);expect(x['agencyDiamonds'],0.20);expect(x['platformUsd'],0.10);});
 test('non agency normal gift split',(){final x=ControlFinance.normalGiftSplit(coins:10000,agency:false);expect(x['recipientDiamonds'],0.75);expect(x['platformUsd'],0.25);});
 test('self gift splits',(){expect(ControlFinance.selfGiftSplit(coins:10000,agency:true)['recipientDiamonds'],0.65);expect(ControlFinance.selfGiftSplit(coins:10000,agency:false)['recipientDiamonds'],0.70);});
 test('diamond converts at full reference rate',(){expect(ControlFinance.coinsForDiamonds(2.5),25000);});
}
