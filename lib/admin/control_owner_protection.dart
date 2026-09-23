import 'control_access.dart';
abstract final class OwnerProtection {
 static void validateTarget({required ControlAccess actor,required String targetRole,required String action}){
  if(targetRole!='owner')return;
  if(!actor.isOwner)throw StateError('Owner is protected from lower roles');
  if({'demote','disableAdmin','revokeCapabilities','ban','deleteAccount'}.contains(action)) {
   throw StateError('Owner protection cannot be removed');
  }
 }
}
