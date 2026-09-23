abstract final class AuditPolicy {
 static const immutable=true;
 static const requiredSensitiveFields={'actorUid','action','targetType','targetId','reason','before','after','createdAt'};
 static bool get ordinaryAdminMayEdit=>false;
 static bool get ordinaryAdminMayDelete=>false;
}
