import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/admin/control_access.dart';
import 'package:voice_chat_room/admin/control_guard.dart';
void main(){
 test('owner can every capability',(){const a=ControlAccess(uid:'o',role:'owner',capabilities:{});expect(a.can('anything'),isTrue);});
 test('admin requires explicit capability',(){const a=ControlAccess(uid:'a',role:'admin',capabilities:{'viewUsers'});expect(a.can('viewUsers'),isTrue);expect(a.can('manageEconomy'),isFalse);});
 test('disabled admin cannot use capabilities',(){const a=ControlAccess(uid:'a',role:'admin',capabilities:{'viewUsers'},enabled:false);expect(a.can('viewUsers'),isFalse);});
 test('non owner cannot target owner',(){const a=ControlAccess(uid:'a',role:'super_admin',capabilities:{'manageUsers'});expect(()=>ControlGuard(a).protectOwnerTarget(targetRole:'owner'),throwsA(isA<ControlDenied>()));});
}
