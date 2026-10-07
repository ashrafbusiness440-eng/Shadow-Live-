import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';

class ProfileVisualIdentity {
  const ProfileVisualIdentity({
    required this.uid,
    required this.profileImageUrl,
    required this.profileAvatarAsset,
    required this.activeProfileFrameAssetKey,
    required this.activeProfileFrameImageUrl,
    required this.activeProfileFrameExpiresAtMs,
    required this.activeProfileFramePermanent,
  });

  final String uid;
  final String profileImageUrl;
  final String profileAvatarAsset;
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
      profileImageUrl:
          (data['profileImageUrl'] ?? '').toString().trim(),
      profileAvatarAsset:
          (data['profileAvatarAsset'] ?? '').toString().trim(),
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
        'profileImageUrl': profileImageUrl,
        'profileAvatarAsset': profileAvatarAsset,
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

  final FirebaseFirestore _firestore = FirebaseFirestore.instance;
  final Map<String, _CachedVisualIdentity> _cache = {};
  final Map<String, Completer<ProfileVisualIdentity>> _pending = {};
  Timer? _flushTimer;

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
    _cache[normalized] = _CachedVisualIdentity(
      value: ProfileVisualIdentity.fromMap(normalized, data),
      loadedAt: DateTime.now(),
    );
  }

  void invalidate(String uid) {
    final normalized = uid.trim();
    if (normalized.isEmpty) return;
    _cache.remove(normalized);
  }

  void clear() {
    _cache.clear();
  }

  Future<void> _flushPending() async {
    _flushTimer = null;
    final ids = _pending.keys.toList(growable: false);
    if (ids.isEmpty) return;

    for (var offset = 0; offset < ids.length; offset += _batchSize) {
      final batch = ids.skip(offset).take(_batchSize).toList(growable: false);
      try {
        final snapshot = await _firestore
            .collection('public_profiles')
            .where(FieldPath.documentId, whereIn: batch)
            .get();

        final found = <String, ProfileVisualIdentity>{};
        for (final doc in snapshot.docs) {
          final value = ProfileVisualIdentity.fromMap(doc.id, doc.data());
          found[doc.id] = value;
          _cache[doc.id] = _CachedVisualIdentity(
            value: value,
            loadedAt: DateTime.now(),
          );
        }

        for (final uid in batch) {
          final value = found[uid] ?? ProfileVisualIdentity.empty(uid);
          _cache[uid] = _CachedVisualIdentity(
            value: value,
            loadedAt: DateTime.now(),
          );
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
