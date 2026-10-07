import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

class PublicAgencyIdentity {
  const PublicAgencyIdentity({
    required this.agencyId,
    required this.publicId,
    required this.name,
    required this.country,
    required this.memberCount,
    required this.hostCount,
    required this.logoUrl,
    required this.coverUrl,
    required this.description,
    required this.publicContact,
    required this.topValue,
    required this.rank,
  });

  final String agencyId;
  final String publicId;
  final String name;
  final String? country;
  final int memberCount;
  final int hostCount;
  final String? logoUrl;
  final String? coverUrl;
  final String? description;
  final String? publicContact;
  final int topValue;
  final int? rank;

  factory PublicAgencyIdentity.fromJson(Map<String, dynamic> json) {
    return PublicAgencyIdentity(
      agencyId: (json['agencyId'] ?? '').toString().trim(),
      publicId: (json['publicId'] ?? json['agencyId'] ?? '').toString().trim(),
      name: (json['name'] ?? 'Shadow Live Agency').toString().trim(),
      country: _nullableString(json['country']),
      memberCount: _nonNegativeInt(json['memberCount']),
      hostCount: _nonNegativeInt(json['hostCount']),
      logoUrl: _nullableString(json['logoUrl']),
      coverUrl: _nullableString(json['coverUrl']),
      description: _nullableString(json['description']),
      publicContact: _nullableString(json['publicContact']),
      topValue: _nonNegativeInt(json['topValue']),
      rank: _positiveIntOrNull(json['rank']),
    );
  }
}

class PublicAgencyPerson {
  const PublicAgencyPerson({
    required this.uid,
    required this.publicId,
    required this.displayName,
    required this.profileImageUrl,
    this.profileAvatarAsset,
    this.activeProfileFrameAssetKey,
    this.activeProfileFrameImageUrl,
    this.activeProfileFrameExpiresAtMs = 0,
    this.activeProfileFramePermanent = false,
  });

  final String uid;
  final String? publicId;
  final String displayName;
  final String? profileImageUrl;
  final String? profileAvatarAsset;
  final String? activeProfileFrameAssetKey;
  final String? activeProfileFrameImageUrl;
  final int activeProfileFrameExpiresAtMs;
  final bool activeProfileFramePermanent;

  factory PublicAgencyPerson.fromJson(Map<String, dynamic> json) {
    return PublicAgencyPerson(
      uid: (json['uid'] ?? '').toString().trim(),
      publicId: _nullableString(json['publicId']),
      displayName: (json['displayName'] ?? 'Shadow Live').toString().trim(),
      profileImageUrl: _nullableString(json['profileImageUrl']),
      profileAvatarAsset: _nullableString(json['profileAvatarAsset']),
      activeProfileFrameAssetKey:
          _nullableString(json['activeProfileFrameAssetKey']),
      activeProfileFrameImageUrl:
          _nullableString(json['activeProfileFrameImageUrl']),
      activeProfileFrameExpiresAtMs:
          _nonNegativeInt(json['activeProfileFrameExpiresAtMs']),
      activeProfileFramePermanent:
          json['activeProfileFramePermanent'] == true,
    );
  }
}

class PublicAgencyRankingEntry {
  const PublicAgencyRankingEntry({
    required this.rank,
    required this.supportCoins,
    required this.person,
  });

  final int rank;
  final int supportCoins;
  final PublicAgencyPerson person;

  factory PublicAgencyRankingEntry.fromJson(Map<String, dynamic> json) {
    return PublicAgencyRankingEntry(
      rank: _nonNegativeInt(json['rank']),
      supportCoins: _nonNegativeInt(json['supportCoins']),
      person: PublicAgencyPerson.fromJson(json),
    );
  }
}

class PublicAgencyRankingData {
  const PublicAgencyRankingData({
    required this.month,
    required this.currentMonth,
    required this.top10,
  });

  final String month;
  final String currentMonth;
  final List<PublicAgencyRankingEntry> top10;

  factory PublicAgencyRankingData.fromJson(Map<String, dynamic> json) {
    final raw = json['top10'];
    return PublicAgencyRankingData(
      month: (json['month'] ?? '').toString().trim(),
      currentMonth: (json['currentMonth'] ?? '').toString().trim(),
      top10: raw is List
          ? raw
              .whereType<Map>()
              .map(
                (entry) => PublicAgencyRankingEntry.fromJson(
                  Map<String, dynamic>.from(entry),
                ),
              )
              .where(
                (entry) =>
                    entry.rank > 0 &&
                    entry.rank <= 10 &&
                    entry.person.uid.isNotEmpty,
              )
              .toList(growable: false)
          : const <PublicAgencyRankingEntry>[],
    );
  }
}

class PublicAgencyArchiveData {
  const PublicAgencyArchiveData({
    required this.currentMonth,
    required this.months,
    required this.maxMonths,
  });

  final String currentMonth;
  final List<String> months;
  final int maxMonths;

  factory PublicAgencyArchiveData.fromJson(Map<String, dynamic> json) {
    final raw = json['months'];
    return PublicAgencyArchiveData(
      currentMonth: (json['currentMonth'] ?? '').toString().trim(),
      months: raw is List
          ? raw
              .map((item) => item.toString().trim())
              .where((item) => item.isNotEmpty)
              .toList(growable: false)
          : const <String>[],
      maxMonths: _nonNegativeInt(json['maxMonths']),
    );
  }
}

class PublicAgencyPageData {
  const PublicAgencyPageData({
    required this.agency,
    required this.owner,
    required this.hosts,
    required this.limit,
    required this.hasMore,
    required this.nextCursor,
  });

  final PublicAgencyIdentity agency;
  final PublicAgencyPerson owner;
  final List<PublicAgencyPerson> hosts;
  final int limit;
  final bool hasMore;
  final String? nextCursor;

  factory PublicAgencyPageData.fromJson(Map<String, dynamic> json) {
    final agency = json['agency'];
    final owner = json['owner'];
    final page = json['page'];
    if (agency is! Map || owner is! Map || page is! Map) {
      throw const FormatException('invalid_public_agency_page');
    }
    final rawHosts = json['hosts'];
    return PublicAgencyPageData(
      agency: PublicAgencyIdentity.fromJson(Map<String, dynamic>.from(agency)),
      owner: PublicAgencyPerson.fromJson(Map<String, dynamic>.from(owner)),
      hosts: rawHosts is List
          ? rawHosts
              .whereType<Map>()
              .map((entry) => PublicAgencyPerson.fromJson(
                    Map<String, dynamic>.from(entry),
                  ))
              .where((entry) => entry.uid.isNotEmpty)
              .toList(growable: false)
          : const <PublicAgencyPerson>[],
      limit: _nonNegativeInt(page['limit']),
      hasMore: page['hasMore'] == true,
      nextCursor: _nullableString(page['nextCursor']),
    );
  }
}

class PublicAgencySearchData {
  const PublicAgencySearchData({
    required this.results,
    required this.limit,
    required this.hasMore,
    required this.nextCursor,
    required this.truncated,
  });

  final List<PublicAgencyIdentity> results;
  final int limit;
  final bool hasMore;
  final String? nextCursor;
  final bool truncated;

  factory PublicAgencySearchData.fromJson(Map<String, dynamic> json) {
    final rawResults = json['results'];
    final page = json['page'];
    if (page is! Map) throw const FormatException('invalid_agency_search');
    return PublicAgencySearchData(
      results: rawResults is List
          ? rawResults
              .whereType<Map>()
              .map((row) => PublicAgencyIdentity.fromJson(
                    Map<String, dynamic>.from(row),
                  ))
              .where((row) => row.agencyId.isNotEmpty)
              .toList(growable: false)
          : const <PublicAgencyIdentity>[],
      limit: _nonNegativeInt(page['limit']),
      hasMore: page['hasMore'] == true,
      nextCursor: _nullableString(page['nextCursor']),
      truncated: page['truncated'] == true,
    );
  }
}

class PublicAgencyService {
  PublicAgencyService({
    http.Client? client,
    FirebaseAuth? auth,
    String? baseUrl,
  })  : _client = client ?? http.Client(),
        _ownsClient = client == null,
        _auth = auth ?? FirebaseAuth.instance,
        _baseUrl = baseUrl ??
            const String.fromEnvironment(
              'SHADOW_CLOUDFLARE_API_BASE_URL',
              defaultValue:
                  'https://shadow-live.ashraf-business-440.workers.dev/api',
            );

  final http.Client _client;
  final bool _ownsClient;
  final FirebaseAuth _auth;
  final String _baseUrl;

  Future<String> _idToken() async {
    final token = await _auth.currentUser?.getIdToken();
    if (token == null || token.isEmpty) throw StateError('not_signed_in');
    return token;
  }

  Future<Map<String, dynamic>> _post(
    Map<String, dynamic> payload,
  ) async {
    final token = await _idToken();
    final response = await _client.post(
      Uri.parse('$_baseUrl/agency-public'),
      headers: {
        'authorization': 'Bearer $token',
        'content-type': 'application/json',
      },
      body: jsonEncode(payload),
    );

    Map<String, dynamic> body = const <String, dynamic>{};
    try {
      final decoded = jsonDecode(response.body);
      if (decoded is Map) body = Map<String, dynamic>.from(decoded);
    } catch (_) {}

    if (response.statusCode != 200 || body['ok'] != true) {
      throw StateError(
        (body['code'] ?? 'public_agency_load_failed').toString(),
      );
    }
    return body;
  }

  Future<PublicAgencyPageData> load({
    required String agencyId,
    String? cursor,
    int limit = 12,
  }) async {
    final body = await _post({
      'action': 'page',
      'agencyId': agencyId.trim(),
      'limit': limit.clamp(1, 12),
      if (cursor != null && cursor.trim().isNotEmpty)
        'cursor': cursor.trim(),
    });
    return PublicAgencyPageData.fromJson(body);
  }

  Future<PublicAgencySearchData> browse({
    String? cursor,
    int limit = 20,
  }) async {
    final body = await _post({
      'action': 'browse',
      'limit': limit.clamp(1, 20),
      if (cursor != null && cursor.trim().isNotEmpty)
        'cursor': cursor.trim(),
    });
    return PublicAgencySearchData.fromJson(body);
  }

  Future<PublicAgencySearchData> search({
    required String query,
    required String mode,
    String? cursor,
    int limit = 20,
  }) async {
    final body = await _post({
      'action': 'search',
      'query': query.trim(),
      'mode': mode,
      'limit': limit.clamp(1, 20),
      if (cursor != null && cursor.trim().isNotEmpty)
        'cursor': cursor.trim(),
    });
    return PublicAgencySearchData.fromJson(body);
  }

  Future<PublicAgencyRankingData> loadRanking({
    required String agencyId,
    String? month,
  }) async {
    final body = await _post({
      'action': 'ranking',
      'agencyId': agencyId.trim(),
      if (month != null && month.trim().isNotEmpty)
        'month': month.trim(),
    });
    return PublicAgencyRankingData.fromJson(body);
  }

  Future<PublicAgencyArchiveData> loadArchive({
    required String agencyId,
  }) async {
    final body = await _post({
      'action': 'archive',
      'agencyId': agencyId.trim(),
    });
    return PublicAgencyArchiveData.fromJson(body);
  }

  void close() {
    if (_ownsClient) _client.close();
  }
}

String? _nullableString(dynamic value) {
  final normalized = (value ?? '').toString().trim();
  return normalized.isEmpty ? null : normalized;
}

int _nonNegativeInt(dynamic value) {
  final number = value is num ? value.toInt() : int.tryParse('$value') ?? 0;
  return number < 0 ? 0 : number;
}


int? _positiveIntOrNull(dynamic value) {
  final parsed = value is num ? value.toInt() : int.tryParse('$value');
  return parsed != null && parsed > 0 ? parsed : null;
}
