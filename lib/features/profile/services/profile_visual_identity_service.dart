import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';

class ProfileVisualIdentity {
  const ProfileVisualIdentity({
    required this.uid,
    this.displayName = '',
    required this.profileImageUrl,
    required this.profileAvatarAsset,
    required this.profileAvatarAnimationUrl,
    this.effectiveVipLevel,
    this.vipExpiresAt,
    this.hasVipExpiresAt = false,
    required this.activeProfileFrameAssetKey,
    required this.activeProfileFrameImageUrl,
    required this.activeProfileFrameExpiresAtMs,
    required this.activeProfileFramePermanent,
  });

  final String uid;
  final String displayName;
  final String profileImageUrl;
  final String profileAvatarAsset;
  final String profileAvatarAnimationUrl;
  // Carry the existing public VIP state alongside animation metadata.
  // The viewer checks both the level and expiry; an image URL alone never
  // grants animation entitlement.
  final int? effectiveVipLevel;
  final Object? vipExpiresAt;
  final bool hasVipExpiresAt;
  final String activeProfileFrameAssetKey;
  final String activeProfileFrameImageUrl;
  final int activeProfileFrameExpiresAtMs;
  final bool activeProfileFramePermanent;

  factory ProfileVisualIdentity.fromMap(
    String uid,
    Map<String, dynamic> data,
  ) {
    return ProfileVisualIdentity(
      uid: uid,
      displayName: (data['displayName'] ?? data['username'] ?? '').toString().trim(),
      profileImageUrl:
          (data['profileImageUrl'] ?? '').toString().trim(),
      profileAvatarAsset:
          (data['profileAvatarAsset'] ?? '').toString().trim(),
      profileAvatarAnimationUrl:
          (data['profileAvatarAnimationUrl'] ?? '').toString().trim(),
      effectiveVipLevel: data.containsKey('effectiveVipLevel')
          ? (data['effectiveVipLevel'] is num
              ? (data['effectiveVipLevel'] as num).toInt()
              : int.tryParse((data['effectiveVipLevel'] ?? '').toString()))
          : null,
      vipExpiresAt: data['vipExpiresAt'],
      hasVipExpiresAt: data.containsKey('vipExpiresAt'),
      activeProfileFrameAssetKey:
          (data['activeProfileFrameAssetKey'] ?? '').toString().trim(),
      activeProfileFrameImageUrl:
          (data['activeProfileFrameImageUrl'] ?? '').toString().trim(),
      activeProfileFrameExpiresAtMs:
          (data['activeProfileFrameExpiresAtMs'] as num?)?.toInt() ??
              int.tryParse(
                (data['activeProfileFrameExpiresAtMs'] ?? '0').toString(),
              ) ??
              0,
      activeProfileFramePermanent:
          data['activeProfileFramePermanent'] == true,
    );
  }

  factory ProfileVisualIdentity.empty(String uid) =>
      ProfileVisualIdentity.fromMap(uid, const <String, dynamic>{});

  Map<String, dynamic> toProfileMap() => <String, dynamic>{
        if (displayName.isNotEmpty) 'displayName': displayName,
        'profileImageUrl': profileImageUrl,
        'profileAvatarAsset': profileAvatarAsset,
        'profileAvatarAnimationUrl': profileAvatarAnimationUrl,
        if (effectiveVipLevel != null) 'effectiveVipLevel': effectiveVipLevel,
        if (hasVipExpiresAt) 'vipExpiresAt': vipExpiresAt,
        'activeProfileFrameAssetKey': activeProfileFrameAssetKey,
        'activeProfileFrameImageUrl': activeProfileFrameImageUrl,
        'activeProfileFrameExpiresAtMs': activeProfileFrameExpiresAtMs,
        'activeProfileFramePermanent': activeProfileFramePermanent,
      };
}

class ProfileVisualIdentityService {
  ProfileVisualIdentityService._();

  static final ProfileVisualIdentityService instance =
      ProfileVisualIdentityService._();

  static const Duration _ttl = Duration(seconds: 45);
  static const int _batchSize = 10;
  static const int _maxPendingPerFlush = 40;
  static const int _maxCacheEntries = 160;

  FirebaseFirestore get _firestore => FirebaseFirestore.instance;
  final Map<String, _CachedVisualIdentity> _cache = {};
  final Map<String, Completer<ProfileVisualIdentity>> _pending = {};
  final StreamController<String> _invalidations =
      StreamController<String>.broadcast();
  Timer? _flushTimer;

  Stream<String> get invalidations => _invalidations.stream;

  Future<ProfileVisualIdentity> load(String uid) {
    final normalized = uid.trim();
    if (normalized.isEmpty) {
      return Future.value(ProfileVisualIdentity.empty(''));
    }

    final cached = _cache[normalized];
    if (cached != null &&
        DateTime.now().difference(cached.loadedAt) < _ttl) {
      return Future.value(cached.value);
    }

    final existing = _pending[normalized];
    if (existing != null) return existing.future;

    final completer = Completer<ProfileVisualIdentity>();
    _pending[normalized] = completer;
    _flushTimer ??= Timer(
      const Duration(milliseconds: 8),
      _flushPending,
    );
    return completer.future;
  }

  void prime(String uid, Map<String, dynamic> data) {
    final normalized = uid.trim();
    if (normalized.isEmpty) return;
    final candidate = ProfileVisualIdentity.fromMap(normalized, data);
    // A room snapshot may have no picture at all. Never let such a partial
    // snapshot hide an actual avatar already loaded from public_profiles.
    final hasAvatar = candidate.profileImageUrl.isNotEmpty ||
        candidate.profileAvatarAsset.isNotEmpty ||
        candidate.profileAvatarAnimationUrl.isNotEmpty;
    if (!hasAvatar) return;
    final cached = _cache[normalized];
    if (cached != null &&
        DateTime.now().difference(cached.loadedAt) < _ttl &&
        (cached.value.profileImageUrl.isNotEmpty ||
            cached.value.profileAvatarAsset.isNotEmpty ||
            cached.value.profileAvatarAnimationUrl.isNotEmpty)) {
      return;
    }
    // A populated, privacy-filtered visual snapshot may repair a cached
    // empty public profile. It must never replace a populated cache entry.
    _putCache(normalized, candidate);
  }

  void _putCache(String uid, ProfileVisualIdentity value) {
    _cache.remove(uid);
    _cache[uid] = _CachedVisualIdentity(
      value: value,
      loadedAt: DateTime.now(),
    );
    while (_cache.length > _maxCacheEntries) {
      _cache.remove(_cache.keys.first);
    }
  }

  void invalidate(String uid) {
    final normalized = uid.trim();
    if (normalized.isEmpty) return;
    _cache.remove(normalized);
    _invalidations.add(normalized);
  }

  void clear() {
    _cache.clear();
  }

  Future<void> _flushPending() async {
    _flushTimer = null;
    final ids = _pending.keys
        .take(_maxPendingPerFlush)
        .toList(growable: false);
    if (ids.isEmpty) return;

    for (var offset = 0; offset < ids.length; offset += _batchSize) {
      final batch = ids.skip(offset).take(_batchSize).toList(growable: false);
      try {
        final firestore = FirebaseFirestore.instance;
        final snapshot = await firestore
            .collection('public_profiles')
            .where(FieldPath.documentId, whereIn: batch)
            .get();

        final found = <String, ProfileVisualIdentity>{};
        for (final doc in snapshot.docs) {
          final value = ProfileVisualIdentity.fromMap(doc.id, doc.data());
          found[doc.id] = value;
          _putCache(doc.id, value);
        }

        for (final uid in batch) {
          final value = found[uid] ?? ProfileVisualIdentity.empty(uid);
          _putCache(uid, value);
          final completer = _pending.remove(uid);
          if (completer != null && !completer.isCompleted) {
            completer.complete(value);
          }
        }
      } catch (error, stackTrace) {
        for (final uid in batch) {
          final stale = _cache[uid]?.value;
          final completer = _pending.remove(uid);
          if (completer == null || completer.isCompleted) continue;
          if (stale != null) {
            completer.complete(stale);
          } else {
            completer.completeError(error, stackTrace);
          }
        }
      }
    }

    if (_pending.isNotEmpty) {
      _flushTimer ??= Timer(
        const Duration(milliseconds: 8),
        _flushPending,
      );
    }
  }
}

class _CachedVisualIdentity {
  const _CachedVisualIdentity({
    required this.value,
    required this.loadedAt,
  });

  final ProfileVisualIdentity value;
  final DateTime loadedAt;
}
