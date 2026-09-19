abstract final class AuditPolicy {
 static const immutable=true;
 static const requiredSensitiveFields={'actorUid','action','targetType','targetId','reason','before','after','createdAt'};
 static bool ordinaryAdminMayEdit=>false;
 static bool ordinaryAdminMayDelete=>false;
}
