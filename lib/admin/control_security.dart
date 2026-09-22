abstract final class ControlSecurityPolicy {
 static const ownerRequires2fa=true;
 static const sensitiveAdminRequires2fa=true;
 static const sensitiveSessionMinutes=10;
 static bool requiresDeviceAlert({required bool knownDevice})=>!knownDevice;
 static bool recentReauth(DateTime authenticatedAt,DateTime now)=>now.difference(authenticatedAt).inMinutes<=sensitiveSessionMinutes;
}
