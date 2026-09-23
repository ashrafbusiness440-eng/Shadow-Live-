class ControlSessionPolicy {
 static const Duration idleTimeout=Duration(minutes:30);
 static const Duration sensitiveReauthWindow=Duration(minutes:10);
 static bool active({required DateTime lastActivity,required DateTime now})=>now.difference(lastActivity)<idleTimeout;
 static bool sensitiveAuthFresh({required DateTime reauthenticatedAt,required DateTime now})=>now.difference(reauthenticatedAt)<=sensitiveReauthWindow;
}
