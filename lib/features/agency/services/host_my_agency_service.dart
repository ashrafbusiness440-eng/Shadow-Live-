import 'dart:async';
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
    required this.description,
    required this.publicContact,
    required this.backgroundUrl,
  });

  final String agencyId;
  final String publicId;
  final String name;
  final String? country;
  final String status;
  final String? logoUrl;
  final String? roomId;
  final String? description;
  final String? publicContact;
  final String? backgroundUrl;

  factory HostAgencyIdentity.fromJson(Map<String, dynamic> json) {
    return HostAgencyIdentity(
      agencyId: (json['agencyId'] ?? '').toString().trim(),
      publicId: (json['publicId'] ?? json['agencyId'] ?? '').toString().trim(),
      name: (json['name'] ?? 'Shadow Live Agency').toString().trim(),
      country: _nullableString(json['country']),
      status: (json['status'] ?? 'active').toString().trim(),
      logoUrl: _nullableString(json['logoUrl']),
      roomId: _nullableString(json['roomId']),
      description: _nullableString(json['description']),
      publicContact: _nullableString(json['publicContact']),
      backgroundUrl: _nullableString(json['backgroundUrl']),
    );
  }
}

class HostAgencyOwner {
  const HostAgencyOwner({
    required this.uid,
    required this.publicId,
    required this.displayName,
    required this.profileImageUrl,
    this.profileAvatarAsset,
  });

  final String uid;
  final String? publicId;
  final String displayName;
  final String? profileImageUrl;
  final String? profileAvatarAsset;

  factory HostAgencyOwner.fromJson(Map<String, dynamic> json) {
    return HostAgencyOwner(
      uid: (json['uid'] ?? '').toString().trim(),
      publicId: _nullableString(json['publicId']),
      displayName: (json['displayName'] ?? 'Shadow Live').toString().trim(),
      profileImageUrl: _nullableString(json['profileImageUrl']),
      profileAvatarAsset: _nullableString(json['profileAvatarAsset']),
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
    required this.hostShareBps,
    required this.grossSupportCoins,
    required this.activityBonusAsset,
    required this.activityBonusAmount,
  });

  final String id;
  final String tierId;
  final String rank;
  final int thresholdCoins;
  final int salaryDiamonds;
  final bool openEnded;
  final int hostShareBps;
  final int grossSupportCoins;
  final String activityBonusAsset;
  final int activityBonusAmount;

  factory HostAgencyLevel.fromJson(Map<String, dynamic> json) {
    return HostAgencyLevel(
      id: (json['id'] ?? '').toString().trim(),
      tierId: (json['tierId'] ?? '').toString().trim(),
      rank: (json['rank'] ?? '').toString().trim(),
      thresholdCoins: _nonNegativeInt(json['thresholdCoins']),
      salaryDiamonds: _nonNegativeInt(json['salaryDiamonds']),
      openEnded: json['openEnded'] == true,
      hostShareBps: _nonNegativeInt(json['hostShareBps']),
      grossSupportCoins: _nonNegativeInt(json['grossSupportCoins']),
      activityBonusAsset: json['activityBonus'] is Map
          ? ((json['activityBonus'] as Map)['asset'] ?? 'none').toString().trim()
          : 'none',
      activityBonusAmount: json['activityBonus'] is Map
          ? _nonNegativeInt((json['activityBonus'] as Map)['amount'])
          : 0,
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
    this.levels = const <HostAgencyLevel>[],
  });

  final String month;
  final int progressCoins;
  final int paidDiamonds;
  final int remainingCoins;
  final int targetCoins;
  final HostAgencyLevel? currentLevel;
  final HostAgencyLevel? nextLevel;
  final List<HostAgencyLevel> levels;

  factory HostAgencyTarget.fromJson(Map<String, dynamic> json) {
    return HostAgencyTarget(
      month: (json['month'] ?? '').toString().trim(),
      progressCoins: _nonNegativeInt(json['progressCoins']),
      paidDiamonds: _nonNegativeInt(json['paidDiamonds']),
      remainingCoins: _nonNegativeInt(json['remainingCoins']),
      targetCoins: _nonNegativeInt(json['targetCoins']),
      currentLevel: _level(json['currentLevel']),
      nextLevel: _level(json['nextLevel']),
      levels: json['levels'] is List
          ? (json['levels'] as List)
              .whereType<Map>()
              .map((item) => HostAgencyLevel.fromJson(
                    Map<String, dynamic>.from(item),
                  ))
              .toList(growable: false)
          : const <HostAgencyLevel>[],
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
    required this.bonusMode,
    required this.requiredMicSecondsMonth,
  });

  final String month;
  final int qualifiedDays;
  final int micSecondsMonth;
  final int requiredQualifiedDays;
  final int requiredMinutesPerDay;
  final String bonusMode;
  final int requiredMicSecondsMonth;

  factory HostAgencyActivity.fromJson(Map<String, dynamic> json) {
    return HostAgencyActivity(
      month: (json['month'] ?? '').toString().trim(),
      qualifiedDays: _nonNegativeInt(json['qualifiedDays']),
      micSecondsMonth: _nonNegativeInt(json['micSecondsMonth']),
      requiredQualifiedDays: _nonNegativeInt(json['requiredQualifiedDays']),
      requiredMinutesPerDay: _nonNegativeInt(json['requiredMinutesPerDay']),
      bonusMode: (json['bonusMode'] ?? 'highest_target_month_end').toString().trim(),
      requiredMicSecondsMonth: _nonNegativeInt(json['requiredMicSecondsMonth']),
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
    this.membershipCapabilities = const <String>[],
    this.canReviewMembershipRequests = false,
  });

  final HostAgencyIdentity agency;
  final HostAgencyOwner owner;
  final String membershipRole;
  final String membershipStatus;
  final HostAgencyTarget target;
  final HostAgencyActivity activity;
  final List<String> membershipCapabilities;
  final bool canReviewMembershipRequests;

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

    final rawCapabilities = membership['capabilities'];
    final rawPermissions = membership['permissions'];
    final permissions = rawPermissions is Map
        ? Map<String, dynamic>.from(rawPermissions)
        : const <String, dynamic>{};

    return HostMyAgencyCoreData(
      agency: HostAgencyIdentity.fromJson(Map<String, dynamic>.from(agency)),
      owner: HostAgencyOwner.fromJson(Map<String, dynamic>.from(owner)),
      membershipRole: (membership['role'] ?? '').toString().trim(),
      membershipStatus: (membership['status'] ?? '').toString().trim(),
      target: HostAgencyTarget.fromJson(Map<String, dynamic>.from(target)),
      activity:
          HostAgencyActivity.fromJson(Map<String, dynamic>.from(activity)),
      membershipCapabilities: rawCapabilities is List
          ? rawCapabilities
              .map((value) => value.toString().trim())
              .where((value) => value.isNotEmpty)
              .toList(growable: false)
          : const <String>[],
      canReviewMembershipRequests:
          permissions['canReviewMembershipRequests'] == true,
    );
  }
}


class HostTargetHistoryAchievement {
  const HostTargetHistoryAchievement({
    required this.targetId,
    required this.tierId,
    required this.rank,
    required this.thresholdCoins,
    required this.salaryDeltaDiamonds,
    required this.salaryDiamonds,
    required this.achievedAt,
  });

  final String targetId;
  final String? tierId;
  final String? rank;
  final int thresholdCoins;
  final int salaryDeltaDiamonds;
  final int salaryDiamonds;
  final String? achievedAt;

  factory HostTargetHistoryAchievement.fromJson(Map<String, dynamic> json) {
    return HostTargetHistoryAchievement(
      targetId: (json['targetId'] ?? '').toString().trim(),
      tierId: _nullableString(json['tierId']),
      rank: _nullableString(json['rank']),
      thresholdCoins: _nonNegativeInt(json['thresholdCoins']),
      salaryDeltaDiamonds: _nonNegativeInt(json['salaryDeltaDiamonds']),
      salaryDiamonds: _nonNegativeInt(json['salaryDiamonds']),
      achievedAt: _nullableString(json['achievedAt']),
    );
  }
}

class HostTargetHistoryData {
  const HostTargetHistoryData({
    required this.month,
    required this.currentMonth,
    required this.achievements,
  });

  final String month;
  final String currentMonth;
  final List<HostTargetHistoryAchievement> achievements;

  factory HostTargetHistoryData.fromJson(Map<String, dynamic> json) {
    final raw = json['achievements'];
    return HostTargetHistoryData(
      month: (json['month'] ?? '').toString().trim(),
      currentMonth: (json['currentMonth'] ?? '').toString().trim(),
      achievements: raw is List
          ? raw
              .whereType<Map>()
              .map(
                (item) => HostTargetHistoryAchievement.fromJson(
                  Map<String, dynamic>.from(item),
                ),
              )
              .toList(growable: false)
          : const <HostTargetHistoryAchievement>[],
    );
  }
}

class HostAgencyLeaveRequest {
  const HostAgencyLeaveRequest({
    required this.requestId,
    required this.agencyId,
    required this.status,
    required this.createdAt,
    required this.updatedAt,
  });

  final String requestId;
  final String agencyId;
  final String status;
  final String? createdAt;
  final String? updatedAt;

  factory HostAgencyLeaveRequest.fromJson(Map<String, dynamic> json) {
    return HostAgencyLeaveRequest(
      requestId: (json['requestId'] ?? '').toString().trim(),
      agencyId: (json['agencyId'] ?? '').toString().trim(),
      status: (json['status'] ?? '').toString().trim(),
      createdAt: _nullableString(json['createdAt']),
      updatedAt: _nullableString(json['updatedAt']),
    );
  }
}

class HostAgencyLeaveStatus {
  const HostAgencyLeaveStatus({
    required this.canRequestLeave,
    required this.request,
  });

  final bool canRequestLeave;
  final HostAgencyLeaveRequest? request;

  factory HostAgencyLeaveStatus.fromJson(Map<String, dynamic> json) {
    final request = json['request'];
    return HostAgencyLeaveStatus(
      canRequestLeave: json['canRequestLeave'] == true,
      request: request is Map
          ? HostAgencyLeaveRequest.fromJson(
              Map<String, dynamic>.from(request),
            )
          : null,
    );
  }
}

class HostMyAgencyService {
  HostMyAgencyService({
    http.Client? client,
    FirebaseAuth? auth,
    String? baseUrl,
    Duration requestTimeout = const Duration(seconds: 20),
  })  : _client = client ?? http.Client(),
        _ownsClient = client == null,
        _auth = auth ?? FirebaseAuth.instance,
        _baseUrl = baseUrl ??
            const String.fromEnvironment(
              'SHADOW_CLOUDFLARE_API_BASE_URL',
              defaultValue:
                  'https://shadow-live.ashraf-business-440.workers.dev/api',
            ),
        _requestTimeout = requestTimeout;

  final http.Client _client;
  final bool _ownsClient;
  final FirebaseAuth _auth;
  final String _baseUrl;
  final Duration _requestTimeout;

  Future<String> _idToken() async {
    try {
      final token = await _auth.currentUser
          ?.getIdToken()
          .timeout(_requestTimeout);
      if (token == null || token.isEmpty) throw StateError('not_signed_in');
      return token;
    } on TimeoutException {
      throw StateError('agency_host_auth_timeout');
    }
  }

  Future<HostMyAgencyCoreData> loadCore() async {
    final token = await _idToken();
    late http.Response response;
    try {
      response = await _client
          .post(
            Uri.parse('$_baseUrl/agency-host'),
            headers: {
              'authorization': 'Bearer $token',
              'content-type': 'application/json',
            },
            body: jsonEncode(const {'action': 'core'}),
          )
          .timeout(_requestTimeout);
    } on TimeoutException {
      throw StateError('agency_host_core_timeout');
    }

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


  Future<HostTargetHistoryData> loadTargetHistory({
    String? month,
  }) async {
    final token = await _idToken();
    final response = await _client
        .post(
          Uri.parse('$_baseUrl/agency-host'),
          headers: {
            'authorization': 'Bearer $token',
            'content-type': 'application/json',
          },
          body: jsonEncode({
            'action': 'targetHistory',
            if (month != null && month.trim().isNotEmpty)
              'month': month.trim(),
          }),
        )
        .timeout(_requestTimeout);

    Map<String, dynamic> body = const <String, dynamic>{};
    try {
      final decoded = jsonDecode(response.body);
      if (decoded is Map) body = Map<String, dynamic>.from(decoded);
    } catch (_) {}
    if (response.statusCode != 200 || body['ok'] != true) {
      throw StateError(
        (body['code'] ?? 'agency_target_history_failed').toString(),
      );
    }
    return HostTargetHistoryData.fromJson(body);
  }

  Future<HostAgencyLeaveStatus> loadLeaveStatus({
    required String agencyId,
  }) async {
    final token = await _idToken();
    final response = await _client.post(
      Uri.parse('$_baseUrl/agency-membership'),
      headers: {
        'authorization': 'Bearer $token',
        'content-type': 'application/json',
      },
      body: jsonEncode({
        'action': 'leaveStatus',
        'agencyId': agencyId.trim(),
      }),
    );

    Map<String, dynamic> body = const <String, dynamic>{};
    try {
      final decoded = jsonDecode(response.body);
      if (decoded is Map) body = Map<String, dynamic>.from(decoded);
    } catch (_) {}

    if (response.statusCode != 200 || body['ok'] != true) {
      throw StateError(
        (body['code'] ?? 'agency_leave_status_failed').toString(),
      );
    }
    return HostAgencyLeaveStatus.fromJson(body);
  }

  Future<HostAgencyLeaveStatus> requestLeave({
    required String agencyId,
  }) async {
    final token = await _idToken();
    final idempotencyKey =
        'leave_' + DateTime.now().microsecondsSinceEpoch.toString();
    final response = await _client.post(
      Uri.parse('$_baseUrl/agency-membership'),
      headers: {
        'authorization': 'Bearer $token',
        'content-type': 'application/json',
      },
      body: jsonEncode({
        'action': 'requestLeave',
        'agencyId': agencyId.trim(),
        'idempotencyKey': idempotencyKey,
      }),
    );

    Map<String, dynamic> body = const <String, dynamic>{};
    try {
      final decoded = jsonDecode(response.body);
      if (decoded is Map) body = Map<String, dynamic>.from(decoded);
    } catch (_) {}

    if (response.statusCode != 200 || body['ok'] != true) {
      throw StateError(
        (body['code'] ?? 'agency_leave_request_failed').toString(),
      );
    }

    return HostAgencyLeaveStatus(
      canRequestLeave: false,
      request: HostAgencyLeaveRequest.fromJson(body),
    );
  }

  Future<Map<String, dynamic>> updateAgencyProfile({
    required String description,
    required String publicContact,
  }) async {
    final token = await _idToken();
    final response = await _client
        .post(
          Uri.parse('$_baseUrl/agency-host'),
          headers: {
            'authorization': 'Bearer $token',
            'content-type': 'application/json',
          },
          body: jsonEncode({
            'action': 'updateProfile',
            'description': description.trim(),
            'publicContact': publicContact.trim(),
            'idempotencyKey':
                'agency_profile_' + DateTime.now().microsecondsSinceEpoch.toString(),
          }),
        )
        .timeout(_requestTimeout);
    Map<String, dynamic> body = const <String, dynamic>{};
    try {
      final decoded = jsonDecode(response.body);
      if (decoded is Map) body = Map<String, dynamic>.from(decoded);
    } catch (_) {}
    if (response.statusCode != 200 || body['ok'] != true) {
      throw StateError(
        (body['code'] ?? 'agency_profile_update_failed').toString(),
      );
    }
    return body;
  }

  Future<Map<String, dynamic>> requestIdentityChange({
    required String name,
    required String? country,
  }) async {
    final nextName = name.trim();
    final nextCountry = (country ?? '').trim();
    if (nextName.isEmpty || nextName.length > 80) {
      throw StateError('invalid_agency_name');
    }
    final token = await _idToken();
    final response = await _client
        .post(
          Uri.parse('$_baseUrl/agency-host'),
          headers: {
            'authorization': 'Bearer $token',
            'content-type': 'application/json',
          },
          body: jsonEncode({
            'action': 'requestIdentityChange',
            'name': nextName,
            'country': nextCountry,
            'idempotencyKey':
                'agency_identity_' + DateTime.now().microsecondsSinceEpoch.toString(),
          }),
        )
        .timeout(_requestTimeout);
    Map<String, dynamic> body = const <String, dynamic>{};
    try {
      final decoded = jsonDecode(response.body);
      if (decoded is Map) body = Map<String, dynamic>.from(decoded);
    } catch (_) {}
    if (response.statusCode != 200 || body['ok'] != true) {
      throw StateError(
        (body['code'] ?? 'agency_identity_change_request_failed').toString(),
      );
    }
    return body;
  }

  Future<Map<String, dynamic>> requestOwnershipTransfer({
    required String newOwnerPublicId,
  }) async {
    final publicId = newOwnerPublicId.trim();
    if (!RegExp(r'^\d{3,8}$').hasMatch(publicId)) {
      throw StateError('invalid_owner_public_id');
    }
    final token = await _idToken();
    final response = await _client
        .post(
          Uri.parse('$_baseUrl/agency-host'),
          headers: {
            'authorization': 'Bearer $token',
            'content-type': 'application/json',
          },
          body: jsonEncode({
            'action': 'requestOwnershipTransfer',
            'newOwnerPublicId': publicId,
            'idempotencyKey':
                'owner_transfer_' +
                DateTime.now().microsecondsSinceEpoch.toString(),
          }),
        )
        .timeout(_requestTimeout);

    Map<String, dynamic> body = const <String, dynamic>{};
    try {
      final decoded = jsonDecode(response.body);
      if (decoded is Map) body = Map<String, dynamic>.from(decoded);
    } catch (_) {}
    if (response.statusCode != 200 || body['ok'] != true) {
      throw StateError(
        (body['code'] ?? 'agency_ownership_transfer_request_failed').toString(),
      );
    }
    return body;
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
