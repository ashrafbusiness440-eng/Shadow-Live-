import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/admin/control_backend_status.dart';
import 'package:voice_chat_room/admin/control_health.dart';
import 'package:voice_chat_room/admin/control_runtime_gate.dart';
void main(){
 test('read-only can work while privileged writes remain closed',(){
  const b=ControlBackendStatus(reachable:true,environment:'staging',version:'1',financialWritesEnabled:false,roleMutationsEnabled:false);
  const h=ControlHealth(api:true,firestore:true,auth:true,audit:true,ledger:true);
  final g=ControlRuntimeGate(backend:b,health:h); expect(g.readOnlyReady,isTrue);expect(g.privilegedReady,isFalse);
 });
 test('production privileged requires all health checks',(){
  const b=ControlBackendStatus(reachable:true,environment:'production',version:'1',financialWritesEnabled:true,roleMutationsEnabled:true);
  const h=ControlHealth(api:true,firestore:true,auth:true,audit:true,ledger:true);
  expect(ControlRuntimeGate(backend:b,health:h).privilegedReady,isTrue);
 });
}
