/// SDK-only identity. Shadow Live names remain unchanged in profiles, room
/// presence, gifts and messages; do not forward decorative Unicode to ZEGO.
/// ZEGO room login rejects unsupported username characters (1002009).
String zegoSdkLoginName(String displayName, String authorizedUserId) {
  final allowed = RegExp(r'^[A-Za-z0-9_.-]+$');
  if (authorizedUserId.isEmpty ||
      authorizedUserId.length >= 64 ||
      !allowed.hasMatch(authorizedUserId)) {
    throw const FormatException('invalid_zego_authorized_user_id');
  }

  final name = displayName.trim();
  // ZEGO userName must be nonempty and under 256 UTF-8 bytes. A stricter
  // ASCII subset is intentional so Android and web use the same safe name.
  return name.isNotEmpty && name.length <= 80 && allowed.hasMatch(name)
      ? name
      : authorizedUserId;
}

/// Preserve ZEGO's numeric result for support without leaking identity,
/// credentials, room IDs, exception details or URL query parameters.
String zegoLoginDiagnostic(int errorCode, {bool privateCall = false}) {
  final prefix = privateCall ? 'zego_call_login_' : 'zego_login_';
  if (errorCode == 0) return '${prefix}unknown';
  if (errorCode < 0) return '${prefix}negative_${errorCode.abs()}';
  return '$prefix$errorCode';
}
