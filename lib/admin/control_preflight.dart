import 'control_access.dart';
import 'control_emergency_lock.dart';
import 'control_reauth_policy.dart';
class ControlPreflight {
 const ControlPreflight({required this.access,required this.lock,required this.reauthenticatedAt,required this.now});
 final ControlAccess access; final EmergencyLockState lock; final DateTime? reauthenticatedAt; final DateTime now;
 void check({required String capability,required bool financialOrSensitive}){
  if(!access.can(capability))throw StateError('capability denied');
  if(financialOrSensitive&&lock.blocksSensitiveWrites)throw StateError('emergency lock enabled');
  if(ControlReauthPolicy.requiresReauth(capability)){
   final at=reauthenticatedAt;
   if(at==null||now.difference(at)>ControlReauthPolicy.maxSensitiveSessionAge)throw StateError('recent re-authentication required');
  }
 }
}
