abstract final class SensitiveActionPolicy {
 static const actions={'changeRole','changeCapabilities','adjustBalance','approveWithdrawal','paySettlement','changeEconomyConfig','toggleEmergencyLock','restoreBackup'};
 static bool requiresReason(String action)=>actions.contains(action);
 static bool requiresAudit(String action)=>actions.contains(action);
 static bool requiresReauth(String action)=>actions.contains(action);
}
