import 'control_access.dart';
class ControlDenied implements Exception { const ControlDenied(this.message); final String message; @override String toString()=>message; }
class ControlGuard {
 const ControlGuard(this.access); final ControlAccess access;
 void require(String capability){if(!access.can(capability))throw const ControlDenied('ليس لديك صلاحية لتنفيذ هذا الإجراء');}
 void protectOwnerTarget({required String targetRole}){if(targetRole=='owner'&&!access.isOwner)throw const ControlDenied('حساب المالك محمي');}
 void requireOwner(){if(!access.isOwner)throw const ControlDenied('هذا الإجراء للمالك فقط');}
}
