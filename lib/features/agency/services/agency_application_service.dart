import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

class AgencyApplicationException implements Exception {
  const AgencyApplicationException(this.code);

  final String code;

  @override
  String toString() => code;
}

class AgencyApplicationHost {
  const AgencyApplicationHost({
    required this.uid,
    required this.publicId,
    required this.displayName,
    required this.photoUrl,
  });

  final String uid;
  final String publicId;
  final String displayName;
  final String? photoUrl;

  factory AgencyApplicationHost.fromJson(Map<String, dynamic> json) {
    return AgencyApplicationHost(
      uid: (json['uid'] ?? '').toString().trim(),
      publicId: (json['publicId'] ?? '').toString().trim(),
      displayName: (json['displayName'] ?? '').toString().trim(),
      photoUrl: _nullableString(json['photoUrl']),
    );
  }
}

class AgencyApplicationHostReservation {
  const AgencyApplicationHostReservation({
    required this.applicationId,
    required this.requiredHostCount,
    required this.host,
  });

  final String applicationId;
  final int requiredHostCount;
  final AgencyApplicationHost host;

  factory AgencyApplicationHostReservation.fromJson(Map<String, dynamic> json) {
    final rawHost = json['host'];
    return AgencyApplicationHostReservation(
      applicationId: (json['applicationId'] ?? '').toString().trim(),
      requiredHostCount: _nonNegativeInt(json['requiredHostCount']),
      host: AgencyApplicationHost.fromJson(
        rawHost is Map
            ? Map<String, dynamic>.from(rawHost)
            : const <String, dynamic>{},
      ),
    );
  }
}

class AgencyApplicationStatus {
  const AgencyApplicationStatus({
    required this.status,
    required this.applicationId,
    required this.canReapply,
    required this.reapplyMode,
    required this.remainingSeconds,
    required this.rejectionReason,
    required this.requiredHostCount,
    required this.reservedHosts,
    required this.reservationKey,
  });

  final String status;
  final String? applicationId;
  final bool canReapply;
  final String? reapplyMode;
  final int remainingSeconds;
  final String? rejectionReason;
  final int requiredHostCount;
  final List<AgencyApplicationHost> reservedHosts;
  final String? reservationKey;

  bool get isPending => status == 'pending' || status == 'under_review';
  bool get isRejected => status == 'rejected';
  bool get isApproved => status == 'approved' || status == 'active';

  factory AgencyApplicationStatus.fromJson(Map<String, dynamic> json) {
    return AgencyApplicationStatus(
      status: (json['status'] ?? 'none').toString().trim(),
      applicationId: _nullableString(json['applicationId']),
      canReapply: json['canReapply'] == true,
      reapplyMode: _nullableString(json['reapplyMode']),
      remainingSeconds: _nonNegativeInt(json['remainingSeconds']),
      rejectionReason: _nullableString(json['rejectionReason']),
      requiredHostCount: _boundedHostCount(json['requiredHostCount']),
      reservedHosts: json['reservedHosts'] is List
          ? (json['reservedHosts'] as List)
              .whereType<Map>()
              .map(
                (item) => AgencyApplicationHost.fromJson(
                  Map<String, dynamic>.from(item),
                ),
              )
              .toList(growable: false)
          : const <AgencyApplicationHost>[],
      reservationKey: _nullableString(json['reservationKey']),
    );
  }
}

class AgencyApplicationSubmitResult {
  const AgencyApplicationSubmitResult({
    required this.applicationId,
    required this.status,
    required this.name,
    required this.country,
    required this.hostIds,
    required this.requiredHostCount,
  });

  final String applicationId;
  final String status;
  final String name;
  final String? country;
  final List<String> hostIds;
  final int requiredHostCount;

  factory AgencyApplicationSubmitResult.fromJson(Map<String, dynamic> json) {
    final rawHosts = json['hostIds'];
    return AgencyApplicationSubmitResult(
      applicationId: (json['applicationId'] ?? '').toString().trim(),
      status: (json['status'] ?? 'pending').toString().trim(),
      name: (json['name'] ?? '').toString().trim(),
      country: _nullableString(json['country']),
      hostIds: rawHosts is List
          ? rawHosts.map((value) => value.toString().trim()).toList()
          : const <String>[],
      requiredHostCount: _boundedHostCount(json['requiredHostCount']),
    );
  }
}

class AgencyApplicationService {
  AgencyApplicationService({
    http.Client? client,
    FirebaseAuth? auth,
    Future<String> Function()? tokenProvider,
    String? baseUrl,
  })  : _client = client ?? http.Client(),
        _ownsClient = client == null,
        _auth = auth,
        _tokenProvider = tokenProvider,
        _baseUrl = baseUrl ??
            const String.fromEnvironment(
              'SHADOW_CLOUDFLARE_API_BASE_URL',
              defaultValue:
                  'https://shadow-live.ashraf-business-440.workers.dev/api',
            );

  final http.Client _client;
  final bool _ownsClient;
  final FirebaseAuth? _auth;
  final Future<String> Function()? _tokenProvider;
  final String _baseUrl;

  Future<String> _idToken() async {
    final token = _tokenProvider != null
        ? await _tokenProvider!()
        : await (_auth ?? FirebaseAuth.instance).currentUser?.getIdToken();
    if (token == null || token.isEmpty) {
      throw const AgencyApplicationException('not_signed_in');
    }
    return token;
  }

  Future<Map<String, dynamic>> _post(Map<String, dynamic> payload) async {
    final token = await _idToken();
    final response = await _client
        .post(
          Uri.parse('$_baseUrl/agency-application'),
          headers: {
            'authorization': 'Bearer $token',
            'content-type': 'application/json',
          },
          body: jsonEncode(payload),
        )
        .timeout(const Duration(seconds: 25));

    Map<String, dynamic> body = const <String, dynamic>{};
    try {
      final decoded = jsonDecode(response.body);
      if (decoded is Map) body = Map<String, dynamic>.from(decoded);
    } catch (_) {}

    if (response.statusCode < 200 ||
        response.statusCode >= 300 ||
        body['ok'] != true) {
      throw AgencyApplicationException(
        (body['code'] ?? 'agency_application_failed').toString(),
      );
    }
    return body;
  }

  Future<AgencyApplicationStatus> loadStatus() async {
    final body = await _post(const {'action': 'status'});
    return AgencyApplicationStatus.fromJson(body);
  }

  Future<AgencyApplicationHostReservation> reserveHost({
    required String hostId,
    required String idempotencyKey,
  }) async {
    final body = await _post({
      'action': 'reserveHost',
      'hostId': hostId.trim(),
      'idempotencyKey': idempotencyKey,
    });
    return AgencyApplicationHostReservation.fromJson(body);
  }

  Future<void> releaseHost({
    required String hostId,
    required String idempotencyKey,
  }) async {
    await _post({
      'action': 'releaseHost',
      'hostId': hostId.trim(),
      'idempotencyKey': idempotencyKey,
    });
  }

  Future<AgencyApplicationSubmitResult> submit({
    required String name,
    required String country,
    required List<String> hostIds,
    required String idempotencyKey,
  }) async {
    final body = await _post({
      'action': 'submit',
      'name': name.trim(),
      if (country.trim().isNotEmpty) 'country': country.trim(),
      'hostIds': hostIds.map((value) => value.trim()).toList(growable: false),
      'idempotencyKey': idempotencyKey,
    });
    return AgencyApplicationSubmitResult.fromJson(body);
  }

  void close() {
    if (_ownsClient) _client.close();
  }
}

String? _nullableString(dynamic value) {
  final text = (value ?? '').toString().trim();
  return text.isEmpty ? null : text;
}

int _nonNegativeInt(dynamic value) {
  final parsed = value is num ? value.toInt() : int.tryParse('$value') ?? 0;
  return parsed < 0 ? 0 : parsed;
}

int _boundedHostCount(dynamic value, {int fallback = 5}) {
  if (value == null) return fallback;
  final parsed = _nonNegativeInt(value);
  if (parsed > 30) return 30;
  return parsed;
}
