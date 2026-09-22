import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/admin/control_action_catalog.dart';
import 'package:voice_chat_room/admin/control_idempotency.dart';
import 'package:voice_chat_room/admin/control_money.dart';

void main(){
 test('diamonds convert to exact minor units',(){
  expect(MoneyPolicy.diamondsToMinorUnits(1.25),125);
  expect(MoneyPolicy.diamondsFromMinorUnits(125),1.25);
 });
 test('coins reject fractions and negative values',(){
  expect(MoneyPolicy.coins(10),10);
  expect(()=>MoneyPolicy.coins(1.5),throwsArgumentError);
  expect(()=>MoneyPolicy.coins(-1),throwsArgumentError);
 });
 test('changeCapabilities is a sensitive known action',(){
  final action=ControlActionCatalog.get('changeCapabilities');
  expect(action.sensitive,isTrue);
 });
 test('idempotency key is stable and safe',(){
  final a=ControlIdempotency.key(actorUid:'owner',action:'changeRole',targetId:'u1',clientRequestId:'request-1');
  final b=ControlIdempotency.key(actorUid:'owner',action:'changeRole',targetId:'u1',clientRequestId:'request-1');
  expect(a,b);
  expect(a.length,64);
  expect(RegExp(r'^[a-f0-9]{64}$').hasMatch(a),isTrue);
  expect(()=>ControlIdempotency.key(actorUid:'owner',action:'changeRole',targetId:'u1',clientRequestId:'  '),throwsArgumentError);
 });
}
