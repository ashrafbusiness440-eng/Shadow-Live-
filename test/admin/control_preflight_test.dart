import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/admin/control_access.dart';
import 'package:voice_chat_room/admin/control_capabilities.dart';
import 'package:voice_chat_room/admin/control_emergency_lock.dart';
import 'package:voice_chat_room/admin/control_preflight.dart';
void main(){
 final now=DateTime(2026,9,19,22);
 test('sensitive operation blocked by emergency lock',(){
  const a=ControlAccess(uid:'o',role:'owner',capabilities:{});
  final p=ControlPreflight(access:a,lock:const EmergencyLockState(enabled:true),reauthenticatedAt:now,now:now);
  expect(()=>p.check(capability:ControlCapabilities.manageEconomy,financialOrSensitive:true),throwsStateError);
 });
 test('sensitive operation requires fresh reauth',(){
  const a=ControlAccess(uid:'o',role:'owner',capabilities:{});
  final p=ControlPreflight(access:a,lock:const EmergencyLockState(enabled:false),reauthenticatedAt:now.subtract(const Duration(minutes:11)),now:now);
  expect(()=>p.check(capability:ControlCapabilities.manageEconomy,financialOrSensitive:true),throwsStateError);
 });
 test('fresh owner session passes preflight',(){
  const a=ControlAccess(uid:'o',role:'owner',capabilities:{});
  final p=ControlPreflight(access:a,lock:const EmergencyLockState(enabled:false),reauthenticatedAt:now.subtract(const Duration(minutes:2)),now:now);
  expect(()=>p.check(capability:ControlCapabilities.manageEconomy,financialOrSensitive:true),returnsNormally);
 });
}
