import 'control_capabilities.dart';
abstract final class ControlReauthPolicy {
 static const sensitiveCapabilities={
  ControlCapabilities.manageEconomy,
  ControlCapabilities.manageRoles,
  ControlCapabilities.manageWithdrawals,
  ControlCapabilities.manageSettlements,
  ControlCapabilities.emergencyLock,
 };
 static bool requiresReauth(String capability)=>sensitiveCapabilities.contains(capability);
 static const Duration maxSensitiveSessionAge=Duration(minutes:10);
}
