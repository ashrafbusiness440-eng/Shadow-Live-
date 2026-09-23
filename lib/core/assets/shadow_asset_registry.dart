import 'dart:convert';
import 'package:http/http.dart' as http;

abstract final class ShadowAssetRegistry {
  static const apiBase = String.fromEnvironment('SHADOW_ASSET_API_BASE');
  static const fallbackApiBase = 'https://shadow-live-git-feature-shadow-control-foundation-shadow-c916.vercel.app';
  static final Map<String, Future<Uri?>> _cache = <String, Future<Uri?>>{};

  static Uri _endpoint(String key) {
    final base = Uri.parse(apiBase.trim().isEmpty ? fallbackApiBase : apiBase);
    return base.resolve('/api/app-assets?key=${Uri.encodeQueryComponent(key)}');
  }

  static Future<Uri?> remoteUrl(String key, {http.Client? client, bool refresh = false}) {
    if (refresh) _cache.remove(key);
    if (client != null) return _loadRemoteUrl(key, client: client);
    return _cache.putIfAbsent(key, () => _loadRemoteUrl(key));
  }

  static Future<Uri?> _loadRemoteUrl(String key, {http.Client? client}) async {
    final ownClient = client == null;
    final c = client ?? http.Client();
    try {
      final response = await c.get(_endpoint(key));
      if (response.statusCode != 200) return null;
      final decoded = jsonDecode(response.body);
      if (decoded is! Map<String, dynamic>) return null;
      final asset = decoded['asset'];
      if (asset is! Map) return null;
      final raw = '${asset['rawUrl'] ?? ''}'.trim();
      return raw.isEmpty ? null : Uri.tryParse(raw);
    } finally {
      if (ownClient) c.close();
    }
  }
}

abstract final class ShadowAssetKeys {
  static const verifiedBadge = 'badge.verified';
  static const officialBadge = 'badge.official';
  static const supportTeamBadge = 'badge.support_team';
  static const ownerBadge = 'role.owner';
  static const adminBadge = 'role.admin';
  static const moderatorBadge = 'role.moderator';
  static String vipBadge(int level) => 'vip.badge.$level';
  static String vipFrame(int level) => 'vip.frame.$level';
  static String levelBadge(int level) => 'level.badge.$level';
}
