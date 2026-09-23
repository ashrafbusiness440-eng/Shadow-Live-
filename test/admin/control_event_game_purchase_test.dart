import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/admin/control_event.dart';
import 'package:voice_chat_room/admin/control_game_round.dart';
import 'package:voice_chat_room/admin/control_purchase_verification.dart';
void main(){
 test('events require valid window',(){final a=DateTime(2026,9,20);expect(()=>ControlEventPolicy.validate(type:'mission',startsAt:a,endsAt:a.add(const Duration(days:1))),returnsNormally);});
 test('game round state machine',(){expect(GameRoundPolicy.canTransition('open','locked'),isTrue);expect(GameRoundPolicy.canTransition('settled','open'),isFalse);expect(GameRoundPolicy.maySettle('locked'),isTrue);});
 test('purchase must be server verified',(){expect(PurchaseVerification.clientResultIsAuthoritative,isFalse);expect(PurchaseVerification.requiresServerVerification,isTrue);});
}
