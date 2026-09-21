import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/admin/control_permissions_matrix.dart';
import 'package:voice_chat_room/admin/control_capabilities.dart';
import 'package:voice_chat_room/admin/control_financial_reservation.dart';
void main(){
 test('non-owner rank does not automatically grant sensitive capabilities',(){
  final x=ControlPermissionsMatrix.effective(role:'super_admin',explicit:{ControlCapabilities.viewUsers});
  expect(x.contains(ControlCapabilities.manageEconomy),isFalse);
  expect(x.contains(ControlCapabilities.viewUsers),isTrue);
 });
 test('owner has protected full capability set',(){
  final x=ControlPermissionsMatrix.effective(role:'owner',explicit:{});
  expect(x.contains(ControlCapabilities.manageRoles),isTrue);
  expect(x.contains(ControlCapabilities.emergencyLock),isTrue);
  expect(x.contains(ControlCapabilities.manageIds),isTrue);
 });
 test('manageIds is explicit for non-owner admins',(){
  final x=ControlPermissionsMatrix.effective(role:'admin',explicit:{ControlCapabilities.manageIds});
  expect(x.contains(ControlCapabilities.manageIds),isTrue);
  expect(x.contains(ControlCapabilities.manageEconomy),isFalse);
 });
 test('withdrawal reservation locks funds',(){
  const r=FinancialReservation(available:150,reserved:0);
  final locked=r.reserve(100); expect(locked.available,50); expect(locked.reserved,100); expect(locked.total,150);
  final paid=locked.settle(100); expect(paid.available,50); expect(paid.reserved,0); expect(paid.total,50);
 });
}
