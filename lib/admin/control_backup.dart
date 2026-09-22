abstract final class BackupPolicy {
 static const protectedDomains={'users','financial_ledger','admin_audit_logs','agencies','agency_settlements','system_config'};
 static bool restoreRequiresOwner=true;
 static bool shouldAuditRestore=true;
}
