import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

class HostAgencyIdentity {
  const HostAgencyIdentity({
    required this.agencyId,
    required this.publicId,
    required this.name,
    required this.country,
    required this.status,
    required this.logoUrl,
    required this.roomId,
  });

  final String agencyId;
  final String publicId;
  final String name;
  final String? country;
  final String status;
  final String? logoUrl;
  final String? roomId;

  factory HostAgencyIdentity.fromJson(Map<String, dynamic> json) {
    return HostAgencyIdentity(
      agencyId: (json['agencyId'] ?? '').toString().trim(),
      publicId: (json['publicId'] ?? json['agencyId'] ?? '').toString().trim(),
      name: (json['name'] ?? 'Shadow Live Agency').toString().trim(),
      country: _nullableString(json['country']),
      status: (json['status'] ?? 'active').toString().trim(),
      logoUrl: _nullableString(json['logoUrl']),
      roomId: _nullableString(json['roomId']),
    );
  }
}

class HostAgencyOwner {
  const HostAgencyOwner({
    required this.uid,
    required this.publicId,
    required this.displayName,
    required this.profileImageUrl,
  });

  final String uid;
  final String? publicId;
  final String displayName;
  final String? profileImageUrl;

  factory HostAgencyOwner.fromJson(Map<String, dynamic> json) {
    return HostAgencyOwner(
      uid: (json['uid'] ?? '').toString().trim(),
      publicId: _nullableString(json['publicId']),
      displayName: (json['displayName'] ?? 'Shadow Live').toString().trim(),
      profileImageUrl: _nullableString(json['profileImageUrl']),
    );
  }
}

class HostAgencyLevel {
  const HostAgencyLevel({
    required this.id,
    required this.tierId,
    required this.rank,
    required this.thresholdCoins,
    required this.salaryDiamonds,
    required this.openEnded,
  });

  final String id;
  final String tierId;
  final String rank;
  final int thresholdCoins;
  final int salaryDiamonds;
  final bool openEnded;

  factory HostAgencyLevel.fromJson(Map<String, dynamic> json) {
    return HostAgencyLevel(
      id: (json['id'] ?? '').toString().trim(),
      tierId: (json['tierId'] ?? '').toString().trim(),
      rank: (json['rank'] ?? '').toString().trim(),
      thresholdCoins: _nonNegativeInt(json['thresholdCoins']),
      salaryDiamonds: _nonNegativeInt(json['salaryDiamonds']),
      openEnded: json['openEnded'] == true,
    );
  }
}

class HostAgencyTarget {
  const HostAgencyTarget({
    required this.month,
    required this.progressCoins,
    required this.paidDiamonds,
    required this.remainingCoins,
    required this.targetCoins,
    required this.currentLevel,
    required this.nextLevel,
  });

  final String month;
  final int progressCoins;
  final int paidDiamonds;
  final int remainingCoins;
  final int targetCoins;
  final HostAgencyLevel? currentLevel;
  final HostAgencyLevel? nextLevel;

  factory HostAgencyTarget.fromJson(Map<String, dynamic> json) {
    return HostAgencyTarget(
      month: (json['month'] ?? '').toString().trim(),
      progressCoins: _nonNegativeInt(json['progressCoins']),
      paidDiamonds: _nonNegativeInt(json['paidDiamonds']),
      remainingCoins: _nonNegativeInt(json['remainingCoins']),
      targetCoins: _nonNegativeInt(json['targetCoins']),
      currentLevel: _level(json['currentLevel']),
      nextLevel: _level(json['nextLevel']),
    );
  }
}

class HostAgencyActivity {
  const HostAgencyActivity({
    required this.month,
    required this.qualifiedDays,
    required this.micSecondsMonth,
    required this.requiredQualifiedDays,
    required this.requiredMinutesPerDay,
  });

  final String month;
  final int qualifiedDays;
  final int micSecondsMonth;
  final int requiredQualifiedDays;
  final int requiredMinutesPerDay;

  factory HostAgencyActivity.fromJson(Map<String, dynamic> json) {
    return HostAgencyActivity(
      month: (json['month'] ?? '').toString().trim(),
      qualifiedDays: _nonNegativeInt(json['qualifiedDays']),
      micSecondsMonth: _nonNegativeInt(json['micSecondsMonth']),
      requiredQualifiedDays: _nonNegativeInt(json['requiredQualifiedDays']),
      requiredMinutesPerDay: _nonNegativeInt(json['requiredMinutesPerDay']),
    );
  }
}

class HostMyAgencyCoreData {
  const HostMyAgencyCoreData({
    required this.agency,
    required this.owner,
    required this.membershipRole,
    required this.membershipStatus,
    required this.target,
    required this.activity,
  });

  final HostAgencyIdentity agency;
  final HostAgencyOwner owner;
  final String membershipRole;
  final String membershipStatus;
  final HostAgencyTarget target;
  final HostAgencyActivity activity;

  factory HostMyAgencyCoreData.fromJson(Map<String, dynamic> json) {
    final agency = json['agency'];
    final owner = json['owner'];
    final membership = json['membership'];
    final target = json['target'];
    final activity = json['activity'];
    if (agency is! Map ||
        owner is! Map ||
        membership is! Map ||
        target is! Map ||
        activity is! Map) {
      throw const FormatException('invalid_host_my_agency_core');
    }

    return HostMyAgencyCoreData(
      agency: HostAgencyIdentity.fromJson(Map<String, dynamic>.from(agency)),
      owner: HostAgencyOwner.fromJson(Map<String, dynamic>.from(owner)),
      membershipRole: (membership['role'] ?? '').toString().trim(),
      membershipStatus: (membership['status'] ?? '').toString().trim(),
      target: HostAgencyTarget.fromJson(Map<String, dynamic>.from(target)),
      activity:
          HostAgencyActivity.fromJson(Map<String, dynamic>.from(activity)),
    );
  }
}

class HostMyAgencyService {
  HostMyAgencyService({
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

  Future<HostMyAgencyCoreData> loadCore() async {
    final token = await _idToken();
    final response = await _client.post(
      Uri.parse('$_baseUrl/agency-host'),
      headers: {
        'authorization': 'Bearer $token',
        'content-type': 'application/json',
      },
      body: jsonEncode(const {'action': 'core'}),
    );

    Map<String, dynamic> body = const <String, dynamic>{};
    try {
      final decoded = jsonDecode(response.body);
      if (decoded is Map) body = Map<String, dynamic>.from(decoded);
    } catch (_) {}

    if (response.statusCode != 200 || body['ok'] != true) {
      throw StateError(
        (body['code'] ?? 'host_my_agency_load_failed').toString(),
      );
    }
    return HostMyAgencyCoreData.fromJson(body);
  }

  void close() {
    if (_ownsClient) _client.close();
  }
}

HostAgencyLevel? _level(dynamic value) {
  if (value is! Map) return null;
  return HostAgencyLevel.fromJson(Map<String, dynamic>.from(value));
}

String? _nullableString(dynamic value) {
  final normalized = (value ?? '').toString().trim();
  return normalized.isEmpty ? null : normalized;
}

int _nonNegativeInt(dynamic value) {
  final number = value is num ? value.toInt() : int.tryParse('$value') ?? 0;
  return number < 0 ? 0 : number;
}
