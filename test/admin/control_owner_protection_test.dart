import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/admin/control_access.dart';
import 'package:voice_chat_room/admin/control_owner_protection.dart';
import 'package:voice_chat_room/admin/control_capability_change.dart';
void main(){
 test('lower admin cannot mutate owner',(){const admin=ControlAccess(uid:'a',role:'super_admin',capabilities:{'manageRoles'});expect(()=>OwnerProtection.validateTarget(actor:admin,targetRole:'owner',action:'demote'),throwsStateError);});
 test('owner protection itself cannot be removed',(){const owner=ControlAccess(uid:'o',role:'owner',capabilities:{});expect(()=>OwnerProtection.validateTarget(actor:owner,targetRole:'owner',action:'disableAdmin'),throwsStateError);});
 test('capability change needs reason',(){const c=CapabilityChange(targetUid:'u',capability:'manageRooms',enabled:true,reason:'');expect(c.validate,throwsArgumentError);});
}
