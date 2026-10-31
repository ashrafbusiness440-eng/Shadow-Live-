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
/// Only finite, positive numeric subcodes from known ZEGO diagnostic fields
/// are safe to surface. Never copy arbitrary extendedData strings into UI:
/// provider details may contain tokens, room IDs, endpoints or user identity.
int? zegoSafeExtendedSubcode(Map<dynamic, dynamic>? extendedData) {
  if (extendedData == null) return null;
  const keys = <String>[
    'errorCode', 'error_code', 'errCode', 'err_code',
    'innerErrorCode', 'inner_error_code', 'subCode', 'sub_code',
  ];
  for (final key in keys) {
    final value = extendedData[key];
    int? code;
    if (value is int) {
      code = value;
    } else if (value is String &&
        RegExp(r'^[0-9]{1,9}$').hasMatch(value)) {
      code = int.tryParse(value);
    }
    if (code != null && code > 0 && code <= 999999999) {
      return code;
    }
  }
  return null;
}

String zegoLoginDiagnostic(
  int errorCode, {
  bool privateCall = false,
  int? providerSubcode,
}) {
  final prefix = privateCall ? 'zego_call_login_' : 'zego_login_';
  if (errorCode == 0) return '${prefix}unknown';
  if (errorCode < 0) return '${prefix}negative_${errorCode.abs()}';
  final code = '$prefix$errorCode';
  if (providerSubcode != null &&
      providerSubcode > 0 &&
      providerSubcode <= 999999999 &&
      providerSubcode != errorCode) {
    return '${code}_sub_$providerSubcode';
  }
  return code;
}
