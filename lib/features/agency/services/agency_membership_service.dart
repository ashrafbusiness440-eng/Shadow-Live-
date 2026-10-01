import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

class AgencyMembershipInvitationAgency {
  const AgencyMembershipInvitationAgency({
    required this.agencyId,
    required this.publicId,
    required this.name,
    required this.country,
    required this.logoUrl,
    required this.memberCount,
    required this.hostCount,
    required this.status,
  });

  final String agencyId;
  final String publicId;
  final String name;
  final String? country;
  final String? logoUrl;
  final int memberCount;
  final int hostCount;
  final String status;

  factory AgencyMembershipInvitationAgency.fromJson(
    Map<String, dynamic> json,
  ) {
    return AgencyMembershipInvitationAgency(
      agencyId: (json['agencyId'] ?? '').toString().trim(),
      publicId: (json['publicId'] ?? json['agencyId'] ?? '').toString().trim(),
      name: (json['name'] ?? 'Shadow Live Agency').toString().trim(),
      country: _nullable(json['country']),
      logoUrl: _nullable(json['logoUrl']),
      memberCount: _nonNegativeInt(json['memberCount']),
      hostCount: _nonNegativeInt(json['hostCount']),
      status: (json['status'] ?? 'active').toString().trim(),
    );
  }
}

class AgencyMembershipRequestDetail {
  const AgencyMembershipRequestDetail({
    required this.requestId,
    required this.agencyId,
    required this.type,
    required this.status,
    required this.targetRole,
    required this.agency,
  });

  final String requestId;
  final String agencyId;
  final String type;
  final String status;
  final String targetRole;
  final AgencyMembershipInvitationAgency agency;

  bool get isPendingInvitation => type == 'invite' && status == 'pending';

  factory AgencyMembershipRequestDetail.fromJson(Map<String, dynamic> json) {
    final request = json['request'];
    final agency = json['agency'];
    if (request is! Map || agency is! Map) {
      throw const FormatException('invalid_agency_membership_request_detail');
    }
    final requestMap = Map<String, dynamic>.from(request);
    return AgencyMembershipRequestDetail(
      requestId: (requestMap['requestId'] ?? '').toString().trim(),
      agencyId: (requestMap['agencyId'] ?? '').toString().trim(),
      type: (requestMap['type'] ?? '').toString().trim(),
      status: (requestMap['status'] ?? '').toString().trim(),
      targetRole: (requestMap['targetRole'] ?? 'host').toString().trim(),
      agency: AgencyMembershipInvitationAgency.fromJson(
        Map<String, dynamic>.from(agency),
      ),
    );
  }
}

class AgencyMembershipRequestSummary {
  const AgencyMembershipRequestSummary({
    required this.requestId,
    required this.agencyId,
    required this.agencyName,
    required this.type,
    required this.status,
    required this.createdAt,
  });

  final String requestId;
  final String agencyId;
  final String? agencyName;
  final String type;
  final String status;
  final DateTime? createdAt;

  bool get isPending => status == 'pending';

  factory AgencyMembershipRequestSummary.fromJson(Map<String, dynamic> json) {
    return AgencyMembershipRequestSummary(
      requestId: (json['requestId'] ?? '').toString().trim(),
      agencyId: (json['agencyId'] ?? '').toString().trim(),
      agencyName: _nullable(json['agencyName']),
      type: (json['type'] ?? '').toString().trim(),
      status: (json['status'] ?? '').toString().trim(),
      createdAt: DateTime.tryParse((json['createdAt'] ?? '').toString()),
    );
  }
}

class AgencyReviewRequestDetail {
  const AgencyReviewRequestDetail({
    required this.requestId,
    required this.agencyId,
    required this.uid,
    required this.userPublicId,
    required this.displayName,
    required this.profileImageUrl,
    required this.type,
    required this.targetRole,
    required this.status,
    required this.createdAt,
    required this.accountStatus,
    required this.conflictStatus,
    required this.reason,
    required this.resolvedBy,
    required this.actionable,
  });

  final String requestId;
  final String agencyId;
  final String uid;
  final String? userPublicId;
  final String? displayName;
  final String? profileImageUrl;
  final String type;
  final String targetRole;
  final String status;
  final DateTime? createdAt;
  final String accountStatus;
  final String conflictStatus;
  final String? reason;
  final String? resolvedBy;
  final bool actionable;

  bool get canAccept =>
      actionable &&
      status == 'pending' &&
      conflictStatus == 'none' &&
      accountStatus == 'active';

  factory AgencyReviewRequestDetail.fromJson(Map<String, dynamic> json) {
    final raw = json['request'];
    if (raw is! Map) {
      throw const FormatException('invalid_agency_review_request');
    }
    final request = Map<String, dynamic>.from(raw);
    return AgencyReviewRequestDetail(
      requestId: (request['requestId'] ?? '').toString().trim(),
      agencyId: (request['agencyId'] ?? '').toString().trim(),
      uid: (request['uid'] ?? '').toString().trim(),
      userPublicId: _nullable(request['userPublicId']),
      displayName: _nullable(request['displayName']),
      profileImageUrl: _nullable(request['profileImageUrl']),
      type: (request['type'] ?? '').toString().trim(),
      targetRole: (request['targetRole'] ?? 'host').toString().trim(),
      status: (request['status'] ?? '').toString().trim(),
      createdAt: _dateTime(request['createdAt']),
      accountStatus: (request['accountStatus'] ?? 'active').toString().trim(),
      conflictStatus: (request['conflictStatus'] ?? 'none').toString().trim(),
      reason: _nullable(request['reason']),
      resolvedBy: _nullable(request['resolvedBy']),
      actionable: json['actionable'] == true,
    );
  }
}

class AgencyJoinReservation {
  const AgencyJoinReservation({
    required this.requestId,
    required this.agencyId,
    required this.status,
    required this.type,
  });

  final String? requestId;
  final String? agencyId;
  final String status;
  final String? type;

  factory AgencyJoinReservation.fromJson(Map<String, dynamic> json) {
    return AgencyJoinReservation(
      requestId: _nullable(json['requestId']),
      agencyId: _nullable(json['agencyId']),
      status: (json['status'] ?? '').toString().trim(),
      type: _nullable(json['type']),
    );
  }
}

class AgencyApplicationReservation {
  const AgencyApplicationReservation({
    required this.applicationId,
    required this.status,
  });

  final String? applicationId;
  final String status;

  factory AgencyApplicationReservation.fromJson(Map<String, dynamic> json) {
    return AgencyApplicationReservation(
      applicationId: _nullable(json['applicationId']),
      status: (json['status'] ?? '').toString().trim(),
    );
  }
}

class AgencyCooldownExceptionStatus {
  const AgencyCooldownExceptionStatus({
    required this.active,
    required this.agencyId,
    required this.status,
    required this.cooldownUntil,
    required this.remainingSeconds,
    required this.exceptionStatus,
    required this.exceptionReason,
    required this.resolutionReason,
  });

  final bool active;
  final String? agencyId;
  final String? status;
  final String? cooldownUntil;
  final int remainingSeconds;
  final String? exceptionStatus;
  final String? exceptionReason;
  final String? resolutionReason;

  factory AgencyCooldownExceptionStatus.fromJson(
    Map<String, dynamic> json,
  ) {
    final request = json['exceptionRequest'];
    final requestMap = request is Map
        ? Map<String, dynamic>.from(request)
        : const <String, dynamic>{};
    final remaining = json['remainingSeconds'];
    return AgencyCooldownExceptionStatus(
      active: json['active'] == true,
      agencyId: _nullable(json['agencyId']),
      status: _nullable(json['status']),
      cooldownUntil: _nullable(json['cooldownUntil']),
      remainingSeconds: remaining is num
          ? remaining.toInt()
          : int.tryParse('$remaining') ?? 0,
      exceptionStatus: _nullable(requestMap['status']),
      exceptionReason: _nullable(requestMap['reason']),
      resolutionReason: _nullable(requestMap['resolutionReason']),
    );
  }

  bool get canRequestException =>
      active && exceptionStatus != 'pending' && exceptionStatus != 'accepted';
}

class AgencyJoinEligibility {
  const AgencyJoinEligibility({
    required this.canRequestJoin,
    required this.linkedAgencyId,
    required this.membershipRole,
    required this.membershipStatus,
    required this.membershipReservation,
    required this.applicationReservation,
    required this.cooldown,
  });

  final bool canRequestJoin;
  final String? linkedAgencyId;
  final String? membershipRole;
  final String? membershipStatus;
  final AgencyJoinReservation? membershipReservation;
  final AgencyApplicationReservation? applicationReservation;
  final AgencyCooldownExceptionStatus? cooldown;

  factory AgencyJoinEligibility.fromJson(Map<String, dynamic> json) {
    final membershipReservation = json['membershipReservation'];
    final applicationReservation = json['applicationReservation'];
    final cooldown = json['cooldown'];
    return AgencyJoinEligibility(
      canRequestJoin: json['canRequestJoin'] == true,
      linkedAgencyId: _nullable(json['linkedAgencyId']),
      membershipRole: _nullable(json['membershipRole']),
      membershipStatus: _nullable(json['membershipStatus']),
      membershipReservation: membershipReservation is Map
          ? AgencyJoinReservation.fromJson(
              Map<String, dynamic>.from(membershipReservation),
            )
          : null,
      applicationReservation: applicationReservation is Map
          ? AgencyApplicationReservation.fromJson(
              Map<String, dynamic>.from(applicationReservation),
            )
          : null,
      cooldown: cooldown is Map
          ? AgencyCooldownExceptionStatus.fromJson(
              Map<String, dynamic>.from(cooldown),
            )
          : null,
    );
  }
}

class AgencyMembershipService {
  AgencyMembershipService({
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

  Future<String> _token() async {
    final token = await _auth.currentUser?.getIdToken();
    if (token == null || token.isEmpty) throw StateError('not_signed_in');
    return token;
  }

  Future<Map<String, dynamic>> _post(Map<String, dynamic> body) async {
    final token = await _token();
    final response = await _client.post(
      Uri.parse('$_baseUrl/agency-membership'),
      headers: {
        'authorization': 'Bearer $token',
        'content-type': 'application/json',
      },
      body: jsonEncode(body),
    );

    Map<String, dynamic> decoded = const <String, dynamic>{};
    try {
      final value = jsonDecode(response.body);
      if (value is Map) decoded = Map<String, dynamic>.from(value);
    } catch (_) {}

    if (response.statusCode != 200 || decoded['ok'] != true) {
      throw StateError(
        (decoded['code'] ?? 'agency_membership_request_failed').toString(),
      );
    }
    return decoded;
  }

  Future<void> requestJoin({
    required String agencyId,
    required String idempotencyKey,
  }) async {
    await _post({
      'action': 'requestJoin',
      'agencyId': agencyId.trim(),
      'idempotencyKey': idempotencyKey,
    });
  }

  Future<AgencyReviewRequestDetail> getReviewRequest(
    String requestId,
  ) async {
    final body = await _post({
      'action': 'reviewRequest',
      'requestId': requestId.trim(),
    });
    return AgencyReviewRequestDetail.fromJson(body);
  }

  Future<AgencyMembershipRequestDetail> getMyRequest(
    String requestId,
  ) async {
    final body = await _post({
      'action': 'getMyRequest',
      'requestId': requestId.trim(),
    });
    return AgencyMembershipRequestDetail.fromJson(body);
  }

  Future<AgencyJoinEligibility> loadEligibility() async {
    final body = await _post(const {
      'action': 'eligibility',
    });
    return AgencyJoinEligibility.fromJson(body);
  }

  Future<void> requestCooldownException({
    required String reason,
  }) async {
    final normalized = reason.trim();
    if (normalized.length < 3) {
      throw StateError('cooldown_exception_reason_required');
    }
    await _post({
      'action': 'requestCooldownException',
      'reason': normalized,
      'idempotencyKey':
          'cooldown_exception_' +
          DateTime.now().microsecondsSinceEpoch.toString(),
    });
  }

  Future<List<AgencyMembershipRequestSummary>> loadMyRequests() async {
    final body = await _post({
      'action': 'listMy',
      'limit': 20,
    });
    final requests = body['requests'];
    if (requests is! List) return const <AgencyMembershipRequestSummary>[];
    return requests
        .whereType<Map>()
        .map(
          (item) => AgencyMembershipRequestSummary.fromJson(
            Map<String, dynamic>.from(item),
          ),
        )
        .where((item) => item.requestId.isNotEmpty)
        .toList(growable: false);
  }

  Future<String> respondReview({
    required String requestId,
    required String requestType,
    required String decision,
    required String idempotencyKey,
    String? reason,
  }) async {
    final body = await _post({
      'action': requestType.trim() == 'leave' ? 'respondLeave' : 'respond',
      'requestId': requestId.trim(),
      'decision': decision.trim(),
      'idempotencyKey': idempotencyKey,
      if (reason != null && reason.trim().isNotEmpty)
        'reason': reason.trim(),
    });
    return (body['code'] ?? 'ok').toString();
  }

  Future<void> respond({
    required String requestId,
    required String decision,
    required String idempotencyKey,
  }) async {
    await _post({
      'action': 'respond',
      'requestId': requestId.trim(),
      'decision': decision.trim(),
      'idempotencyKey': idempotencyKey,
    });
  }

  void close() {
    if (_ownsClient) _client.close();
  }
}

DateTime? _dateTime(dynamic value) {
  if (value is DateTime) return value;
  final text = (value ?? '').toString().trim();
  if (text.isEmpty) return null;
  return DateTime.tryParse(text);
}

String? _nullable(dynamic value) {
  final normalized = (value ?? '').toString().trim();
  return normalized.isEmpty ? null : normalized;
}

int _nonNegativeInt(dynamic value) {
  final parsed = value is num ? value.toInt() : int.tryParse('$value') ?? 0;
  return parsed < 0 ? 0 : parsed;
}
