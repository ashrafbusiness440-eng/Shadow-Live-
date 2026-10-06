import 'dart:convert';
import 'package:http/http.dart' as http;

abstract final class ShadowAssetRegistry {
  static const apiBase = String.fromEnvironment('SHADOW_ASSET_API_BASE');
  static const fallbackApiBase = 'https://shadow-live.ashraf-business-440.workers.dev';
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
  static const authLoginHeader = 'auth.login.header';
  static const verifiedBadge = 'badge.verified';
  static const officialBadge = 'badge.official';
  static const supportTeamBadge = 'badge.support_team';
  static const ownerBadge = 'role.owner';
  static const adminBadge = 'role.admin';
  static const moderatorBadge = 'role.moderator';
  // Legacy VIP keys remain for already-published surfaces.
  static String vipBadge(int level) => 'vip.badge.$level';
  static String vipFrame(int level) => 'vip.frame.$level';

  // Official VIP1→VIP10 Asset Studio keys. Entitlement unlock is separate
  // from the selected level skin so designs can be replaced without rewriting
  // VIP business logic or Flutter surfaces.
  static String vipMainBadge(int level) => 'vip.v$level.mainBadge';
  static String vipLevelBadge(int level) => 'vip.v$level.badge';
  static String vipChatBubble(int level) => 'vip.v$level.chatBubble';
  static String vipProfileFrame(int level) => 'vip.v$level.profileFrame';
  static String vipProfileBackground(int level) => 'vip.v$level.profileBackground';
  static String vipAudioWave(int level) => 'vip.v$level.audioWave';
  static String vipEntryStrip(int level) => 'vip.v$level.entryStrip';
  static String vipDataCard(int level) => 'vip.v$level.dataCard';
  static String vipGiftVisual(int level) => 'vip.v$level.giftVisual';
  static String vipProfileDecoration(int level) => 'vip.v$level.profileDecoration';
  static String vipNameEffect(int level) => 'vip.v$level.nameEffect';
  static String vipGlobalEntryBanner(int level) => 'vip.v$level.globalEntryBanner';

  static String? levelMainBadge(String metric, int level) {
    final bucket = _levelBucket(metric, level);
    if (bucket == null) return null;
    return 'levels.$metric.$bucket.mainBadge';
  }

  static String? levelMiniBadge(String metric, int level) {
    final bucket = _levelBucket(metric, level);
    if (bucket == null) return null;
    final suffix = metric == 'wealth' ? 'wealthBadge' : 'miniBadge';
    return 'levels.$metric.$bucket.$suffix';
  }

  static String? _levelBucket(String metric, int level) {
    if (level <= 0) return null;
    if (metric == 'wealth' || metric == 'attraction') {
      if (level > 35) return null;
      final start = ((level - 1) ~/ 5) * 5 + 1;
      final end = start + 4;
      return 'lv${start.toString().padLeft(2, '0')}_${end.toString().padLeft(2, '0')}';
    }
    if (metric == 'game') {
      if (level > 21) return null;
      final start = ((level - 1) ~/ 3) * 3 + 1;
      final end = start + 2;
      return 'lv${start.toString().padLeft(2, '0')}_${end.toString().padLeft(2, '0')}';
    }
    return null;
  }
}
